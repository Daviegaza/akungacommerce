/**
 * M-Pesa reconciliation rules (pure, no I/O).
 *
 * The database enforces the same rules inside `reconcile_mpesa_stk`,
 * `reconcile_mpesa_c2b` and `attach_mpesa_receipt`
 * (supabase/migrations/20261120000020_mpesa_reconciliation.sql); the demo
 * gateway calls these functions directly. Keep both in step.
 *
 * Core rule: an order is only ever marked paid from a verified provider
 * callback whose amount equals what was asked for and fits the balance due.
 * Anything else is kept for a person to review, never silently accepted.
 */
import type { OrderStatus } from './orders'

export const COLLECTIONS_PROVIDERS = ['manual', 'daraja', 'aggregator'] as const
export type CollectionsProviderId = (typeof COLLECTIONS_PROVIDERS)[number]

/**
 * Lifecycle of one STK prompt (mpesa_requests.status).
 * awaiting_receipt: Daraja's STK Push Query said the customer paid, but the query
 * carries no receipt or amount, so nothing is recorded until the receipt arrives.
 */
export const PROMPT_STATUSES = ['pending', 'awaiting_receipt', 'paid', 'cancelled', 'timeout', 'failed', 'mismatch', 'late'] as const
export type PromptStatus = (typeof PROMPT_STATUSES)[number]

/** Lifecycle of one verified M-Pesa receipt (mpesa_receipts.status). */
export const RECEIPT_STATUSES = ['matched', 'unmatched', 'mismatch', 'late', 'attached', 'dismissed'] as const
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number]

/** Receipts that still need a person: shown in the unmatched queue. */
export const NEEDS_REVIEW: readonly ReceiptStatus[] = ['unmatched', 'mismatch', 'late']

/** Statuses an order can be in and still accept money. */
const CLOSED: readonly OrderStatus[] = ['draft', 'cancelled', 'refunded']

export function isReviewable(status: ReceiptStatus): boolean {
  return NEEDS_REVIEW.includes(status)
}

/**
 * Daraja STK ResultCode -> prompt outcome.
 * 0 paid · 1032 cancelled by the customer · 1037 phone unreachable / no response ·
 * 1019 transaction expired · anything else (1 insufficient funds, 2001 wrong PIN, ...) failed.
 */
export function classifyResultCode(code: number): 'paid' | 'cancelled' | 'timeout' | 'failed' {
  if (code === 0) return 'paid'
  if (code === 1032) return 'cancelled'
  if (code === 1037 || code === 1019) return 'timeout'
  return 'failed'
}

/** Plain-language outcome for the buyer. Never says "paid" unless it is. */
export function buyerPromptMessage(status: PromptStatus, resultCode: number | null = null): { title: string; body: string } {
  switch (status) {
    case 'pending':
      return { title: 'Check your phone', body: 'Enter your M-Pesa PIN on the prompt. This page updates by itself.' }
    case 'awaiting_receipt':
      return {
        title: 'M-Pesa says you paid',
        body: 'We are waiting for the M-Pesa receipt before marking the order paid. Please do not pay again; this page updates by itself.',
      }
    case 'paid':
      return { title: 'Payment received', body: 'M-Pesa confirmed your payment. You will get an SMS from M-Pesa too.' }
    case 'cancelled':
      return { title: 'You cancelled the prompt', body: 'Nothing was charged. You can send a new prompt or pay with the Till or Paybill.' }
    case 'timeout':
      return {
        title: 'The prompt expired',
        body: 'No PIN was entered in time, or your phone could not be reached. Nothing was charged. Keep your phone unlocked and try again.',
      }
    case 'failed':
      if (resultCode === 1) return { title: 'Not enough M-Pesa balance', body: 'Nothing was charged. Top up, or use Fuliza, then try again.' }
      if (resultCode === 2001) return { title: 'Wrong PIN', body: 'Nothing was charged. Send a new prompt and enter your M-Pesa PIN again.' }
      return { title: 'M-Pesa could not complete the payment', body: 'Nothing was charged. Try again in a minute, or pay with the Till or Paybill.' }
    case 'mismatch':
      return {
        title: 'Payment received, the shop is checking it',
        body: 'The amount was different from the order total, so the shop will confirm it by hand. Please do not pay again.',
      }
    case 'late':
      return {
        title: 'Payment received, the shop is checking it',
        body: 'This order was already paid or closed when your payment arrived. The shop will sort it out with you. Please do not pay again.',
      }
  }
}

