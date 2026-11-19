import { CurrencyMismatchError, MoneyError, divRoundHalfUp, type CurrencyCode } from './money'

export const ORDER_STATUSES = [
  'draft',
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready',
  'dispatched',
  'delivered',
  'cancelled',
  'refunded',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  pending_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

/**
 * Allowed manual transitions. `refunded` is set automatically when refunds
 * reach the amount paid, never chosen directly. Mirrors SQL `order_transition_allowed`.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['pending_confirmation', 'confirmed', 'cancelled'],
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['dispatched', 'delivered', 'cancelled'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to)
}

/** Stock is reserved while an order is live, committed once it leaves the shop. */
export function holdsReservation(status: OrderStatus): boolean {
  return ['pending_confirmation', 'confirmed', 'preparing', 'ready'].includes(status)
}
export function hasCommittedStock(status: OrderStatus): boolean {
  return ['dispatched', 'delivered', 'refunded'].includes(status)
}

export type TaxMode = 'exclusive' | 'inclusive'

export interface LineInput {
  unitPriceMinor: number
  quantity: number
  /** Tax rate metadata in basis points (16% = 1600). 0 when not configured. */
  taxRateBps: number
  discountMinor?: number
}

export interface LineTotals {
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
}

export interface OrderTotals {
  currency: CurrencyCode
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  lines: LineTotals[]
}

function nonNegInt(n: number, label: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new MoneyError(`${label} must be a non-negative integer`)
  return n
}

export function computeLine(line: LineInput, taxMode: TaxMode): LineTotals {
  const qty = nonNegInt(line.quantity, 'Quantity')
  if (qty === 0) throw new MoneyError('Quantity must be at least 1')
  const unit = nonNegInt(line.unitPriceMinor, 'Unit price')
  const bps = nonNegInt(line.taxRateBps, 'Tax rate')
  const discount = nonNegInt(line.discountMinor ?? 0, 'Discount')
  const gross = unit * qty
  if (discount > gross) throw new MoneyError('Discount cannot exceed the line amount')
  const subtotal = gross - discount
  if (taxMode === 'exclusive') {
    const tax = divRoundHalfUp(subtotal * bps, 10_000)
    return { subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax }
  }
  const tax = bps === 0 ? 0 : divRoundHalfUp(subtotal * bps, 10_000 + bps)
  return { subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal }
}

export function computeOrderTotals(input: {
  currency: CurrencyCode
  taxMode: TaxMode
  lines: (LineInput & { currency: CurrencyCode })[]
  deliveryFeeMinor?: number
}): OrderTotals {
  if (input.lines.length === 0) throw new MoneyError('An order needs at least one line')
  for (const l of input.lines) {
    if (l.currency !== input.currency) throw new CurrencyMismatchError(input.currency, l.currency)
  }
  const lines = input.lines.map((l) => computeLine(l, input.taxMode))
  const delivery = nonNegInt(input.deliveryFeeMinor ?? 0, 'Delivery fee')
  const subtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0)
  const tax = lines.reduce((a, l) => a + l.taxMinor, 0)
  const lineTotal = lines.reduce((a, l) => a + l.totalMinor, 0)
  const discount = input.lines.reduce((a, l) => a + (l.discountMinor ?? 0), 0)
  return {
    currency: input.currency,
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: tax,
    deliveryFeeMinor: delivery,
    totalMinor: lineTotal + delivery,
    lines,
  }
}
