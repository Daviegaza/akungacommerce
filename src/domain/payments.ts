import { CurrencyMismatchError, MoneyError, type CurrencyCode } from './money'

/**
 * How we know a payment happened.
 * - manual_unverified: a team member typed it in (cash, bank slip, M-Pesa SMS...). Not proven.
 * - provider_verified: confirmed by a signature-verified provider webhook or API lookup.
 */
export type PaymentVerification = 'manual_unverified' | 'provider_verified'
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'reversed'

export interface PaymentRecord {
  id: string
  amountMinor: number
  currency: CurrencyCode
  status: PaymentStatus
  verification: PaymentVerification
}

export interface RefundRecord {
  id: string
  paymentId: string
  amountMinor: number
  currency: CurrencyCode
  status: 'succeeded' | 'pending' | 'failed'
}

export type OrderPaymentState =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overpaid'
  | 'partially_refunded'
  | 'refunded'

export interface PaymentSummary {
  currency: CurrencyCode
  totalMinor: number
  paidMinor: number
  paidUnverifiedMinor: number
  refundedMinor: number
  netPaidMinor: number
  balanceDueMinor: number
  state: OrderPaymentState
}

export function summarisePayments(
  order: { totalMinor: number; currency: CurrencyCode },
  payments: PaymentRecord[],
  refunds: RefundRecord[],
): PaymentSummary {
  for (const p of payments) if (p.currency !== order.currency) throw new CurrencyMismatchError(order.currency, p.currency)
  for (const r of refunds) if (r.currency !== order.currency) throw new CurrencyMismatchError(order.currency, r.currency)
  const ok = payments.filter((p) => p.status === 'succeeded')
  const paid = ok.reduce((a, p) => a + p.amountMinor, 0)
  const unverified = ok.filter((p) => p.verification === 'manual_unverified').reduce((a, p) => a + p.amountMinor, 0)
  const refunded = refunds.filter((r) => r.status === 'succeeded').reduce((a, r) => a + r.amountMinor, 0)
  const net = paid - refunded
  let state: OrderPaymentState
  if (refunded > 0 && net <= 0) state = 'refunded'
  else if (refunded > 0) state = 'partially_refunded'
  else if (paid === 0) state = 'unpaid'
  else if (paid < order.totalMinor) state = 'partially_paid'
  else if (paid === order.totalMinor) state = 'paid'
  else state = 'overpaid'
  return {
    currency: order.currency,
    totalMinor: order.totalMinor,
    paidMinor: paid,
    paidUnverifiedMinor: unverified,
    refundedMinor: refunded,
    netPaidMinor: net,
    balanceDueMinor: Math.max(order.totalMinor - net, 0),
    state,
  }
}

/** Maximum that can still be refunded against one payment. */
export function refundableMinor(payment: PaymentRecord, refunds: RefundRecord[]): number {
  if (payment.status !== 'succeeded') return 0
  const already = refunds
    .filter((r) => r.paymentId === payment.id && r.status !== 'failed')
    .reduce((a, r) => a + r.amountMinor, 0)
  return Math.max(payment.amountMinor - already, 0)
}

export function validateRefund(
  payment: PaymentRecord,
  refunds: RefundRecord[],
  amountMinor: number,
  currency: CurrencyCode,
): void {
  if (currency !== payment.currency) throw new CurrencyMismatchError(payment.currency, currency)
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new MoneyError('Refund amount must be positive')
  const max = refundableMinor(payment, refunds)
  if (amountMinor > max) throw new MoneyError('Refund exceeds the amount still refundable on this payment')
}