/** M-Pesa receipt codes are 10 upper-case letters/digits today; allow 8–12 for safety. */
export function normaliseReceiptCode(input: string | null | undefined): string | null {
  const code = String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  return /^[A-Z0-9]{8,12}$/.test(code) ? code : null
}

/** Keep only the last 3 digits of a phone number for display (never store the full number). */
export function phoneHint(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.length >= 6 ? digits.slice(-3) : null
}

export interface ReconOrder {
  status: OrderStatus
  currency: string
  totalMinor: number
  /** Succeeded payments minus succeeded refunds. */
  netPaidMinor: number
}

export interface ReconRequest {
  status: PromptStatus
  amountMinor: number
}

export interface StkCallbackFacts {
  resultCode: number
  /** Minor units (KES cents) as reported by the provider, or null. */
  amountMinor: number | null
  receipt: string | null
}

export type ReviewReason =
  | 'order_closed'
  | 'currency'
  | 'amount_differs'
  | 'already_paid'
  | 'no_order_ref'
  | 'order_not_found'
  | 'balance_differs'
  | 'transfer_currency'
  | 'no_single_order'

export type StkDecision =
  | { kind: 'unknown_request' }
  | { kind: 'duplicate' }
  | { kind: 'invalid' }
  | { kind: 'not_paid'; promptStatus: 'cancelled' | 'timeout' | 'failed' }
  | { kind: 'review'; promptStatus: 'mismatch' | 'late'; receiptStatus: 'mismatch' | 'late'; reason: ReviewReason }
  | { kind: 'record'; amountMinor: number; fullyPaid: boolean; autoConfirm: boolean }

const RESOLVED_PAID: readonly PromptStatus[] = ['paid', 'mismatch', 'late']

export function outstandingMinor(order: ReconOrder): number {
  return order.totalMinor - order.netPaidMinor
}

/**
 * Decide what a verified STK callback does. Idempotent by construction:
 * a receipt already on file, or a request already resolved with money, is a duplicate.
 *
 * A success that arrives after the prompt was marked cancelled/timed out (late
 * callback) is still evaluated, because the customer's money really moved.
 */
export function decideStkCallback(input: {
  request: ReconRequest | null
  order: ReconOrder | null
  receiptKnown: boolean
  callback: StkCallbackFacts
}): StkDecision {
  const { request, order, receiptKnown, callback } = input
  if (!request) return { kind: 'unknown_request' }
  const outcome = classifyResultCode(callback.resultCode)
  if (outcome !== 'paid') {
    // Only the first word on a pending prompt counts; later failures are noise.
    return request.status === 'pending' ? { kind: 'not_paid', promptStatus: outcome } : { kind: 'duplicate' }
  }
  const amount = callback.amountMinor
  if (!callback.receipt || normaliseReceiptCode(callback.receipt) === null || amount === null || !Number.isSafeInteger(amount) || amount <= 0) {
    return { kind: 'invalid' }
  }
  if (receiptKnown || RESOLVED_PAID.includes(request.status)) return { kind: 'duplicate' }
  if (!order || CLOSED.includes(order.status)) {
    return { kind: 'review', promptStatus: 'late', receiptStatus: 'late', reason: 'order_closed' }
  }
  if (order.currency !== 'KES') return { kind: 'review', promptStatus: 'mismatch', receiptStatus: 'mismatch', reason: 'currency' }
  if (amount !== request.amountMinor) {
    return { kind: 'review', promptStatus: 'mismatch', receiptStatus: 'mismatch', reason: 'amount_differs' }
  }
  const due = outstandingMinor(order)
  if (amount > due) return { kind: 'review', promptStatus: 'late', receiptStatus: 'late', reason: 'already_paid' }
  const fullyPaid = amount === due
  return { kind: 'record', amountMinor: amount, fullyPaid, autoConfirm: fullyPaid && order.status === 'pending_confirmation' }
}

export type C2bDecision =
  | { kind: 'duplicate' }
  | { kind: 'unmatched'; reason: ReviewReason }
  | { kind: 'record'; amountMinor: number; fullyPaid: boolean; autoConfirm: boolean }

