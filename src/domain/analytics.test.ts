import { describe, expect, it } from 'vitest'
import { addDays, buildAnalytics, daysIn, rangeFor, stockHealthCounts, type DateRange } from './analytics'
import type { OrderStatus } from './orders'
import type { OrderChannel, OrderSummary, Payment, Product, Refund } from '@/gateway/types'

let seq = 0

function order(p: { currency: string; totalMinor: number; createdAt: string; status?: OrderStatus; channel?: OrderChannel }): OrderSummary {
  seq += 1
  return {
    id: `o${seq}`,
    number: seq,
    status: p.status ?? 'confirmed',
    channel: p.channel ?? 'whatsapp',
    currency: p.currency,
    customerId: null,
    customerName: null,
    customerPhone: null,
    subtotalMinor: p.totalMinor,
    discountMinor: 0,
    taxMinor: 0,
    deliveryFeeMinor: 0,
    totalMinor: p.totalMinor,
    taxMode: 'exclusive',
    note: null,
    createdAt: p.createdAt,
    updatedAt: p.createdAt,
    netPaidMinor: 0,
    fulfilmentMethod: 'pickup',
  }
}

function refund(p: { currency: string; amountMinor: number; createdAt: string; status?: Refund['status'] }): Refund {
  seq += 1
  return {
    id: `r${seq}`,
    orderId: 'o',
    orderNumber: 1,
    paymentId: 'p',
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status ?? 'succeeded',
    verification: 'manual_unverified',
    reason: 'Returned',
    createdAt: p.createdAt,
  }
}

function payment(p: {
  currency: string
  amountMinor: number
  receivedAt: string
  status?: Payment['status']
  verification?: Payment['verification']
}): Payment {
  seq += 1
  return {
    id: `p${seq}`,
    orderId: 'o',
    orderNumber: 1,
    provider: 'manual',
    method: 'cash',
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status ?? 'succeeded',
    verification: p.verification ?? 'manual_unverified',
    externalRef: null,
    note: null,
    receivedAt: p.receivedAt,
    reversedReason: null,
    createdAt: p.receivedAt,
  }
}

function product(p: { trackStock?: boolean; status?: Product['status']; variants: { onHand: number; reserved?: number; low?: number; active?: boolean }[] }): Product {
  seq += 1
  return {
    id: `prod${seq}`,
    name: 'Item',
    description: null,
    category: null,
    status: p.status ?? 'active',
    trackStock: p.trackStock ?? true,
    taxRateBps: 0,
    taxCode: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    variants: p.variants.map((v, i) => ({
      id: `v${seq}-${i}`,
      productId: `prod${seq}`,
      name: 'Default',
      sku: null,
      priceMinor: 100,
      currency: 'KES',
      lowStockThreshold: v.low ?? 3,
      isActive: v.active ?? true,
      onHand: v.onHand,
      reserved: v.reserved ?? 0,
      costMinor: null,
    })),
  }
}

const base = { refunds: [] as Refund[], payments: [] as Payment[], products: [] as Product[] }

describe('rangeFor', () => {
  // 22:00 UTC on 9 March: already 10 March in Nairobi (UTC+3) and Tokyo (UTC+9), still 9 March in Berlin (UTC+1).
  const now = new Date('2026-03-09T22:00:00Z')

  it('uses the business date in each zone', () => {
    expect(rangeFor('today', now, 'Africa/Nairobi')).toEqual({ from: '2026-03-10', to: '2026-03-10' })
    expect(rangeFor('today', now, 'Asia/Tokyo')).toEqual({ from: '2026-03-10', to: '2026-03-10' })
    expect(rangeFor('today', now, 'Europe/Berlin')).toEqual({ from: '2026-03-09', to: '2026-03-09' })
  })

  it('counts today as one of the N days and crosses month boundaries', () => {
    expect(rangeFor('7d', now, 'Africa/Nairobi')).toEqual({ from: '2026-03-04', to: '2026-03-10' })
    expect(rangeFor('7d', new Date('2026-03-02T09:00:00Z'), 'Europe/Berlin')).toEqual({ from: '2026-02-24', to: '2026-03-02' })
    expect(daysIn(rangeFor('30d', now, 'Asia/Tokyo'))).toHaveLength(30)
    expect(daysIn(rangeFor('90d', now, 'Europe/Berlin'))).toHaveLength(90)
  })

  it('does calendar arithmetic across DST changes without drifting', () => {
    // Berlin switches to summer time on 29 March 2026.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(daysIn({ from: '2026-03-27', to: '2026-03-31' })).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'])
  })
})

