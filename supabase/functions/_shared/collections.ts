/**
 * Collections providers: how a shop gets paid by M-Pesa.
 *
 *   daraja      Safaricom Daraja direct (STK push + callback). Needs a registered
 *               Till or Paybill (organisation KRA PIN). Label: adapter_only until
 *               an end-to-end test passes.
 *   aggregator  A licensed payment aggregator that can prompt customers on behalf
 *               of sellers who only have Pochi la Biashara or a personal number.
 *               Only the interface exists: no aggregator API has been verified
 *               against official docs in this repository, so every aggregator is
 *               `adapter_only` and requestPrompt returns `not_configured`.
 *   manual      The seller checks their own M-Pesa messages and confirms by hand.
 *               Nothing can be verified automatically.
 *
 * Secrets come from the shop's own credentials in Supabase Vault (org_mpesa_credentials) or, only
 * when DARAJA_ALLOW_PLATFORM_SHORTCODE=true, from the Edge Function environment.
 * Nothing here logs or returns a credential. Runtime-agnostic (fetch only).
 */
import {
  DarajaError,
  buildStkPushPayload,
  getDarajaToken,
  kesToMinor,
  normaliseReceipt,
  parseStkCallback,
  phoneHintOf,
  sendStkPush,
  type DarajaEnv,
  type FetchLike,
  type StkTransactionType,
} from './daraja.ts'

export type CollectionsProviderId = 'daraja' | 'aggregator' | 'manual'
export type ProviderReadiness = 'connected_verified' | 'configured_unverified' | 'adapter_only' | 'not_implemented'

export interface PromptRequest {
  orderNumber: number
  /** Minor units. */
  amountMinor: number
  currency: string
  phoneE164: string
  /** Where the provider must send the result (already carries the shared secret). */
  callbackUrl: string
}

export type PromptOutcome =
  | { status: 'prompt_sent'; checkoutRequestId: string }
  | { status: 'not_configured' }
  | { status: 'failed'; error: string }

/** Provider-neutral shape every callback is reduced to before reconciliation. */
export interface NormalisedCallback {
  checkoutRequestId: string
  resultCode: number
  resultDesc: string
  amountMinor: number | null
  receipt: string | null
  phoneHint: string | null
  transactedAt: string | null
}

export interface CollectionsProvider {
  readonly id: CollectionsProviderId
  /** Value used in payments.provider and integration_connections.provider. */
  readonly paymentProvider: string
  readonly supportsStk: boolean
  /** Can collect for Pochi la Biashara / personal-number sellers. */
  readonly supportsPersonalNumbers: boolean
  requestPrompt(req: PromptRequest): Promise<PromptOutcome>
  parseCallback(body: unknown): NormalisedCallback | null
}

/* ───────────── Daraja direct ───────────── */

export interface DarajaConfig {
  env: DarajaEnv
  consumerKey: string
  consumerSecret: string
  shortcode: string
  passkey: string
  callbackUrl: string
  callbackSecret: string
  transactionType: StkTransactionType
  partyB?: string
}

/** Read Daraja settings from the environment. Returns null unless every required value is present and valid. */
export function readDarajaConfig(get: (name: string) => string | undefined): DarajaConfig | null {
  const v = (k: string) => (get(k) ?? '').trim()
  const env = v('DARAJA_ENV')
  const cfg = {
    consumerKey: v('DARAJA_CONSUMER_KEY'),
    consumerSecret: v('DARAJA_CONSUMER_SECRET'),
    shortcode: v('DARAJA_SHORTCODE'),
    passkey: v('DARAJA_PASSKEY'),
    callbackUrl: v('DARAJA_CALLBACK_URL'),
    callbackSecret: v('MPESA_CALLBACK_SECRET'),
  }
  if ((env !== 'sandbox' && env !== 'production') || Object.values(cfg).some((x) => !x)) return null
  const type = v('DARAJA_TRANSACTION_TYPE') || 'CustomerPayBillOnline'
  if (type !== 'CustomerPayBillOnline' && type !== 'CustomerBuyGoodsOnline') return null
  return { env, ...cfg, transactionType: type, partyB: v('DARAJA_PARTY_B') || undefined }
}

