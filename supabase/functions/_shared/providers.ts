/**
 * Provider adapters. They BUILD requests and interpret responses but take an
 * injected `fetch` and explicit config, so they are testable without network
 * access and never read secrets themselves.
 *
 * Honesty rules:
 * - Incomplete config -> `not_configured`, and fetch is never called.
 * - `sent` only when the provider returned a 2xx AND a message id.
 * - Error strings never include credentials.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type SendResult =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'not_configured'; missing: string[] }
  | { status: 'failed'; error: string }

export interface WhatsAppTemplate {
  name: string
  /** e.g. "en_US" — must match an approved template language. */
  languageCode: string
  /** Positional body parameters ({{1}}, {{2}}, ...). */
  bodyParams?: string[]
}

export interface OutboundMessage {
  /** E.164 phone number for WhatsApp/SMS, email address for email. */
  to: string
  /** Plain text body. For WhatsApp, free text only delivers inside the 24h customer-service window. */
  body: string
  /** Email subject. */
  subject?: string
  /** WhatsApp approved template; preferred over free text for business-initiated messages. */
  template?: WhatsAppTemplate
}

export interface MessageSender {
  send(msg: OutboundMessage): Promise<SendResult>
}

const E164_RE = /^\+[1-9]\d{6,14}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function missingKeys(config: Record<string, string | undefined | null>): string[] {
  return Object.entries(config)
    .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    .map(([k]) => k)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Pull a short, credential-free error description out of a provider error body. */
function providerError(status: number, body: unknown): string {
  let detail = ''
  if (isRecord(body)) {
    const err = body.error
    if (isRecord(err) && typeof err.message === 'string') detail = err.message
    else if (typeof body.message === 'string') detail = body.message
  }
  return `Provider returned HTTP ${status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
}

async function safeFetch(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Response | { error: string }> {
  try {
    return await fetchFn(url, init)
  } catch (e) {
    return { error: `Network error: ${e instanceof Error ? e.message : 'request failed'}` }
  }
}

// ───────────────────────── WhatsApp Cloud API ─────────────────────────

export interface WhatsAppConfig {
  phoneNumberId?: string | null
  accessToken?: string | null
  /** Graph API version, default v21.0. */
  apiVersion?: string
}

export class WhatsAppCloudSender implements MessageSender {
  private readonly config: WhatsAppConfig
  private readonly fetchFn: FetchLike

  constructor(config: WhatsAppConfig, fetchFn: FetchLike) {
    this.config = config
    this.fetchFn = fetchFn
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const missing = missingKeys({ WHATSAPP_PHONE_NUMBER_ID: this.config.phoneNumberId, WHATSAPP_ACCESS_TOKEN: this.config.accessToken })
    if (missing.length) return { status: 'not_configured', missing }
    if (!E164_RE.test(msg.to)) return { status: 'failed', error: 'Recipient must be an E.164 phone number' }
    if (!msg.template && !msg.body.trim()) return { status: 'failed', error: 'Message body is empty' }

    const to = msg.to.slice(1) // Cloud API takes digits without "+"
    const payload = msg.template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: msg.template.name,
            language: { code: msg.template.languageCode },
            ...(msg.template.bodyParams?.length
              ? { components: [{ type: 'body', parameters: msg.template.bodyParams.map((text) => ({ type: 'text', text })) }] }
              : {}),
          },
        }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: msg.body } }

    const version = this.config.apiVersion ?? 'v21.0'
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(this.config.phoneNumberId!)}/messages`
    const res = await safeFetch(this.fetchFn, url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if ('error' in res) return { status: 'failed', error: res.error }
    const json = await readJson(res)
    if (!res.ok) return { status: 'failed', error: providerError(res.status, json) }
    const messages = isRecord(json) ? json.messages : null
    const id = Array.isArray(messages) && isRecord(messages[0]) ? messages[0].id : null
    if (typeof id !== 'string' || !id) return { status: 'failed', error: 'Provider response had no message id' }
    return { status: 'sent', providerMessageId: id }
  }
}

// ───────────────────────── Resend (email) ─────────────────────────

export interface ResendConfig {
  apiKey?: string | null
  /** Verified sender, e.g. "Shop <orders@example.com>". */
  from?: string | null
}

export class ResendEmailSender implements MessageSender {
  private readonly config: ResendConfig
  private readonly fetchFn: FetchLike

  constructor(config: ResendConfig, fetchFn: FetchLike) {
    this.config = config
    this.fetchFn = fetchFn
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const missing = missingKeys({ RESEND_API_KEY: this.config.apiKey, RESEND_FROM: this.config.from })
    if (missing.length) return { status: 'not_configured', missing }
    if (!EMAIL_RE.test(msg.to)) return { status: 'failed', error: 'Recipient must be an email address' }
    if (!msg.subject?.trim()) return { status: 'failed', error: 'Email subject is required' }
    if (!msg.body.trim()) return { status: 'failed', error: 'Message body is empty' }

    const res = await safeFetch(this.fetchFn, 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.config.from, to: [msg.to], subject: msg.subject, text: msg.body }),
    })
    if ('error' in res) return { status: 'failed', error: res.error }
    const json = await readJson(res)
    if (!res.ok) return { status: 'failed', error: providerError(res.status, json) }
    const id = isRecord(json) ? json.id : null
    if (typeof id !== 'string' || !id) return { status: 'failed', error: 'Provider response had no message id' }
    return { status: 'sent', providerMessageId: id }
  }
}