/** Account reference typed by the customer -> order number, or null. Accepts "1042", "#1042", " 1042 ". */
export function orderNumberFromRef(ref: string | null | undefined): number | null {
  const m = /^#?\s*(\d{1,9})$/.exec(String(ref ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

/**
 * A direct Till/Paybill payment (C2B confirmation). It is matched automatically
 * only when the account reference names a live KES order AND the amount equals
 * its whole balance due, or the amount due now (an unpaid deposit). Everything else goes to the unmatched queue.
 */
export function decideC2bReceipt(input: {
  receiptKnown: boolean
  accountRef: string | null
  order: ReconOrder | null
  amountMinor: number
  /** Unpaid deposit (or balance) due now; deposits confirm the order like full payment. */
  dueNowMinor?: number
}): C2bDecision {
  if (input.receiptKnown) return { kind: 'duplicate' }
  if (orderNumberFromRef(input.accountRef) === null) return { kind: 'unmatched', reason: 'no_order_ref' }
  const order = input.order
  if (!order) return { kind: 'unmatched', reason: 'order_not_found' }
  if (CLOSED.includes(order.status)) return { kind: 'unmatched', reason: 'order_closed' }
  if (order.currency !== 'KES') return { kind: 'unmatched', reason: 'currency' }
  const outstanding = outstandingMinor(order)
  const isDueNow = input.dueNowMinor !== undefined && input.dueNowMinor > 0 && input.amountMinor === input.dueNowMinor
  if (input.amountMinor !== outstanding && !isDueNow) return { kind: 'unmatched', reason: 'balance_differs' }
  const fullyPaid = input.amountMinor === outstanding
  return { kind: 'record', amountMinor: input.amountMinor, fullyPaid, autoConfirm: order.status === 'pending_confirmation' }
}

/** Staff attaching a queued receipt to an order. Returns an error message, or null when allowed. */
export function validateAttach(receipt: { status: ReceiptStatus; amountMinor: number; currency: string }, order: ReconOrder): string | null {
  if (!isReviewable(receipt.status)) return 'This payment has already been resolved'
  if (CLOSED.includes(order.status)) return 'Payments cannot be attached to a draft, cancelled or refunded order'
  if (order.currency !== receipt.currency) return `This order is in ${order.currency}; the payment is in ${receipt.currency}`
  if (receipt.amountMinor > outstandingMinor(order)) return 'This payment is more than the balance due on that order'
  return null
}

export const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  order_closed: 'The order was cancelled or closed before the payment arrived',
  currency: 'The order is not in KES',
  amount_differs: 'The amount paid differs from the amount requested',
  already_paid: 'The order was already paid; this is an extra payment',
  no_order_ref: 'No order number in the account reference',
  order_not_found: 'No order with that number',
  balance_differs: 'The amount does not equal the deposit or balance due',
  transfer_currency: "The transfer is not in the order's currency",
  no_single_order: 'No single open order for this customer is due exactly this amount',
}

/** Note written into the order's status history when a verified payment confirms it. */
export function confirmNote(receipt: string): string {
  return `Paid in full by M-Pesa (verified receipt ${receipt})`
}

export type ReceiptVerification =
  | { state: 'invalid_format' }
  | { state: 'not_verifiable'; provider: CollectionsProviderId; alsoRecordedManuallyOn: number[] }
  | { state: 'not_found'; alsoRecordedManuallyOn: number[] }
  | {
      state: 'verified'
      receipt: {
        code: string
        status: ReceiptStatus
        amountMinor: number
        currency: string
        transactedAt: string
        orderNumber: number | null
        payerHint: string | null
        source: 'stk' | 'c2b' | 'aggregator' | 'bank_transfer'
      }
      alsoRecordedManuallyOn: number[]
    }

/**
 * Turn a lookup into a verdict. In manual mode nothing reports to Rafu, so a
 * code can never be confirmed automatically — say so instead of guessing.
 */
export function verdictFor(input: {
  code: string
  provider: CollectionsProviderId
  found: Extract<ReceiptVerification, { state: 'verified' }>['receipt'] | null
  manualOrderNumbers: number[]
}): ReceiptVerification {
  if (normaliseReceiptCode(input.code) === null) return { state: 'invalid_format' }
  if (input.found) return { state: 'verified', receipt: input.found, alsoRecordedManuallyOn: input.manualOrderNumbers }
  if (input.provider === 'manual') return { state: 'not_verifiable', provider: 'manual', alsoRecordedManuallyOn: input.manualOrderNumbers }
  return { state: 'not_found', alsoRecordedManuallyOn: input.manualOrderNumbers }
}

/* ───────────── STK Push Query fallback ───────────── */

