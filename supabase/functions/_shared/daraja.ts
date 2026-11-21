/**
 * Safaricom M-Pesa Daraja (Lipa na M-Pesa Online / STK push) adapter.
 * Label: adapter_only. Nothing is connected until Daraja credentials are set,
 * the callback URL is registered and an end-to-end test passes.
 *
 * Runtime-agnostic (fetch, btoa, Intl only) so it runs in Supabase Edge
 * Functions (Deno) and in Node/vitest. Never logs credentials.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type DarajaEnv = 'sandbox' | 'production'
export type StkTransactionType = 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'

export class DarajaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DarajaError'
  }
}

export function darajaBaseUrl(env: DarajaEnv): string {
  return env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
}

/** yyyyMMddHHmmss in Africa/Nairobi (EAT, UTC+3, no DST), as Daraja expects. */
export function darajaTimestamp(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`
}

/** Parse a Daraja yyyyMMddHHmmss (Nairobi time) into an ISO instant, or null. */
export function parseDarajaTimestamp(v: unknown): string | null {
  const str = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(str)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const back = new Date(Date.UTC(y, mo - 1, d, h - 3, mi, s))
  // Reject impossible dates (e.g. month 13) that Date.UTC would silently roll over.
  if (Number.isNaN(back.getTime()) || darajaTimestamp(back) !== str) return null
  return back.toISOString()
}

/** Password = base64(BusinessShortCode + Passkey + Timestamp). */
export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`)
}

/**
 * E.164 Kenyan mobile (+2547XXXXXXXX or +2541XXXXXXXX) -> Daraja's 2547XXXXXXXX
 * form. Returns null for anything else (Daraja only prompts Kenyan lines).
 */
export function toDarajaPhone(e164: string): string | null {
  const m = /^\+254([71]\d{8})$/.exec(String(e164 ?? '').trim())
  return m ? `254${m[1]}` : null
}

export interface StkPushInput {
  shortcode: string
  passkey: string
  transactionType: StkTransactionType
  /** KES minor units (cents). Must be a whole number of shillings: Daraja takes integers only. */
  amountMinor: number
  phoneE164: string
  callbackUrl: string
  /** Shown on the customer's phone; max 12 characters (we use the order number). */
  accountReference: string
  transactionDesc: string
  /** Till number for Buy Goods; defaults to the shortcode (Paybill). */
  partyB?: string
  at?: Date
}

export interface StkPushPayload {
  BusinessShortCode: string
  Password: string
  Timestamp: string
  TransactionType: StkTransactionType
  Amount: number
  PartyA: string
  PartyB: string
  PhoneNumber: string
  CallBackURL: string
  AccountReference: string
  TransactionDesc: string
}

