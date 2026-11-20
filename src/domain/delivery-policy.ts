/**
 * Deposit and failed-delivery rules. Pure functions, integer minor units only.
 *
 * The database mirrors these in supabase/migrations/20261120000030_deposits_handoff.sql
 * (`_deposit_due`, `_apply_failed_delivery`) and is the authority in Supabase mode;
 * the demo gateway calls these directly. tests/db/delivery.db.test.ts checks parity.
 */
import { currencyExponent, formatMoney, money } from './money'

export const PAYMENT_MODES = ['pay_on_delivery', 'deposit', 'full_prepay'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]
export type DepositKind = 'percent' | 'fixed'
export type FailedDeliveryPayer = 'buyer' | 'seller'

export interface ShopPolicy {
  /** pay_on_delivery: nothing due before delivery. deposit: part now, rest on delivery. full_prepay: everything before dispatch. */
  paymentMode: PaymentMode
  depositKind: DepositKind
  /** Deposit as basis points of the all-in total (3000 = 30%). Used when depositKind = percent. */
  depositPercentBps: number
  /** Fixed deposit in minor units. Used when depositKind = fixed. */
  depositFixedMinor: number
  /** Deposit applies only to orders whose all-in total is at least this (0 = every order). */
  depositMinOrderMinor: number
  /** Raise the deposit to at least the delivery fee, so a failed trip is always covered. */
  depositCoversDelivery: boolean
  /** Who pays for a failed delivery trip caused by the buyer. */
  failedDeliveryPayer: FailedDeliveryPayer
  /** Delivery attempts before the shop stops trying (1–5). */
  maxDeliveryAttempts: number
}

export const DEFAULT_SHOP_POLICY: ShopPolicy = {
  paymentMode: 'pay_on_delivery',
  depositKind: 'percent',
  depositPercentBps: 3000,
  depositFixedMinor: 0,
  depositMinOrderMinor: 0,
  depositCoversDelivery: true,
  failedDeliveryPayer: 'seller',
  maxDeliveryAttempts: 2,
}

export const MAX_ATTEMPTS_LIMIT = 5

export class PolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyError'
  }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n)

/** Field errors for a policy (empty object = valid). Same rules as save_shop_policy. */
export function validateShopPolicy(p: ShopPolicy): Partial<Record<keyof ShopPolicy, string>> {
  const e: Partial<Record<keyof ShopPolicy, string>> = {}
  if (!PAYMENT_MODES.includes(p.paymentMode)) e.paymentMode = 'Choose how buyers pay.'
  if (p.depositKind !== 'percent' && p.depositKind !== 'fixed') e.depositKind = 'Choose a percentage or a fixed amount.'
  if (!isInt(p.depositPercentBps) || p.depositPercentBps < 100 || p.depositPercentBps > 10000)
    e.depositPercentBps = 'Deposit must be between 1% and 100%.'
  if (!isInt(p.depositFixedMinor) || p.depositFixedMinor < 0) e.depositFixedMinor = 'Enter an amount of zero or more.'
  if (p.paymentMode === 'deposit' && p.depositKind === 'fixed' && p.depositFixedMinor <= 0)
    e.depositFixedMinor = 'Enter a deposit above zero.'
  if (!isInt(p.depositMinOrderMinor) || p.depositMinOrderMinor < 0) e.depositMinOrderMinor = 'Enter an amount of zero or more.'
  if (p.failedDeliveryPayer !== 'buyer' && p.failedDeliveryPayer !== 'seller') e.failedDeliveryPayer = 'Choose who pays.'
  if (!isInt(p.maxDeliveryAttempts) || p.maxDeliveryAttempts < 1 || p.maxDeliveryAttempts > MAX_ATTEMPTS_LIMIT)
    e.maxDeliveryAttempts = `Between 1 and ${MAX_ATTEMPTS_LIMIT} attempts.`
  return e
}

/** Round up to a whole major unit (KES 1, EUR 1, JPY 1, KWD 1) — M-Pesa and cash only take whole amounts. */
export function roundUpToWholeMajor(minor: number, currency: string): number {
  if (!isInt(minor) || minor < 0) throw new PolicyError('Amount must be a non-negative whole number of minor units')
  const unit = 10 ** currencyExponent(currency)
  return Math.ceil(minor / unit) * unit
}

export type DepositRule = 'none' | 'deposit' | 'full' | 'below_threshold'

export interface DepositBreakdown {
  /** Due before the order is dispatched (charged by the payment step). */
  depositDueMinor: number
  /** Paid on delivery or collection. */
  balanceOnDeliveryMinor: number
  rule: DepositRule
}