export type StkQueryDecision =
  | { kind: 'unknown_request' }
  | { kind: 'noop' }
  | { kind: 'still_pending' }
  /** Never records money: the query has no receipt and no amount. */
  | { kind: 'awaiting_receipt' }
  | { kind: 'not_paid'; promptStatus: 'cancelled' | 'timeout' | 'failed' }

/**
 * Apply one Daraja STK Push Query answer to a prompt (mirrors apply_mpesa_stk_query,
 * 20261120000061). resultCode null = Daraja could not say yet (processing / query error).
 */
export function decideStkQuery(prompt: { status: PromptStatus } | null, resultCode: number | null): StkQueryDecision {
  if (!prompt) return { kind: 'unknown_request' }
  if (prompt.status !== 'pending') return { kind: 'noop' }
  if (resultCode === null) return { kind: 'still_pending' }
  const outcome = classifyResultCode(resultCode)
  return outcome === 'paid' ? { kind: 'awaiting_receipt' } : { kind: 'not_paid', promptStatus: outcome }
}

/** Prompts the scheduler should query: pending for more than 2 minutes and less than 24 hours, at most every 2 minutes. */
export function isDueForStkQuery(prompt: { status: PromptStatus; createdAt: string; lastQueriedAt?: string | null }, now: Date): boolean {
  if (prompt.status !== 'pending') return false
  const age = now.getTime() - Date.parse(prompt.createdAt)
  if (!(age > 2 * 60_000 && age < 24 * 3_600_000)) return false
  return !prompt.lastQueriedAt || now.getTime() - Date.parse(prompt.lastQueriedAt) > 2 * 60_000
}

/* ───────────── Bank transfer (NGN dedicated virtual accounts) ───────────── */

export type BankTransferDecision =
  | { kind: 'invalid' }
  | { kind: 'unknown_account' }
  | { kind: 'duplicate' }
  | { kind: 'unmatched'; reason: ReviewReason; orderId: string | null }
  | { kind: 'record'; orderId: string; amountMinor: number; fullyPaid: boolean; autoConfirm: boolean }

export interface BankTransferCandidate extends ReconOrder {
  id: string
  /** Unpaid deposit first, else the balance (order_amount_due_now). */
  dueNowMinor: number
}

/** Paystack references: letters, digits and _ . = - (4–100 characters). */
export function isTransferReference(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.=-]{3,99}$/.test(ref)
}

/**
 * A verified transfer into a dedicated account (mirrors reconcile_bank_transfer,
 * 20261120000060). Same amount rule as a direct M-Pesa payment: recorded only when it
 * equals the amount due now (unpaid deposit) or the full balance; otherwise queued.
 *
 * mapping.orderId set: the account belongs to that order. Otherwise it belongs to a
 * customer and `candidates` are that customer's orders: matched only when exactly one
 * open order in the transfer currency is due exactly this amount.
 */
export function decideBankTransfer(input: {
  reference: string
  amountMinor: number
  currency: string
  mapping: { orderId: string | null } | null
  referenceKnown: boolean
  candidates: BankTransferCandidate[]
}): BankTransferDecision {
  if (!isTransferReference(input.reference) || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return { kind: 'invalid' }
  if (!input.mapping) return { kind: 'unknown_account' }
  if (input.referenceKnown) return { kind: 'duplicate' }
  const fits = (o: BankTransferCandidate) => input.amountMinor === outstandingMinor(o) || (o.dueNowMinor > 0 && input.amountMinor === o.dueNowMinor)
  const mappedId = input.mapping.orderId
  let order: BankTransferCandidate | undefined
  if (mappedId) {
    order = input.candidates.find((o) => o.id === mappedId)
    if (!order) return { kind: 'unmatched', reason: 'order_not_found', orderId: null }
  } else {
    const open = input.candidates.filter((o) => !CLOSED.includes(o.status) && o.currency === input.currency && fits(o))
    if (open.length !== 1) return { kind: 'unmatched', reason: 'no_single_order', orderId: null }
    order = open[0]
  }
  const queued = (reason: ReviewReason): BankTransferDecision => ({ kind: 'unmatched', reason, orderId: mappedId })
  if (CLOSED.includes(order.status)) return queued('order_closed')
  if (input.currency !== 'NGN' || order.currency !== input.currency) return queued('transfer_currency')
  if (!fits(order)) return queued('balance_differs')
  const fullyPaid = input.amountMinor === outstandingMinor(order)
  return { kind: 'record', orderId: order.id, amountMinor: input.amountMinor, fullyPaid, autoConfirm: order.status === 'pending_confirmation' }
}