/** Decrypted per-shop credentials as returned by the service-role RPC mpesa_credentials_for. */
export interface ShopDarajaCredentials {
  environment: string
  shortcode: string
  transaction_type: string
  party_b: string | null
  consumer_key: string
  consumer_secret: string
  passkey: string
}

/**
 * Build a config from a shop's own credentials (money goes to the shop's Till/Paybill).
 * The callback URL and its secret are platform settings: Fungua's endpoint, not the shop's.
 */
export function darajaConfigFromShop(row: unknown, get: (name: string) => string | undefined): DarajaConfig | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Partial<ShopDarajaCredentials>
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const env = str(r.environment)
  const type = str(r.transaction_type)
  const cfg = {
    consumerKey: str(r.consumer_key),
    consumerSecret: str(r.consumer_secret),
    shortcode: str(r.shortcode),
    passkey: str(r.passkey),
    callbackUrl: (get('DARAJA_CALLBACK_URL') ?? '').trim(),
    callbackSecret: (get('MPESA_CALLBACK_SECRET') ?? '').trim(),
  }
  if ((env !== 'sandbox' && env !== 'production') || Object.values(cfg).some((x) => !x)) return null
  if (type !== 'CustomerPayBillOnline' && type !== 'CustomerBuyGoodsOnline') return null
  return { env, ...cfg, transactionType: type, partyB: str(r.party_b) || undefined }
}

/**
 * Which Daraja credentials pay a shop. The shop's own credentials win. The platform-wide
 * env credentials (one account collecting for every shop) are used only when the operator
 * explicitly opts in with DARAJA_ALLOW_PLATFORM_SHORTCODE=true.
 */
export function chooseDarajaConfig(
  shopRow: unknown,
  get: (name: string) => string | undefined,
): { cfg: DarajaConfig; source: 'shop' | 'platform' } | null {
  const own = darajaConfigFromShop(shopRow, get)
  if (own) return { cfg: own, source: 'shop' }
  if ((get('DARAJA_ALLOW_PLATFORM_SHORTCODE') ?? '').trim() !== 'true') return null
  const platform = readDarajaConfig(get)
  return platform ? { cfg: platform, source: 'platform' } : null
}

/** Callback URL with the shared secret appended (Daraja does not sign callbacks). */
export function callbackUrlWithSecret(base: string, secret: string): string {
  const u = new URL(base)
  u.searchParams.set('secret', secret)
  return u.toString()
}

export function createDarajaProvider(cfg: DarajaConfig, fetchImpl: FetchLike): CollectionsProvider {
  return {
    id: 'daraja',
    paymentProvider: 'mpesa',
    supportsStk: true,
    supportsPersonalNumbers: false,
    async requestPrompt(req) {
      if (req.currency !== 'KES') return { status: 'failed', error: 'M-Pesa is only available for KES orders' }
      try {
        const payload = buildStkPushPayload({
          shortcode: cfg.shortcode,
          passkey: cfg.passkey,
          transactionType: cfg.transactionType,
          partyB: cfg.partyB,
          amountMinor: req.amountMinor,
          phoneE164: req.phoneE164,
          callbackUrl: req.callbackUrl,
          accountReference: String(req.orderNumber),
          transactionDesc: `Order ${req.orderNumber}`,
        })
        const token = await getDarajaToken(fetchImpl, cfg.env, cfg.consumerKey, cfg.consumerSecret)
        const result = await sendStkPush(fetchImpl, cfg.env, token, payload)
        return { status: 'prompt_sent', checkoutRequestId: result.checkoutRequestId }
      } catch (e) {
        if (e instanceof DarajaError) return { status: 'failed', error: e.message }
        return { status: 'failed', error: 'Could not send the prompt' }
      }
    },
    parseCallback: normaliseStkCallback,
  }
}

