/**
 * Stock levels per variant per location. Mirrors the SQL rules in
 * supabase/migrations: on_hand and reserved never go negative, and
 * reservations can never exceed what is physically on hand.
 */

export interface StockLevel {
  onHand: number
  reserved: number
}

export type StockMovementKind =
  | 'receipt'
  | 'adjustment'
  | 'reservation'
  | 'release'
  | 'sale'
  | 'return'

export const ADJUSTMENT_REASONS = [
  'stock_count',
  'damaged',
  'lost_or_stolen',
  'expired',
  'received_from_supplier',
  'returned_to_supplier',
  'correction',
] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  stock_count: 'Stock count',
  damaged: 'Damaged',
  lost_or_stolen: 'Lost or stolen',
  expired: 'Expired',
  received_from_supplier: 'Received from supplier',
  returned_to_supplier: 'Returned to supplier',
  correction: 'Correction',
}

export class StockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockError'
  }
}

export function available(level: StockLevel): number {
  return level.onHand - level.reserved
}

function qty(n: number): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new StockError('Quantity must be a positive whole number')
  return n
}

export function reserve(level: StockLevel, quantity: number): StockLevel {
  qty(quantity)
  if (available(level) < quantity) {
    throw new StockError(`Only ${Math.max(available(level), 0)} available; cannot reserve ${quantity}`)
  }
  return { onHand: level.onHand, reserved: level.reserved + quantity }
}

export function release(level: StockLevel, quantity: number): StockLevel {
  qty(quantity)
  if (level.reserved < quantity) throw new StockError('Cannot release more than is reserved')
  return { onHand: level.onHand, reserved: level.reserved - quantity }
}

/** Reserved stock leaves the building (dispatch / handover). */
export function commit(level: StockLevel, quantity: number): StockLevel {
  qty(quantity)
  if (level.reserved < quantity) throw new StockError('Cannot commit more than is reserved')
  return { onHand: level.onHand - quantity, reserved: level.reserved - quantity }
}

/** Signed manual adjustment. Refuses to push stock below what is reserved. */
export function adjust(level: StockLevel, delta: number): StockLevel {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new StockError('Adjustment must be a non-zero whole number')
  const onHand = level.onHand + delta
  if (onHand < 0) throw new StockError('Stock cannot go below zero')
  if (onHand < level.reserved) throw new StockError(`${level.reserved} units are reserved for open orders`)
  return { onHand, reserved: level.reserved }
}

export type StockHealth = 'out' | 'low' | 'ok'
export function stockHealth(level: StockLevel, lowThreshold: number): StockHealth {
  const a = available(level)
  if (a <= 0) return 'out'
  if (a <= lowThreshold) return 'low'
  return 'ok'
}