/**
 * Deposit for an order. `totalMinor` is the all-in total (lines + exclusive tax +
 * delivery), so inclusive and exclusive tax are already reflected. The deposit is
 * rounded up to a whole major unit and never exceeds the total.
 */
export function computeDeposit(policy: ShopPolicy, order: { totalMinor: number; deliveryFeeMinor: number; currency: string }): DepositBreakdown {
  const { totalMinor, deliveryFeeMinor, currency } = order
  if (!isInt(totalMinor) || totalMinor < 0) throw new PolicyError('Total must be a non-negative whole number of minor units')
  if (!isInt(deliveryFeeMinor) || deliveryFeeMinor < 0) throw new PolicyError('Delivery fee must be a non-negative whole number of minor units')
  if (policy.paymentMode === 'full_prepay') return { depositDueMinor: totalMinor, balanceOnDeliveryMinor: 0, rule: 'full' }
  if (policy.paymentMode !== 'deposit' || totalMinor === 0) return { depositDueMinor: 0, balanceOnDeliveryMinor: totalMinor, rule: 'none' }
  if (totalMinor < policy.depositMinOrderMinor) return { depositDueMinor: 0, balanceOnDeliveryMinor: totalMinor, rule: 'below_threshold' }

  let raw = policy.depositKind === 'fixed' ? policy.depositFixedMinor : Math.ceil((totalMinor * policy.depositPercentBps) / 10000)
  if (policy.depositCoversDelivery) raw = Math.max(raw, deliveryFeeMinor)
  const deposit = Math.min(totalMinor, roundUpToWholeMajor(raw, currency))
  return { depositDueMinor: deposit, balanceOnDeliveryMinor: totalMinor - deposit, rule: deposit >= totalMinor ? 'full' : 'deposit' }
}

export interface AmountsDue {
  /** Deposit already covered by net payments (payments minus refunds). */
  depositPaidMinor: number
  depositOutstandingMinor: number
  /** Total minus net paid (never negative). */
  balanceDueMinor: number
  /** What the payment step should charge now: the unpaid deposit, else the remaining balance. */
  dueNowMinor: number
}

export function amountsDue(order: { totalMinor: number; depositDueMinor: number; netPaidMinor: number }): AmountsDue {
  const paid = Math.max(0, order.netPaidMinor)
  const deposit = Math.min(Math.max(0, order.depositDueMinor), order.totalMinor)
  const depositPaidMinor = Math.min(paid, deposit)
  const depositOutstandingMinor = deposit - depositPaidMinor
  const balanceDueMinor = Math.max(0, order.totalMinor - paid)
  return {
    depositPaidMinor,
    depositOutstandingMinor,
    balanceDueMinor,
    dueNowMinor: depositOutstandingMinor > 0 ? depositOutstandingMinor : balanceDueMinor,
  }
}

/* ───────────── Failed delivery ───────────── */

export const FAILED_REASONS = ['buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled', 'rider_issue', 'shop_issue', 'other'] as const
export type FailedReason = (typeof FAILED_REASONS)[number]

/** Only these reasons are the buyer's doing; the shop never keeps a deposit for its own or its rider's failures. */
export const BUYER_FAULT_REASONS: readonly FailedReason[] = ['buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled']

export const FAILED_REASON_LABEL: Record<FailedReason, string> = {
  buyer_unreachable: 'Buyer could not be reached',
  buyer_refused: 'Buyer refused the order',
  wrong_address: 'Wrong or incomplete address',
  buyer_rescheduled: 'Buyer asked to come another time',
  rider_issue: 'Rider could not make it',
  shop_issue: 'Problem on the shop’s side',
  other: 'Other',
}

/** Buyer-facing wording (tracking page). */
export const FAILED_REASON_BUYER_TEXT: Record<FailedReason, string> = {
  buyer_unreachable: 'the rider could not reach you',
  buyer_refused: 'the order was refused at the door',
  wrong_address: 'the rider could not find the address',
  buyer_rescheduled: 'you asked for another time',
  rider_issue: 'the rider could not make it',
  shop_issue: 'of a problem on the shop’s side',
  other: 'of a problem on the way',
}

export interface FailedDeliveryInput {
  /** The policy the buyer agreed to at checkout (null for staff-created orders: the shop absorbs the cost). */
  agreedPolicy: Pick<ShopPolicy, 'failedDeliveryPayer'> | null
  maxAttempts: number
  attemptsSoFar: number
  reason: FailedReason
  deliveryFeeMinor: number
  depositPaidMinor: number
  forfeitedSoFarMinor: number
}

export interface FailedDeliveryOutcome {
  attempt: number
  /** Delivery fee kept from the deposit for this attempt (minor units). */
  forfeitMinor: number
  /** No attempts left after this one. */
  final: boolean
}