export function buildStkPushPayload(input: StkPushInput): StkPushPayload {
  if (!/^\d{5,8}$/.test(input.shortcode ?? '')) throw new DarajaError('Shortcode must be 5–8 digits')
  if (!input.passkey) throw new DarajaError('Passkey is required')
  if (input.transactionType !== 'CustomerPayBillOnline' && input.transactionType !== 'CustomerBuyGoodsOnline') {
    throw new DarajaError('Unknown transaction type')
  }
  const partyB = input.partyB ?? input.shortcode
  if (!/^\d{5,8}$/.test(partyB)) throw new DarajaError('PartyB must be 5–8 digits')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new DarajaError('Amount must be a positive whole number')
  if (input.amountMinor % 100 !== 0) throw new DarajaError('M-Pesa only accepts whole shillings')
  const phone = toDarajaPhone(input.phoneE164)
  if (!phone) throw new DarajaError('Enter a Kenyan mobile number, e.g. +254712345678')
  let callback: URL
  try {
    callback = new URL(input.callbackUrl)
  } catch {
    throw new DarajaError('Callback URL is invalid')
  }
  if (callback.protocol !== 'https:') throw new DarajaError('Callback URL must be https')
  const ref = String(input.accountReference ?? '').trim()
  if (ref.length < 1 || ref.length > 12) throw new DarajaError('Account reference must be 1–12 characters')
  const timestamp = darajaTimestamp(input.at)
  return {
    BusinessShortCode: input.shortcode,
    Password: darajaPassword(input.shortcode, input.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: input.transactionType,
    Amount: input.amountMinor / 100,
    PartyA: phone,
    PartyB: partyB,
    PhoneNumber: phone,
    CallBackURL: callback.toString(),
    AccountReference: ref,
    TransactionDesc: (String(input.transactionDesc ?? '').trim() || 'Payment').slice(0, 13),
  }
}

/** OAuth client-credentials token. Throws DarajaError without echoing secrets. */
export async function getDarajaToken(fetchImpl: FetchLike, env: DarajaEnv, consumerKey: string, consumerSecret: string): Promise<string> {
  const res = await fetchImpl(`${darajaBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
  })
  if (!res.ok) throw new DarajaError(`Daraja auth failed (${res.status})`)
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null
  if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new DarajaError('Daraja auth returned no token')
  return body.access_token
}

export interface StkPushResult {
  checkoutRequestId: string
  merchantRequestId: string | null
  customerMessage: string | null
}

export async function sendStkPush(fetchImpl: FetchLike, env: DarajaEnv, token: string, payload: StkPushPayload): Promise<StkPushResult> {
  const res = await fetchImpl(`${darajaBaseUrl(env)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const code = body?.ResponseCode
  if (!res.ok || (code !== '0' && code !== 0) || typeof body?.CheckoutRequestID !== 'string') {
    const msg = typeof body?.errorMessage === 'string' ? body.errorMessage : typeof body?.ResponseDescription === 'string' ? body.ResponseDescription : ''
    throw new DarajaError(`STK push rejected (${res.status})${msg ? `: ${msg}` : ''}`)
  }
  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: typeof body.MerchantRequestID === 'string' ? body.MerchantRequestID : null,
    customerMessage: typeof body.CustomerMessage === 'string' ? body.CustomerMessage : null,
  }
}

export interface StkCallback {
  merchantRequestId: string | null
  checkoutRequestId: string
  /** 0 = paid. Anything else (1032 cancelled, 1037 timeout, 2001 wrong PIN, ...) = not paid. */
  resultCode: number
  resultDesc: string
  succeeded: boolean
  /** Whole KES as reported by Daraja (only on success). */
  amount: number | null
  mpesaReceipt: string | null
  phone: string | null
  transactionDate: string | null
}

/** Parse Daraja's STK callback body. Returns null when the shape is not an STK callback. */
export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback
  if (!cb || typeof cb !== 'object') return null
  const checkoutRequestId = cb.CheckoutRequestID
  const resultCode = typeof cb.ResultCode === 'string' ? Number(cb.ResultCode) : cb.ResultCode
  if (typeof checkoutRequestId !== 'string' || !checkoutRequestId || typeof resultCode !== 'number' || !Number.isFinite(resultCode)) return null
  const items = (cb.CallbackMetadata as { Item?: unknown } | undefined)?.Item
  const meta = new Map<string, unknown>()
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it && typeof it === 'object' && typeof (it as { Name?: unknown }).Name === 'string') {
        meta.set((it as { Name: string }).Name, (it as { Value?: unknown }).Value)
      }
    }
  }
  const amountRaw = meta.get('Amount')
  const amount = typeof amountRaw === 'number' ? amountRaw : typeof amountRaw === 'string' && amountRaw.trim() ? Number(amountRaw) : null
  const receipt = meta.get('MpesaReceiptNumber')
  const phone = meta.get('PhoneNumber')
  const succeeded = resultCode === 0
  return {
    merchantRequestId: typeof cb.MerchantRequestID === 'string' ? cb.MerchantRequestID : null,
    checkoutRequestId,
    resultCode,
    resultDesc: typeof cb.ResultDesc === 'string' ? cb.ResultDesc : '',
    succeeded,
    amount: succeeded && amount !== null && Number.isFinite(amount) ? amount : null,
    mpesaReceipt: succeeded && typeof receipt === 'string' && receipt ? receipt : null,
    phone: phone === undefined || phone === null ? null : String(phone),
    transactionDate: parseDarajaTimestamp(meta.get('TransactionDate')),
  }
}

