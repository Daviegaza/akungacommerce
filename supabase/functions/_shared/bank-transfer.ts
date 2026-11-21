/**
 * Bank-transfer (virtual account) collections for NGN shops. Extends the
 * collections-provider model in ./collections.ts with a second rail: instead of
 * an STK prompt, the buyer transfers to a dedicated account and the provider's
 * webhook reports the credit.
 *
 * Verified against official docs (2026-11-20):
 * - Paystack: `x-paystack-signature` = HMAC SHA512 of the raw body keyed with the
 *   secret key, hex (https://paystack.com/docs/payments/webhooks/). DVA payments
 *   arrive as `charge.success` with authorization.channel = "dedicated_nuban"
 *   (https://paystack.com/docs/payments/dedicated-virtual-accounts/).
 * - Flutterwave: the `verif-hash` header carries the secret hash you set in the
 *   dashboard; compare it to your stored value
 *   (https://developer.flutterwave.com/docs/webhooks). The virtual-account
 *   payment event format could NOT be confirmed (docs page unavailable), so the
 *   Flutterwave parser returns null and no payment is recorded from it.
 *
 * Not verified: Paystack's amount unit for DVA credits is not stated on the DVA
 * page. Paystack amounts are generally in the subunit (kobo); confirm in a
 * sandbox test before trusting `amountMinor`.
 *
 * No provider API is called anywhere here (no account creation). Runtime-agnostic.
 */
import type { ProviderReadiness } from './collections.ts'
import { timingSafeEqual, verifyPaystackSignature, type VerifyResult } from './signatures.ts'

export type BankTransferProviderId = 'paystack_dva' | 'flutterwave_va'

/** Provider-neutral credit, reduced from a verified webhook before reconciliation. */
export interface NormalisedTransferCredit {
  provider: BankTransferProviderId
  /** Provider's unique transaction reference: the idempotency key. */
  reference: string
  amountMinor: number
  currency: string
  /** Account that received the money (our dedicated account). */
  receiverAccountNumber: string | null
  /** Last 4 digits only; never store the full sender account. */
  senderHint: string | null
  /** Provider customer reference (Paystack customer_code). */
  customerRef: string | null
  paidAt: string | null
}

export interface VirtualAccountAdapter {
  readonly id: BankTransferProviderId
  readonly readiness: ProviderReadiness
  /** Authenticate the webhook before trusting any field. */
  verifyWebhook(rawBody: string, headers: Headers, secret: string): Promise<VerifyResult>
  /** null = not a bank-transfer credit we understand (ignore, never guess). */
  parseWebhook(body: unknown): NormalisedTransferCredit | null
  /**
   * Ask the provider for a dedicated account for an order or customer. adapter_only:
   * no provider API is called in this build, so this always answers not_configured.
   * When implemented, the server stores the result with record_virtual_account
   * (migration 20261120000060) and never shows an account the provider did not return.
   */
  assignVirtualAccount(input: AssignVirtualAccountInput): Promise<AssignVirtualAccountOutcome>
}

export interface AssignVirtualAccountInput {
  orgId: string
  orderId: string | null
  customerId: string | null
  customerEmail: string | null
  customerName: string | null
}

export type AssignVirtualAccountOutcome =
  | { status: 'assigned'; bankName: string; accountNumber: string; accountName: string | null; customerRef: string | null }
  | { status: 'not_configured'; reason: string }

/**
 * Paystack amounts are documented in the subunit (kobo) for transactions, but the DVA
 * page does not restate it. Not confirmed in a sandbox test, so this stays false.
 */
export const PAYSTACK_DVA_AMOUNT_UNIT_CONFIRMED = false

const notImplementedAssign = async (): Promise<AssignVirtualAccountOutcome> => ({
  status: 'not_configured',
  reason: 'adapter_only: virtual account assignment is not implemented; no provider API is called',
})