export function applyFailedDelivery(i: FailedDeliveryInput): FailedDeliveryOutcome {
  if (!FAILED_REASONS.includes(i.reason)) throw new PolicyError('Choose why the delivery failed')
  if (i.attemptsSoFar >= i.maxAttempts) throw new PolicyError(`All ${i.maxAttempts} delivery attempts have been used`)
  const attempt = i.attemptsSoFar + 1
  const buyerPays = i.agreedPolicy?.failedDeliveryPayer === 'buyer' && BUYER_FAULT_REASONS.includes(i.reason)
  const remainingDeposit = Math.max(0, i.depositPaidMinor - i.forfeitedSoFarMinor)
  const forfeitMinor = buyerPays ? Math.min(Math.max(0, i.deliveryFeeMinor), remainingDeposit) : 0
  return { attempt, forfeitMinor, final: attempt >= i.maxAttempts }
}

/* ───────────── Plain-language policy text ───────────── */

function fmt(minor: number, currency: string, locale: string): string {
  try {
    return formatMoney(money(minor, currency), locale)
  } catch {
    return `${currency} ${minor}`
  }
}

/**
 * The shop's rules in plain words, shown to buyers before they pay and on the
 * tracking page. Generated from the policy so the words always match what the
 * server enforces.
 */
export function policyText(p: ShopPolicy, opts: { currency: string; locale: string; delivers: boolean }): string[] {
  const { currency, locale } = opts
  const lines: string[] = []
  if (p.paymentMode === 'full_prepay') {
    lines.push('Pay the full amount when you order. The shop sends your order once payment is confirmed.')
  } else if (p.paymentMode === 'deposit') {
    const amount = p.depositKind === 'fixed' ? `A deposit of ${fmt(p.depositFixedMinor, currency, locale)}` : `A ${p.depositPercentBps / 100}% deposit`
    const threshold = p.depositMinOrderMinor > 0 ? ` on orders of ${fmt(p.depositMinOrderMinor, currency, locale)} or more` : ''
    const covers = p.depositCoversDelivery && opts.delivers ? ' (at least the delivery fee)' : ''
    lines.push(`${amount}${covers} is due when you order${threshold}. You pay the rest when your order arrives.`)
  } else {
    lines.push('Nothing is due before delivery. You pay when your order arrives or when you collect it.')
  }
  if (opts.delivers) {
    if (p.failedDeliveryPayer === 'buyer') {
      lines.push(
        p.paymentMode === 'pay_on_delivery'
          ? 'If a delivery fails because you could not be reached, refused the order or gave a wrong address, the shop may ask for the delivery fee before trying again.'
          : 'If a delivery fails because you could not be reached, refused the order or gave a wrong address, the delivery fee for that trip is kept from your deposit. The rest of your deposit stays with your order.',
      )
    } else {
      lines.push('If a delivery fails, the shop pays for the return trip. Nothing is kept from your payment.')
    }
    lines.push(
      p.maxDeliveryAttempts === 1
        ? 'The shop makes one delivery attempt.'
        : `The shop makes up to ${p.maxDeliveryAttempts} delivery attempts.`,
    )
    lines.push('Failures caused by the shop or its rider never cost you anything.')
  }
  return lines
}

/* ───────────── Rider links ───────────── */

export const RIDER_LINK_DEFAULT_HOURS = 12
export const RIDER_LINK_MAX_HOURS = 72
/** Tokens are 24 random bytes in base64url: 32 characters. */
export const RIDER_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

export type RiderLinkState = 'active' | 'expired' | 'revoked' | 'invalid'

export function riderLinkState(link: { expiresAt: string; revokedAt: string | null } | null | undefined, now: Date): RiderLinkState {
  if (!link) return 'invalid'
  if (link.revokedAt) return 'revoked'
  const exp = new Date(link.expiresAt).getTime()
  if (!Number.isFinite(exp) || exp <= now.getTime()) return 'expired'
  return 'active'
}

export function isWellFormedRiderToken(token: unknown): token is string {
  return typeof token === 'string' && RIDER_TOKEN_RE.test(token)
}

/** Clamp a requested link lifetime to 1..72 hours (default 12). */
export function riderLinkHours(requested: unknown): number {
  const n = typeof requested === 'number' && Number.isFinite(requested) ? Math.round(requested) : RIDER_LINK_DEFAULT_HOURS
  return Math.min(RIDER_LINK_MAX_HOURS, Math.max(1, n))
}

/** "+254712345678" -> "••• ••• 678". Only the last 3 digits survive (same as SQL `_mask_phone`). */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164) return null
  const digits = e164.replace(/\D/g, '')
  if (digits.length < 7) return '•••'
  return `••• ••• ${digits.slice(-3)}`
}