describe('buildAnalytics: midnight boundaries per time zone', () => {
  it('Africa/Nairobi (UTC+3) buckets 20:59:59Z and 21:00Z on different days', () => {
    const range: DateRange = { from: '2026-03-09', to: '2026-03-10' }
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'KES', totalMinor: 100_00, createdAt: '2026-03-09T20:59:59Z' }),
        order({ currency: 'KES', totalMinor: 250_00, createdAt: '2026-03-09T21:00:00Z' }),
      ],
      timezone: 'Africa/Nairobi',
      range,
    })
    expect(r.currencies[0].daily).toEqual([
      { date: '2026-03-09', orders: 1, grossSalesMinor: 100_00 },
      { date: '2026-03-10', orders: 1, grossSalesMinor: 250_00 },
    ])
  })

  it('Europe/Berlin (UTC+1 in winter, UTC+2 in summer) follows DST', () => {
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'EUR', totalMinor: 10_00, createdAt: '2026-01-14T22:59:59Z' }), // 23:59:59 CET -> 14 Jan
        order({ currency: 'EUR', totalMinor: 20_00, createdAt: '2026-01-14T23:00:00Z' }), // 00:00 CET -> 15 Jan
        order({ currency: 'EUR', totalMinor: 40_00, createdAt: '2026-06-14T22:00:00Z' }), // 00:00 CEST -> 15 Jun
      ],
      timezone: 'Europe/Berlin',
      range: { from: '2026-01-14', to: '2026-06-15' },
    })
    const daily = r.currencies[0].daily
    expect(daily.find((d) => d.date === '2026-01-14')?.grossSalesMinor).toBe(10_00)
    expect(daily.find((d) => d.date === '2026-01-15')?.grossSalesMinor).toBe(20_00)
    expect(daily.find((d) => d.date === '2026-06-14')?.grossSalesMinor).toBe(0)
    expect(daily.find((d) => d.date === '2026-06-15')?.grossSalesMinor).toBe(40_00)
  })

  it('Asia/Tokyo (UTC+9) excludes an order that falls the day before the range starts', () => {
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'JPY', totalMinor: 5000, createdAt: '2026-03-09T14:59:59Z' }), // 23:59:59 JST 9 Mar: outside
        order({ currency: 'JPY', totalMinor: 7000, createdAt: '2026-03-09T15:00:00Z' }), // 00:00 JST 10 Mar: inside
      ],
      timezone: 'Asia/Tokyo',
      range: { from: '2026-03-10', to: '2026-03-10' },
    })
    expect(r.currencies[0].metrics.orders).toBe(1)
    expect(r.currencies[0].metrics.grossSalesMinor).toBe(7000)
  })
})