// ───────────────────────── Twilio (SMS) ─────────────────────────

export interface TwilioConfig {
  accountSid?: string | null
  authToken?: string | null
  /** E.164 sender number or Messaging Service SID (MG...). */
  from?: string | null
}

export class TwilioSmsSender implements MessageSender {
  private readonly config: TwilioConfig
  private readonly fetchFn: FetchLike

  constructor(config: TwilioConfig, fetchFn: FetchLike) {
    this.config = config
    this.fetchFn = fetchFn
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const missing = missingKeys({
      TWILIO_ACCOUNT_SID: this.config.accountSid,
      TWILIO_AUTH_TOKEN: this.config.authToken,
      TWILIO_FROM: this.config.from,
    })
    if (missing.length) return { status: 'not_configured', missing }
    if (!E164_RE.test(msg.to)) return { status: 'failed', error: 'Recipient must be an E.164 phone number' }
    if (!msg.body.trim()) return { status: 'failed', error: 'Message body is empty' }

    const sid = this.config.accountSid!
    const from = this.config.from!
    const form = new URLSearchParams({ To: msg.to, Body: msg.body })
    if (from.startsWith('MG')) form.set('MessagingServiceSid', from)
    else form.set('From', from)

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`
    const res = await safeFetch(this.fetchFn, url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${this.config.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    if ('error' in res) return { status: 'failed', error: res.error }
    const json = await readJson(res)
    if (!res.ok) return { status: 'failed', error: providerError(res.status, json) }
    const id = isRecord(json) ? json.sid : null
    if (typeof id !== 'string' || !id) return { status: 'failed', error: 'Provider response had no message id' }
    return { status: 'sent', providerMessageId: id }
  }
}

// ───────────────────────── Payment event normalisation ─────────────────────────

export type NormalisedPaymentMethod = 'card' | 'bank_transfer' | 'mobile_money' | 'other'

export interface NormalisedPaymentEvent {
  provider: 'stripe' | 'paystack'
  eventId: string
  type: string
  /** From metadata.akunga_order_id; null if absent or not a UUID. */
  orderId: string | null
  amountMinor: number
  /** Upper-case ISO 4217. */
  currency: string
  externalRef: string
  method: NormalisedPaymentMethod
  receivedAt: string | null
  succeeded: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURRENCY_RE = /^[A-Za-z]{3}$/

/**
 * Currencies where Stripe's integer "amount" does not use the ISO 4217
 * exponent (ISK: ISO exponent 0, Stripe sends 2 decimals). We refuse to
 * normalise these rather than record a wrong amount.
 */
const STRIPE_EXPONENT_MISMATCH = new Set(['ISK'])

function orderIdFrom(metadata: unknown): string | null {
  let meta = metadata
  if (typeof meta === 'string') {
    // Paystack sometimes delivers metadata as a JSON string.
    try {
      meta = JSON.parse(meta)
    } catch {
      return null
    }
  }
  if (!isRecord(meta)) return null
  const id = meta.akunga_order_id
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null
}

function validAmount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

/** Stripe `payment_intent.succeeded` -> normalised event. Anything else -> null. */
export function parseStripeEvent(json: unknown): NormalisedPaymentEvent | null {
  if (!isRecord(json) || json.type !== 'payment_intent.succeeded' || typeof json.id !== 'string') return null
  const data = json.data
  const obj = isRecord(data) ? data.object : null
  if (!isRecord(obj) || typeof obj.id !== 'string' || obj.status !== 'succeeded') return null
  const amount = obj.amount_received ?? obj.amount
  if (!validAmount(amount)) return null
  if (typeof obj.currency !== 'string' || !CURRENCY_RE.test(obj.currency)) return null
  const currency = obj.currency.toUpperCase()
  if (STRIPE_EXPONENT_MISMATCH.has(currency)) return null
  const types = Array.isArray(obj.payment_method_types) ? obj.payment_method_types : []
  const created = typeof obj.created === 'number' ? new Date(obj.created * 1000).toISOString() : null
  return {
    provider: 'stripe',
    eventId: json.id,
    type: json.type,
    orderId: orderIdFrom(obj.metadata),
    amountMinor: amount,
    currency,
    externalRef: obj.id,
    method: types.length === 1 && types[0] === 'card' ? 'card' : 'other',
    receivedAt: created,
    succeeded: true,
  }
}

function paystackMethod(channel: unknown): NormalisedPaymentMethod {
  switch (channel) {
    case 'card':
      return 'card'
    case 'mobile_money':
      return 'mobile_money'
    case 'bank':
    case 'bank_transfer':
    case 'dedicated_nuban':
      return 'bank_transfer'
    default:
      return 'other'
  }
}

/** Paystack `charge.success` -> normalised event (amount is already minor units). Anything else -> null. */
export function parsePaystackEvent(json: unknown): NormalisedPaymentEvent | null {
  if (!isRecord(json) || json.event !== 'charge.success') return null
  const data = json.data
  if (!isRecord(data) || data.status !== 'success') return null
  if (typeof data.reference !== 'string' || !data.reference) return null
  if (!validAmount(data.amount)) return null
  if (typeof data.currency !== 'string' || !CURRENCY_RE.test(data.currency)) return null
  const id = typeof data.id === 'number' || typeof data.id === 'string' ? String(data.id) : data.reference
  const paidAt = typeof data.paid_at === 'string' ? data.paid_at : typeof data.paidAt === 'string' ? data.paidAt : null
  return {
    provider: 'paystack',
    eventId: `charge.success:${id}`,
    type: json.event,
    orderId: orderIdFrom(data.metadata),
    amountMinor: data.amount,
    currency: data.currency.toUpperCase(),
    externalRef: data.reference,
    method: paystackMethod(data.channel),
    receivedAt: paidAt && !Number.isNaN(Date.parse(paidAt)) ? new Date(paidAt).toISOString() : null,
    succeeded: true,
  }
}

/**
 * Stable dedupe key for any Paystack payload (Paystack events carry no event id).
 * Returns null when nothing identifying is present; callers fall back to a body hash.
 */
export function paystackEventKey(json: unknown): string | null {
  if (!isRecord(json) || typeof json.event !== 'string') return null
  const data = json.data
  if (!isRecord(data)) return null
  const id = data.id ?? data.reference
  return typeof id === 'number' || (typeof id === 'string' && id) ? `${json.event}:${id}` : null
}

// ───────────────────────── WhatsApp inbound payloads ─────────────────────────

export interface WhatsAppInboundMessage {
  /** wamid.* — unique per message, used as webhook_events.event_id */
  id: string
  /** Sender as E.164 (with "+"). */
  fromE164: string
  /** Business phone number id that received it. */
  phoneNumberId: string | null
  type: string
  text: string | null
}

export interface WhatsAppStatusUpdate {
  id: string
  status: string
  timestamp: string | null
}

/** Extract inbound messages and delivery statuses from a Cloud API webhook payload. */
export function extractWhatsAppEvents(json: unknown): {
  messages: WhatsAppInboundMessage[]
  statuses: WhatsAppStatusUpdate[]
  entryIds: string[]
} {
  const messages: WhatsAppInboundMessage[] = []
  const statuses: WhatsAppStatusUpdate[] = []
  const entryIds: string[] = []
  if (!isRecord(json) || !Array.isArray(json.entry)) return { messages, statuses, entryIds }
  for (const entry of json.entry) {
    if (!isRecord(entry)) continue
    if (typeof entry.id === 'string') entryIds.push(entry.id)
    const changes = Array.isArray(entry.changes) ? entry.changes : []
    for (const change of changes) {
      const value = isRecord(change) ? change.value : null
      if (!isRecord(value)) continue
      const meta = isRecord(value.metadata) ? value.metadata : null
      const phoneNumberId = meta && typeof meta.phone_number_id === 'string' ? meta.phone_number_id : null
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!isRecord(m) || typeof m.id !== 'string' || typeof m.from !== 'string' || !/^\d{7,15}$/.test(m.from)) continue
        const text = isRecord(m.text) && typeof m.text.body === 'string' ? m.text.body : null
        messages.push({ id: m.id, fromE164: `+${m.from}`, phoneNumberId, type: typeof m.type === 'string' ? m.type : 'unknown', text })
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!isRecord(s) || typeof s.id !== 'string' || typeof s.status !== 'string') continue
        statuses.push({ id: s.id, status: s.status, timestamp: typeof s.timestamp === 'string' ? s.timestamp : null })
      }
    }
  }
  return { messages, statuses, entryIds }
}