/** Whole KES -> minor units, refusing fractions or non-positive values. */
export function kesToMinor(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return null
  return amount * 100
}

/** Daraja STK ResultCode -> prompt status stored in mpesa_requests (mirrors src/domain/reconciliation.ts). */
export function stkResultStatus(code: number): 'paid' | 'cancelled' | 'timeout' | 'failed' {
  if (code === 0) return 'paid'
  if (code === 1032) return 'cancelled'
  if (code === 1037 || code === 1019) return 'timeout'
  return 'failed'
}

/** Upper-case M-Pesa receipt code (8–12 letters/digits), or null. */
export function normaliseReceipt(v: unknown): string | null {
  const code = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return /^[A-Z0-9]{8,12}$/.test(code) ? code : null
}

/** Last 3 digits only: we never store a customer's full number from a callback. */
export function phoneHintOf(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length >= 6 ? digits.slice(-3) : null
}

/** "1500", "1500.00", 1500 -> 150000 minor units; refuses fractions of a cent and non-positive values. */
export function kesDecimalToMinor(v: unknown): number | null {
  const str = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(str)
  if (!m) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
  return minor > 0 ? minor : null
}

export interface C2bConfirmation {
  transId: string
  transactionType: string | null
  amountMinor: number
  shortcode: string
  /** BillRefNumber: the account number typed for a Paybill; usually empty for a Till. */
  accountRef: string | null
  transactedAt: string | null
  /** First name + last 3 digits, for display only. */
  payerHint: string | null
}

/**
 * Parse a Daraja C2B confirmation body (TransID, TransTime, TransAmount,
 * BusinessShortCode, BillRefNumber, MSISDN, FirstName). Returns null when the
 * shape is wrong. Newer Daraja versions mask MSISDN; we keep only a hint anyway.
 */
export function parseC2bConfirmation(body: unknown): C2bConfirmation | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const transId = normaliseReceipt(b.TransID)
  const amountMinor = kesDecimalToMinor(b.TransAmount)
  const rawCode = b.BusinessShortCode
  const shortcode = typeof rawCode === 'number' ? String(rawCode) : typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!transId || amountMinor === null || !/^\d{5,8}$/.test(shortcode)) return null
  const ref = typeof b.BillRefNumber === 'string' ? b.BillRefNumber.trim().slice(0, 40) : ''
  const first = typeof b.FirstName === 'string' ? b.FirstName.trim().slice(0, 40) : ''
  const digits = phoneHintOf(b.MSISDN)
  const hint = [first, digits ? `···${digits}` : ''].filter(Boolean).join(' ')
  return {
    transId,
    transactionType: typeof b.TransactionType === 'string' ? b.TransactionType : null,
    amountMinor,
    shortcode,
    accountRef: ref || null,
    transactedAt: parseDarajaTimestamp(b.TransTime),
    payerHint: hint || null,
  }
}

/* ───────────── STK Push Query (fallback when a callback never arrives) ───────────── */

export interface StkQueryPayload {
  BusinessShortCode: string
  Password: string
  Timestamp: string
  CheckoutRequestID: string
}