describe('buildAnalytics: currencies and statuses', () => {
  const range: DateRange = { from: '2026-03-01', to: '2026-03-31' }
  const at = '2026-03-15T09:00:00Z'

  it('keeps mixed currencies apart and never merges them', () => {
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'KES', totalMinor: 1_000_00, createdAt: at }),
        order({ currency: 'EUR', totalMinor: 30_00, createdAt: at }),
        order({ currency: 'JPY', totalMinor: 4500, createdAt: at }),
        order({ currency: 'KES', totalMinor: 500_00, createdAt: at }),
      ],
      refunds: [refund({ currency: 'EUR', amountMinor: 5_00, createdAt: at })],
      timezone: 'UTC',
      range,
      baseCurrency: 'KES',
    })
    expect(r.currencies.map((c) => c.metrics.currency)).toEqual(['KES', 'EUR', 'JPY'])
    const by = Object.fromEntries(r.currencies.map((c) => [c.metrics.currency, c.metrics]))
    expect(by.KES).toMatchObject({ orders: 2, grossSalesMinor: 1_500_00, refundsMinor: 0, netSalesMinor: 1_500_00, averageOrderMinor: 750_00 })
    expect(by.EUR).toMatchObject({ orders: 1, grossSalesMinor: 30_00, refundsMinor: 5_00, netSalesMinor: 25_00 })
    expect(by.JPY).toMatchObject({ orders: 1, grossSalesMinor: 4500, refundsMinor: 0, netSalesMinor: 4500 })
  })

  it('excludes draft and cancelled orders but keeps refunded and delivered ones', () => {
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'KES', totalMinor: 100, createdAt: at, status: 'draft' }),
        order({ currency: 'KES', totalMinor: 200, createdAt: at, status: 'cancelled' }),
        order({ currency: 'KES', totalMinor: 300, createdAt: at, status: 'delivered' }),
        order({ currency: 'KES', totalMinor: 400, createdAt: at, status: 'refunded' }),
      ],
      timezone: 'Africa/Nairobi',
      range,
    })
    expect(r.currencies).toHaveLength(1)
    expect(r.currencies[0].metrics).toMatchObject({ orders: 2, grossSalesMinor: 700 })
  })

  it('subtracts only succeeded refunds inside the range', () => {
    const r = buildAnalytics({
      ...base,
      orders: [order({ currency: 'EUR', totalMinor: 100_00, createdAt: at })],
      refunds: [
        refund({ currency: 'EUR', amountMinor: 10_00, createdAt: at }),
        refund({ currency: 'EUR', amountMinor: 20_00, createdAt: at, status: 'failed' }),
        refund({ currency: 'EUR', amountMinor: 30_00, createdAt: at, status: 'pending' }),
        refund({ currency: 'EUR', amountMinor: 40_00, createdAt: '2026-04-02T10:00:00Z' }),
      ],
      timezone: 'Europe/Berlin',
      range,
    })
    expect(r.currencies[0].metrics).toMatchObject({ grossSalesMinor: 100_00, refundsMinor: 10_00, netSalesMinor: 90_00 })
  })

  it('reports a currency that only has refunds in range, with zero orders and zero average', () => {
    const r = buildAnalytics({
      ...base,
      orders: [],
      refunds: [refund({ currency: 'JPY', amountMinor: 1200, createdAt: at })],
      timezone: 'Asia/Tokyo',
      range,
    })
    expect(r.currencies[0].metrics).toMatchObject({ currency: 'JPY', orders: 0, grossSalesMinor: 0, refundsMinor: 1200, netSalesMinor: -1200, averageOrderMinor: 0 })
  })

  it('rounds the average order half up to a whole minor unit (JPY has none)', () => {
    const r = buildAnalytics({
      ...base,
      orders: [order({ currency: 'JPY', totalMinor: 1000, createdAt: at }), order({ currency: 'JPY', totalMinor: 1001, createdAt: at })],
      timezone: 'Asia/Tokyo',
      range,
    })
    expect(r.currencies[0].metrics.averageOrderMinor).toBe(1001)
  })

  it('sums only succeeded manual-unverified payments as unverified', () => {
    const r = buildAnalytics({
      ...base,
      orders: [order({ currency: 'KES', totalMinor: 900_00, createdAt: at })],
      payments: [
        payment({ currency: 'KES', amountMinor: 300_00, receivedAt: at }),
        payment({ currency: 'KES', amountMinor: 200_00, receivedAt: at, verification: 'provider_verified' }),
        payment({ currency: 'KES', amountMinor: 100_00, receivedAt: at, status: 'reversed' }),
        payment({ currency: 'EUR', amountMinor: 7_00, receivedAt: at }),
      ],
      timezone: 'Africa/Nairobi',
      range,
    })
    const by = Object.fromEntries(r.currencies.map((c) => [c.metrics.currency, c.metrics]))
    expect(by.KES.unverifiedPaymentsMinor).toBe(300_00)
    expect(by.EUR.unverifiedPaymentsMinor).toBe(7_00)
    expect(by.EUR.orders).toBe(0)
  })

  it('breaks down channels per currency, largest first', () => {
    const r = buildAnalytics({
      ...base,
      orders: [
        order({ currency: 'KES', totalMinor: 100, createdAt: at, channel: 'whatsapp' }),
        order({ currency: 'KES', totalMinor: 900, createdAt: at, channel: 'instagram' }),
        order({ currency: 'KES', totalMinor: 150, createdAt: at, channel: 'whatsapp' }),
        order({ currency: 'EUR', totalMinor: 999, createdAt: at, channel: 'whatsapp' }),
      ],
      timezone: 'UTC',
      range,
      baseCurrency: 'KES',
    })
    expect(r.currencies[0].channels).toEqual([
      { channel: 'instagram', orders: 1, grossSalesMinor: 900 },
      { channel: 'whatsapp', orders: 2, grossSalesMinor: 250 },
    ])
    expect(r.currencies[1].channels).toEqual([{ channel: 'whatsapp', orders: 1, grossSalesMinor: 999 }])
  })

  it('returns no currencies when nothing happened in range', () => {
    const r = buildAnalytics({ ...base, orders: [order({ currency: 'KES', totalMinor: 100, createdAt: '2025-01-01T00:00:00Z' })], timezone: 'UTC', range })
    expect(r.currencies).toEqual([])
  })
})

describe('stockHealthCounts', () => {
  it('counts active variants of live products by health', () => {
    const counts = stockHealthCounts([
      product({ variants: [{ onHand: 10 }, { onHand: 3 }, { onHand: 2, reserved: 2 }, { onHand: 50, active: false }] }),
      product({ trackStock: false, variants: [{ onHand: 0 }, { onHand: 0 }] }),
      product({ status: 'archived', variants: [{ onHand: 0 }] }),
    ])
    expect(counts).toEqual({ ok: 1, low: 1, out: 1, untracked: 2 })
  })
})