/** Arguments for public.reconcile_bank_transfer (service role), from a verified credit only. */
export function bankTransferRpcArgs(credit: NormalisedTransferCredit) {
  return {
    p_provider: credit.provider,
    p_reference: credit.reference,
    p_amount_minor: credit.amountMinor,
    p_currency: credit.currency,
    p_receiver_account: credit.receiverAccountNumber,
    p_customer_ref: credit.customerRef,
    p_sender_hint: credit.senderHint,
    p_paid_at: credit.paidAt,
  }
}

/** reconcile_bank_transfer outcomes after which the webhook event counts as handled. */
export const BANK_TRANSFER_PROCESSED: ReadonlySet<string> = new Set(['recorded', 'unmatched', 'duplicate'])

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)

function last4(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 4 ? d.slice(-4) : null
}

/** Paystack `charge.success` for a dedicated NUBAN -> credit. */
export function parsePaystackDvaCharge(body: unknown): NormalisedTransferCredit | null {
  const root = obj(body)
  if (!root || root.event !== 'charge.success') return null
  const data = obj(root.data)
  if (!data || data.status !== 'success') return null
  const auth = obj(data.authorization)
  if (auth?.channel !== 'dedicated_nuban' && data.channel !== 'dedicated_nuban') return null
  const reference = str(data.reference)
  const amount = typeof data.amount === 'number' ? data.amount : null
  const currency = str(data.currency)?.toUpperCase() ?? null
  if (!reference || amount === null || !Number.isSafeInteger(amount) || amount <= 0 || currency !== 'NGN') return null
  const customer = obj(data.customer)
  return {
    provider: 'paystack_dva',
    reference,
    amountMinor: amount,
    currency,
    receiverAccountNumber: str(auth?.receiver_bank_account_number),
    senderHint: last4(auth?.sender_bank_account_number),
    customerRef: str(customer?.customer_code),
    paidAt: str(data.paid_at) ?? str(data.paidAt),
  }
}

export const paystackDvaAdapter: VirtualAccountAdapter = {
  id: 'paystack_dva',
  readiness: 'adapter_only',
  verifyWebhook: (rawBody, headers, secret) => verifyPaystackSignature(rawBody, headers.get('x-paystack-signature'), secret),
  parseWebhook: parsePaystackDvaCharge,
  assignVirtualAccount: notImplementedAssign,
}

const encoder = new TextEncoder()

/** Flutterwave `verif-hash`: equals the secret hash set in the dashboard. Compared in constant time. */
export async function verifyFlutterwaveHash(header: string | null, secretHash: string): Promise<VerifyResult> {
  if (!secretHash) return { ok: false, reason: 'Secret hash not configured' }
  if (!header) return { ok: false, reason: 'Missing verif-hash header' }
  // Hash both sides first so the comparison is fixed-length and constant time.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(header.trim())),
    crypto.subtle.digest('SHA-256', encoder.encode(secretHash)),
  ])
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b)) ? { ok: true } : { ok: false, reason: 'Secret hash mismatch' }
}

export const flutterwaveVaAdapter: VirtualAccountAdapter = {
  id: 'flutterwave_va',
  readiness: 'adapter_only',
  verifyWebhook: (_rawBody, headers, secret) => verifyFlutterwaveHash(headers.get('verif-hash'), secret),
  // Event format for virtual-account credits not confirmed from official docs: never guess.
  parseWebhook: () => null,
  assignVirtualAccount: notImplementedAssign,
}

export const VIRTUAL_ACCOUNT_ADAPTERS: Readonly<Record<BankTransferProviderId, VirtualAccountAdapter>> = {
  paystack_dva: paystackDvaAdapter,
  flutterwave_va: flutterwaveVaAdapter,
}

/** Pick the adapter for a shop's choice; 'none' or unknown -> null. */
export function resolveBankTransferAdapter(choice: string | null | undefined): VirtualAccountAdapter | null {
  return choice === 'paystack_dva' || choice === 'flutterwave_va' ? VIRTUAL_ACCOUNT_ADAPTERS[choice] : null
}