export function buildStkQueryPayload(input: { shortcode: string; passkey: string; checkoutRequestId: string; at?: Date }): StkQueryPayload {
  if (!/^\d{5,8}$/.test(input.shortcode ?? '')) throw new DarajaError('Shortcode must be 5–8 digits')
  if (!input.passkey) throw new DarajaError('Passkey is required')
  const id = String(input.checkoutRequestId ?? '').trim()
  if (id.length < 1 || id.length > 100) throw new DarajaError('CheckoutRequestID is required')
  const timestamp = darajaTimestamp(input.at)
  return {
    BusinessShortCode: input.shortcode,
    Password: darajaPassword(input.shortcode, input.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: id,
  }
}

/**
 * What an STK Push Query told us. It never carries a receipt number or an amount,
 * so even `result` with code 0 is not proof of a payment we can record.
 *   result      Daraja knows the outcome (ResultCode)
 *   processing  Daraja says the transaction is still being processed
 *   error       the query itself failed (auth, rate limit, unknown request, network)
 */
export type StkQueryResult =
  | { kind: 'result'; resultCode: number; resultDesc: string }
  | { kind: 'processing' }
  | { kind: 'error'; message: string }

/** Parse a Daraja STK query HTTP response (status + JSON body). Pure. */
export function parseStkQueryResponse(httpStatus: number, body: unknown): StkQueryResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const rawCode = b?.ResultCode
  const code = typeof rawCode === 'string' && rawCode.trim() !== '' ? Number(rawCode) : typeof rawCode === 'number' ? rawCode : NaN
  const responseOk = b?.ResponseCode === '0' || b?.ResponseCode === 0
  if (httpStatus >= 200 && httpStatus < 300 && responseOk && Number.isInteger(code)) {
    return { kind: 'result', resultCode: code, resultDesc: typeof b?.ResultDesc === 'string' ? b.ResultDesc.slice(0, 300) : '' }
  }
  // Daraja answers an in-flight request with errorCode 500.001.1001 ("The transaction is being processed").
  // Not verified against a live sandbox; anything else unexpected is treated as an error (prompt stays pending).
  const errorCode = typeof b?.errorCode === 'string' ? b.errorCode : ''
  const errorMessage = typeof b?.errorMessage === 'string' ? b.errorMessage : ''
  if (errorCode === '500.001.1001' || /being processed/i.test(errorMessage)) return { kind: 'processing' }
  return { kind: 'error', message: `STK query failed (${httpStatus})${errorMessage ? `: ${errorMessage.slice(0, 200)}` : ''}` }
}

export async function queryStkPush(fetchImpl: FetchLike, env: DarajaEnv, token: string, payload: StkQueryPayload): Promise<StkQueryResult> {
  let res: Response
  try {
    res = await fetchImpl(`${darajaBaseUrl(env)}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { kind: 'error', message: 'STK query network error' }
  }
  const body = await res.json().catch(() => null)
  return parseStkQueryResponse(res.status, body)
}

/**
 * Query answer -> what apply_mpesa_stk_query should do (mirrors the SQL in
 * 20261120000061 and decideStkQuery in src/domain/reconciliation.ts).
 * `awaiting_receipt` never records money: the query has no receipt and no amount.
 */
export type StkQueryAction =
  | { action: 'awaiting_receipt'; resultCode: 0; resultDesc: string }
  | { action: 'resolve'; status: 'cancelled' | 'timeout' | 'failed'; resultCode: number; resultDesc: string }
  | { action: 'keep_pending' }

export function stkQueryAction(result: StkQueryResult): StkQueryAction {
  if (result.kind !== 'result') return { action: 'keep_pending' }
  const status = stkResultStatus(result.resultCode)
  if (status === 'paid') return { action: 'awaiting_receipt', resultCode: 0, resultDesc: result.resultDesc }
  return { action: 'resolve', status, resultCode: result.resultCode, resultDesc: result.resultDesc }
}

/** Arguments for public.apply_mpesa_stk_query. keep_pending sends a null result code (bookkeeping only). */
export function stkQueryRpcArgs(checkoutRequestId: string, action: StkQueryAction) {
  return {
    p_checkout_request_id: checkoutRequestId,
    p_result_code: action.action === 'keep_pending' ? null : action.resultCode,
    p_result_desc: action.action === 'keep_pending' ? null : action.resultDesc,
  }
}
