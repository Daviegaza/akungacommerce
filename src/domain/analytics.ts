import { businessDate } from './locale'
import { stockHealth } from './inventory'
import { divRoundHalfUp, type CurrencyCode } from './money'
import type { OrderStatus } from './orders'
import type { OrderChannel, OrderSummary, Payment, Product, Refund } from '@/gateway/types'

/**
 * Pure reporting maths. Every figure is grouped by currency and amounts in
 * different currencies are never added together or converted. Days are
 * business days in the organisation's time zone, not UTC days.
 */

export type RangeKey = 'today' | '7d' | '30d' | '90d'

export const RANGE_DAYS: Record<RangeKey, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 }

/** Inclusive range of business dates, formatted YYYY-MM-DD. */
export interface DateRange {
  from: string
  to: string
}

/** Statuses that never count as a sale. */
const EXCLUDED: readonly OrderStatus[] = ['draft', 'cancelled']

export interface CurrencyMetrics {
  currency: CurrencyCode
  /** Orders placed in range, excluding drafts and cancelled orders. */
  orders: number
  grossSalesMinor: number
  /** Succeeded refunds recorded in range. */
  refundsMinor: number
  netSalesMinor: number
  /** Gross sales / orders, rounded half up to a whole minor unit. 0 when there are no orders. */
  averageOrderMinor: number
  /** Succeeded payments received in range that were typed in by the team and are not verified. */
  unverifiedPaymentsMinor: number
}

export interface ChannelRow {
  channel: OrderChannel
  orders: number
  grossSalesMinor: number
}

export interface DailyPoint {
  date: string
  orders: number
  grossSalesMinor: number
}

export interface CurrencyReport {
  metrics: CurrencyMetrics
  channels: ChannelRow[]
  /** One point per business day in the range, zero-filled. */
  daily: DailyPoint[]
}

export interface StockHealthCounts {
  ok: number
  low: number
  out: number
  untracked: number
}

export interface AnalyticsReport {
  range: DateRange
  currencies: CurrencyReport[]
  stock: StockHealthCounts
}

/* ───────────── Dates ───────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Shift a YYYY-MM-DD calendar date by whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}"`)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Range ending on today's business date in `timezone`, `today` included. */
export function rangeFor(key: RangeKey, now: Date, timezone: string): DateRange {
  const to = businessDate(now.toISOString(), timezone)
  return { from: addDays(to, -(RANGE_DAYS[key] - 1)), to }
}

/** Every business date in the range, oldest first. */
export function daysIn(range: DateRange): string[] {
  const out: string[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d)
  return out
}

function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to
}

/* ───────────── Stock ───────────── */

/** Counts active variants of non-archived products by stock health. */
export function stockHealthCounts(products: Product[]): StockHealthCounts {
  const out: StockHealthCounts = { ok: 0, low: 0, out: 0, untracked: 0 }
  for (const p of products) {
    if (p.status === 'archived') continue
    for (const v of p.variants) {
      if (!v.isActive) continue
      if (!p.trackStock) {
        out.untracked += 1
        continue
      }
      out[stockHealth({ onHand: v.onHand, reserved: v.reserved }, v.lowStockThreshold)] += 1
    }
  }
  return out
}

/* ───────────── Report ───────────── */

export interface AnalyticsInput {
  orders: OrderSummary[]
  refunds: Refund[]
  payments: Payment[]
  products: Product[]
  timezone: string
  range: DateRange
  /** Listed first when present; remaining currencies follow alphabetically. */
  baseCurrency?: CurrencyCode
}

interface Bucket {
  orders: number
  gross: number
  refunds: number
  unverified: number
  channels: Map<OrderChannel, { orders: number; gross: number }>
  daily: Map<string, { orders: number; gross: number }>
}

function emptyBucket(): Bucket {
  return { orders: 0, gross: 0, refunds: 0, unverified: 0, channels: new Map(), daily: new Map() }
}

export function buildAnalytics(input: AnalyticsInput): AnalyticsReport {
  const { range, timezone } = input
  const buckets = new Map<CurrencyCode, Bucket>()
  const bucket = (currency: CurrencyCode) => {
    let b = buckets.get(currency)
    if (!b) {
      b = emptyBucket()
      buckets.set(currency, b)
    }
    return b
  }

  for (const o of input.orders) {
    if (EXCLUDED.includes(o.status)) continue
    const day = businessDate(o.createdAt, timezone)
    if (!inRange(day, range)) continue
    const b = bucket(o.currency)
    b.orders += 1
    b.gross += o.totalMinor
    const ch = b.channels.get(o.channel) ?? { orders: 0, gross: 0 }
    ch.orders += 1
    ch.gross += o.totalMinor
    b.channels.set(o.channel, ch)
    const d = b.daily.get(day) ?? { orders: 0, gross: 0 }
    d.orders += 1
    d.gross += o.totalMinor
    b.daily.set(day, d)
  }

  for (const r of input.refunds) {
    if (r.status !== 'succeeded') continue
    if (!inRange(businessDate(r.createdAt, timezone), range)) continue
    bucket(r.currency).refunds += r.amountMinor
  }

  for (const p of input.payments) {
    if (p.status !== 'succeeded' || p.verification !== 'manual_unverified') continue
    if (!inRange(businessDate(p.receivedAt, timezone), range)) continue
    bucket(p.currency).unverified += p.amountMinor
  }

  const days = daysIn(range)
  const currencies = [...buckets.keys()].sort((a, b) => {
    if (a === input.baseCurrency) return -1
    if (b === input.baseCurrency) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })

  return {
    range,
    stock: stockHealthCounts(input.products),
    currencies: currencies.map((currency) => {
      const b = buckets.get(currency)!
      return {
        metrics: {
          currency,
          orders: b.orders,
          grossSalesMinor: b.gross,
          refundsMinor: b.refunds,
          netSalesMinor: b.gross - b.refunds,
          averageOrderMinor: b.orders > 0 ? divRoundHalfUp(b.gross, b.orders) : 0,
          unverifiedPaymentsMinor: b.unverified,
        },
        channels: [...b.channels.entries()]
          .map(([channel, v]) => ({ channel, orders: v.orders, grossSalesMinor: v.gross }))
          .sort((x, y) => y.grossSalesMinor - x.grossSalesMinor || y.orders - x.orders || (x.channel < y.channel ? -1 : 1)),
        daily: days.map((date) => {
          const d = b.daily.get(date)
          return { date, orders: d?.orders ?? 0, grossSalesMinor: d?.gross ?? 0 }
        }),
      }
    }),
  }
}