/** Daraja STK callback body -> provider-neutral shape (pure; needs no credentials). */
export function normaliseStkCallback(body: unknown): NormalisedCallback | null {
  const cb = parseStkCallback(body)
  if (!cb) return null
  return {
    checkoutRequestId: cb.checkoutRequestId,
    resultCode: cb.resultCode,
    resultDesc: cb.resultDesc.slice(0, 300),
    amountMinor: kesToMinor(cb.amount),
    receipt: normaliseReceipt(cb.mpesaReceipt),
    phoneHint: phoneHintOf(cb.phone),
    transactedAt: cb.transactionDate,
  }
}

/* ───────────── Aggregators (interface only) ───────────── */

/**
 * What a concrete aggregator adapter must implement. Add one only after checking
 * the provider's official API docs and passing a sandbox end-to-end test:
 * never guess endpoints or webhook formats.
 */
export interface AggregatorAdapter {
  readonly id: string
  requestPrompt(req: PromptRequest, fetchImpl: FetchLike): Promise<PromptOutcome>
  /** Must authenticate the webhook (signature or provider challenge) before trusting it. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<boolean>
  parseWebhook(body: unknown): NormalisedCallback | null
}

export interface AggregatorDescriptor {
  id: string
  name: string
  readiness: ProviderReadiness
  supportsPersonalNumbers: boolean
  /** Official documentation to verify against before writing the adapter. */
  docs: string
  note: string
}

/** Known candidates. None has a verified adapter here. */
export const AGGREGATORS: readonly AggregatorDescriptor[] = [
  {
    id: 'intasend',
    name: 'IntaSend',
    readiness: 'adapter_only',
    supportsPersonalNumbers: true,
    docs: 'https://developers.intasend.com/',
    note: 'Interface only. API not verified from official docs in this build; no endpoints are called.',
  },
  {
    id: 'pesapal',
    name: 'Pesapal',
    readiness: 'adapter_only',
    supportsPersonalNumbers: true,
    docs: 'https://developer.pesapal.com/',
    note: 'Interface only. API not verified from official docs in this build; no endpoints are called.',
  },
]

/** Concrete adapters by id. Deliberately empty until one is verified end to end. */
export const AGGREGATOR_ADAPTERS: Readonly<Record<string, AggregatorAdapter>> = {}

export function createAggregatorProvider(
  aggregatorId: string | null,
  fetchImpl: FetchLike,
  adapters: Readonly<Record<string, AggregatorAdapter>> = AGGREGATOR_ADAPTERS,
): CollectionsProvider {
  const adapter = aggregatorId ? adapters[aggregatorId] : undefined
  return {
    id: 'aggregator',
    paymentProvider: aggregatorId ?? 'aggregator',
    supportsStk: Boolean(adapter),
    supportsPersonalNumbers: true,
    requestPrompt: (req) => (adapter ? adapter.requestPrompt(req, fetchImpl) : Promise.resolve({ status: 'not_configured' })),
    parseCallback: (body) => (adapter ? adapter.parseWebhook(body) : null),
  }
}

/* ───────────── Manual ───────────── */

export function createManualProvider(): CollectionsProvider {
  return {
    id: 'manual',
    paymentProvider: 'manual',
    supportsStk: false,
    supportsPersonalNumbers: true,
    requestPrompt: () => Promise.resolve({ status: 'not_configured' }),
    parseCallback: () => null,
  }
}

/** Pick the provider a shop chose. Missing configuration always degrades to not_configured, never to a guess. */
export function resolveCollectionsProvider(
  choice: { provider: string | null | undefined; aggregator: string | null | undefined },
  get: (name: string) => string | undefined,
  fetchImpl: FetchLike,
  /** The shop's decrypted credentials (mpesa_credentials_for), or null. */
  shopCredentials: unknown = null,
): CollectionsProvider {
  if (choice.provider === 'daraja') {
    const chosen = chooseDarajaConfig(shopCredentials, get)
    return chosen ? createDarajaProvider(chosen.cfg, fetchImpl) : createManualProvider()
  }
  if (choice.provider === 'aggregator') return createAggregatorProvider(choice.aggregator ?? null, fetchImpl)
  return createManualProvider()
}
