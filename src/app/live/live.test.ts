import { describe, expect, it } from 'vitest'
import type { OrderSummary, Payment, Product } from '@/gateway/types'
import { buildFeed } from './feed'
import { formatRelative } from './clock'
import { countedOrders } from './orders'

function order(p: Partial<OrderSummary>): OrderSummary {
  return {
    id: 'o1',
    number: 1,
    status: 'pending_confirmation',
    channel: 'whatsapp',
    currency: 'KES',
    customerId: null,
    customerName: 'Amina Otieno',
    customerPhone: null,
    subtotalMinor: 10000,
    discountMinor: 0,
    taxMinor: 0,
    deliveryFeeMinor: 0,
    totalMinor: 10000,
    taxMode: 'inclusive',
    note: null,
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:00:00.000Z',
    netPaidMinor: 0,
    fulfilmentMethod: 'delivery',
    ...p,
  }
}

describe('buildFeed', () => {
  it('derives events only from real records, newest first, and skips drafts', () => {
    const orders = [
      order({ id: 'a', number: 1, createdAt: '2026-11-19T08:00:00.000Z', updatedAt: '2026-11-19T09:00:00.000Z', status: 'delivered' }),
      order({ id: 'b', number: 2, createdAt: '2026-11-19T10:00:00.000Z', updatedAt: '2026-11-19T10:00:00.000Z' }),
      order({ id: 'c', number: 3, status: 'draft', createdAt: '2026-11-19T11:00:00.000Z' }),
    ]
    const payments: Payment[] = [
      {
        id: 'p1',
        orderId: 'a',
        orderNumber: 1,
        provider: 'manual',
        method: 'cash',
        amountMinor: 10000,
        currency: 'KES',
        status: 'succeeded',
        verification: 'manual_unverified',
        externalRef: null,
        note: null,
        receivedAt: '2026-11-19T08:30:00.000Z',
        reversedReason: null,
        createdAt: '2026-11-19T08:30:00.000Z',
      },
    ]
    const feed = buildFeed({ orders, payments, locale: 'en-KE' })
    expect(feed.map((f) => f.id)).toEqual(['o-b', 's-a-delivered', 'p-p1', 'o-a'])
    expect(feed.find((f) => f.kind === 'payment')?.detail).toContain('unverified')
    expect(feed.some((f) => f.id.includes('c'))).toBe(false)
  })

  it('lists low and out-of-stock variants using the latest movement as the time', () => {
    const product: Product = {
      id: 'p',
      name: 'Kitenge dress',
      description: null,
      category: null,
      status: 'active',
      trackStock: true,
      taxRateBps: 0,
      taxCode: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      images: [],
      featured: false,
      availableFrom: null,
      variants: [
        { id: 'v1', productId: 'p', name: 'M', sku: null, priceMinor: 1, currency: 'KES', lowStockThreshold: 3, isActive: true, onHand: 2, reserved: 0, costMinor: null, compareAtMinor: null, swatch: null },
        { id: 'v2', productId: 'p', name: 'L', sku: null, priceMinor: 1, currency: 'KES', lowStockThreshold: 3, isActive: true, onHand: 10, reserved: 0, costMinor: null, compareAtMinor: null, swatch: null },
      ],
    }
    const feed = buildFeed({
      products: [product],
      movements: [
        { id: 'm1', variantId: 'v1', productName: 'Kitenge dress', variantName: 'M', kind: 'sale', onHandDelta: -1, reservedDelta: 0, reason: null, note: null, orderId: null, createdAt: '2026-11-18T12:00:00.000Z' },
      ],
      locale: 'en',
    })
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ kind: 'stock', at: '2026-11-18T12:00:00.000Z', detail: '2 left' })
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z')
  it('formats recent times compactly', () => {
    expect(formatRelative('2026-11-20T11:59:50.000Z', now)).toBe('just now')
    expect(formatRelative('2026-11-20T11:55:00.000Z', now)).toMatch(/5 min/)
    expect(formatRelative('2026-11-20T09:00:00.000Z', now)).toMatch(/3 hr/)
    expect(formatRelative('not a date', now)).toBe('')
  })
})

describe('countedOrders', () => {
  it('ignores drafts and cancelled orders for milestones', () => {
    expect(countedOrders([order({ status: 'draft' }), order({ status: 'cancelled' }), order({ status: 'delivered' })])).toBe(1)
  })
})
