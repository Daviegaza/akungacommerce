import { beforeEach, describe, expect, it } from 'vitest'
import { computeOrderTotals } from '@/domain/orders'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { GatewayError, newIdempotencyKey } from './gateway'
import type { NewOrderInput, Product } from './types'
import { createDemoStorefront } from './storefront-demo'
import { deliveryFeeFor, haversineKm, type PlaceOrderInput } from './storefront'

const gw = createDemoGateway()

async function mto() {
  const orgs = await gw.listOrganisations()
  const org = orgs.find((o) => o.baseCurrency === 'KES')
  if (!org) throw new Error('seed missing KES org')
  return org
}

function variantByName(products: Product[], product: string, variant: string) {
  const v = products.find((p) => p.name === product)?.variants.find((x) => x.name === variant)
  if (!v) throw new Error(`missing ${product} ${variant}`)
  return v
}

function orderInput(variantId: string, quantity: number, status: NewOrderInput['status'] = 'confirmed'): NewOrderInput {
  return {
    status,
    channel: 'whatsapp',
    customerId: null,
    note: null,
    deliveryFeeMinor: 25000,
    fulfilment: { method: 'pickup', recipientName: null, recipientPhone: null, address: {} },
    lines: [{ variantId, quantity, discountMinor: 0 }],
  }
}

beforeEach(() => {
  resetDemoWorkspace()
})

describe('demo gateway seed', () => {
  it('loads two organisations in different currencies with realistic data', async () => {
    const orgs = await gw.listOrganisations()
    expect(orgs).toHaveLength(2)
    expect(orgs.map((o) => o.baseCurrency).sort()).toEqual(['EUR', 'KES'])
    expect(orgs.every((o) => o.role === 'owner')).toBe(true)
    const lumen = orgs.find((o) => o.baseCurrency === 'EUR')
    expect(lumen?.taxMode).toBe('inclusive')

    const org = await mto()
    const orders = await gw.listOrders(org.id)
    expect(orders.length).toBeGreaterThanOrEqual(12)
    expect(new Set(orders.map((o) => o.status))).toEqual(
      new Set(['draft', 'pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'refunded']),
    )
    expect(Math.min(...orders.map((o) => o.number))).toBe(1001)
    const products = await gw.listProducts(org.id)
    expect(products.some((p) => p.status === 'archived')).toBe(true)
    expect(products.flatMap((p) => p.variants).every((v) => v.reserved <= v.onHand && v.reserved >= 0)).toBe(true)
    const user = await gw.getUser()
    expect(user?.email).toBe('owner@demo.akunga.test')
  })
})

describe('orders', () => {
  it('computes totals with the shared domain rules (prices from catalogue)', async () => {
    const org = await mto()
    const products = await gw.listProducts(org.id)
    const mug = variantByName(products, 'Stoneware Mug', 'Sand')
    const id = await gw.createOrder(org.id, orderInput(mug.id, 2), newIdempotencyKey())
    const order = await gw.getOrder(org.id, id)
    const expected = computeOrderTotals({
      currency: 'KES',
      taxMode: 'exclusive',
      deliveryFeeMinor: 25000,
      lines: [{ unitPriceMinor: mug.priceMinor, quantity: 2, taxRateBps: 1600, discountMinor: 0, currency: 'KES' }],
    })
    expect(order.totalMinor).toBe(expected.totalMinor)
    expect(order.taxMinor).toBe(expected.taxMinor)
    expect(order.subtotalMinor).toBe(expected.subtotalMinor)
    expect(order.lines[0].unitPriceMinor).toBe(mug.priceMinor)
    expect(order.history).toHaveLength(1)
  })

  it('is idempotent: the same key returns the same order without reserving twice', async () => {
    const org = await mto()
    const mug = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sand')
    const key = newIdempotencyKey()
    const a = await gw.createOrder(org.id, orderInput(mug.id, 1), key)
    const b = await gw.createOrder(org.id, orderInput(mug.id, 1), key)
    expect(a).toBe(b)
    const after = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sand')
    expect(after.reserved).toBe(mug.reserved + 1)
  })

  it('rejects overselling and leaves stock untouched', async () => {
    const org = await mto()
    const sage = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sage')
    const available = sage.onHand - sage.reserved
    const before = (await gw.listOrders(org.id)).length
    await expect(gw.createOrder(org.id, orderInput(sage.id, available + 1), newIdempotencyKey())).rejects.toBeInstanceOf(GatewayError)
    const after = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sage')
    expect(after.reserved).toBe(sage.reserved)
    expect((await gw.listOrders(org.id)).length).toBe(before)
  })

  it('cancel releases the reservation and dispatch commits stock', async () => {
    const org = await mto()
    const v0 = variantByName(await gw.listProducts(org.id), 'Soy Candle 200 g', 'Cedar & Lemongrass')
    const cancelId = await gw.createOrder(org.id, orderInput(v0.id, 3), newIdempotencyKey())
    expect(variantByName(await gw.listProducts(org.id), 'Soy Candle 200 g', 'Cedar & Lemongrass').reserved).toBe(v0.reserved + 3)
    await gw.transitionOrder(org.id, cancelId, 'cancelled', 'test')
    const v1 = variantByName(await gw.listProducts(org.id), 'Soy Candle 200 g', 'Cedar & Lemongrass')
    expect(v1.reserved).toBe(v0.reserved)
    expect(v1.onHand).toBe(v0.onHand)

    const shipId = await gw.createOrder(org.id, orderInput(v0.id, 2), newIdempotencyKey())
    await gw.transitionOrder(org.id, shipId, 'ready', null)
    await gw.transitionOrder(org.id, shipId, 'dispatched', null)
    const v2 = variantByName(await gw.listProducts(org.id), 'Soy Candle 200 g', 'Cedar & Lemongrass')
    expect(v2.onHand).toBe(v0.onHand - 2)
    expect(v2.reserved).toBe(v0.reserved)
    await expect(gw.transitionOrder(org.id, shipId, 'confirmed', null)).rejects.toThrow(/cannot move/)
    await gw.transitionOrder(org.id, shipId, 'delivered', null)
    const detail = await gw.getOrder(org.id, shipId)
    expect(detail.fulfilment.deliveredAt).not.toBeNull()
    expect(detail.history.map((h) => h.toStatus)).toEqual(['confirmed', 'ready', 'dispatched', 'delivered'])
  })
})

describe('payments and refunds', () => {
  it('records manual payments as unverified and checks currency', async () => {
    const org = await mto()
    const mug = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sand')
    const id = await gw.createOrder(org.id, orderInput(mug.id, 1), newIdempotencyKey())
    const base = { orderId: id, method: 'mobile_money' as const, externalRef: 'SJX1Y2Z3A4', receivedAt: new Date().toISOString(), note: null }
    await expect(gw.recordManualPayment(org.id, { ...base, amountMinor: 100, currency: 'EUR' }, newIdempotencyKey())).rejects.toThrow(/in KES/)
    const key = newIdempotencyKey()
    const pid = await gw.recordManualPayment(org.id, { ...base, amountMinor: 100000, currency: 'KES' }, key)
    expect(await gw.recordManualPayment(org.id, { ...base, amountMinor: 100000, currency: 'KES' }, key)).toBe(pid)
    const detail = await gw.getOrder(org.id, id)
    expect(detail.payments).toHaveLength(1)
    expect(detail.payments[0].verification).toBe('manual_unverified')
    expect(detail.payments[0].status).toBe('succeeded')
    expect(detail.netPaidMinor).toBe(100000)
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await expect(
      gw.recordManualPayment(org.id, { ...base, amountMinor: 100, currency: 'KES', receivedAt: future }, newIdempotencyKey()),
    ).rejects.toThrow(/future/)
  })

  it('rejects refunds over the refundable amount and marks a fully refunded delivered order as refunded', async () => {
    const org = await mto()
    const mug = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Charcoal')
    const id = await gw.createOrder(org.id, orderInput(mug.id, 1), newIdempotencyKey())
    const order = await gw.getOrder(org.id, id)
    const pid = await gw.recordManualPayment(
      org.id,
      { orderId: id, amountMinor: order.totalMinor, currency: 'KES', method: 'cash', externalRef: null, receivedAt: new Date().toISOString(), note: null },
      newIdempotencyKey(),
    )
    await gw.transitionOrder(org.id, id, 'ready', null)
    await gw.transitionOrder(org.id, id, 'delivered', null)
    await expect(
      gw.recordRefund(org.id, { paymentId: pid, amountMinor: order.totalMinor + 1, currency: 'KES', reason: 'too much' }, newIdempotencyKey()),
    ).rejects.toThrow(/exceeds/)
    await gw.recordRefund(org.id, { paymentId: pid, amountMinor: order.totalMinor, currency: 'KES', reason: 'Returned' }, newIdempotencyKey())
    const after = await gw.getOrder(org.id, id)
    expect(after.status).toBe('refunded')
    expect(after.netPaidMinor).toBe(0)
    expect(after.history.at(-1)?.note).toBe('All payments refunded')
    expect((await gw.listRefunds(org.id)).some((r) => r.orderNumber === after.number)).toBe(true)
  })
})

describe('inventory', () => {
  it('refuses an adjustment that would drop stock below what is reserved', async () => {
    const org = await mto()
    const sage = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sage')
    expect(sage.reserved).toBeGreaterThan(0)
    await expect(
      gw.adjustStock(org.id, { variantId: sage.id, delta: -(sage.onHand - sage.reserved + 1), reason: 'damaged', note: null }, newIdempotencyKey()),
    ).rejects.toThrow(/reserved/)
    const key = newIdempotencyKey()
    await gw.adjustStock(org.id, { variantId: sage.id, delta: 5, reason: 'received_from_supplier', note: null }, key)
    await gw.adjustStock(org.id, { variantId: sage.id, delta: 5, reason: 'received_from_supplier', note: null }, key)
    const after = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sage')
    expect(after.onHand).toBe(sage.onHand + 5)
    const moves = await gw.listStockMovements(org.id, { variantId: sage.id })
    expect(moves[0].kind).toBe('receipt')
    expect(moves[0].productName).toBe('Stoneware Mug')
  })
})

describe('permissions', () => {
  it('analysts are read-only and cannot see costs', async () => {
    const org = await mto()
    const mug = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sand')
    expect(mug.costMinor).not.toBeNull()
    __setDemoRole(org.id, 'analyst')
    const asAnalyst = variantByName(await gw.listProducts(org.id), 'Stoneware Mug', 'Sand')
    expect(asAnalyst.costMinor).toBeNull()
    await expect(gw.createOrder(org.id, orderInput(mug.id, 1), newIdempotencyKey())).rejects.toThrow(/cannot create/)
    await expect(
      gw.adjustStock(org.id, { variantId: mug.id, delta: 1, reason: 'correction', note: null }, newIdempotencyKey()),
    ).rejects.toThrow(/cannot adjust stock/)
    expect((await gw.listOrders(org.id)).length).toBeGreaterThan(0)
  })

  it('sales can create orders but not refund, adjust stock or edit the catalogue', async () => {
    const org = await mto()
    const products = await gw.listProducts(org.id)
    const mug = variantByName(products, 'Stoneware Mug', 'Sand')
    const payment = (await gw.listPayments(org.id))[0]
    __setDemoRole(org.id, 'sales')
    const id = await gw.createOrder(org.id, orderInput(mug.id, 1), newIdempotencyKey())
    expect(id).toBeTruthy()
    await expect(
      gw.recordRefund(org.id, { paymentId: payment.id, amountMinor: 1, currency: 'KES', reason: 'x' }, newIdempotencyKey()),
    ).rejects.toThrow(/cannot record refunds/)
    const p = products.find((x) => x.name === 'Stoneware Mug') as Product
    await expect(
      gw.saveProduct(org.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        status: p.status,
        trackStock: p.trackStock,
        taxRateBps: p.taxRateBps,
        taxCode: p.taxCode,
        variants: p.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, priceMinor: 1, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive })),
      }),
    ).rejects.toThrow(/cannot edit products/)
  })

  it('keeps at least one owner', async () => {
    const org = await mto()
    await expect(gw.setMemberRole(org.id, 'demo-user', 'admin')).rejects.toThrow(/at least one owner/)
  })
})

/* ───────────── Storefront: shop settings & merchandising (staff side) ───────────── */

describe('shop settings and merchandising', () => {
  it('seeds two published shops with location, bands and payment details', async () => {
    const orgs = await gw.listOrganisations()
    const settings = await Promise.all(orgs.map((o) => gw.getShopSettings(o.id)))
    expect(settings.map((s) => s?.slug).sort()).toEqual(['atelier-lumen', 'mto-home'])
    const mtoShop = settings.find((s) => s?.slug === 'mto-home')
    expect(mtoShop).toMatchObject({ published: true, codEnabled: true, mpesaTill: '5123456', registeredName: 'MTO HOME AND LIVING' })
    expect(mtoShop?.deliveryBands).toEqual([
      { maxKm: 3, feeMinor: 15000 },
      { maxKm: 8, feeMinor: 30000 },
      { maxKm: 15, feeMinor: 50000 },
    ])
    const lumenShop = settings.find((s) => s?.slug === 'atelier-lumen')
    expect(lumenShop).toMatchObject({ codEnabled: false, mpesaTill: null, mpesaPaybill: null })
  })

  it('seeds real merchandising: https images, featured items, one future drop, honest compare-at prices', async () => {
    const products = await gw.listProducts((await mto()).id)
    const active = products.filter((p) => p.status === 'active')
    expect(active.every((p) => p.images.length >= 1 && p.images.length <= 4)).toBe(true)
    const urlRe = /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?w=900&q=80&auto=format&fit=crop$/
    expect(active.flatMap((p) => p.images).every((i) => urlRe.test(i.url))).toBe(true)
    expect(active.filter((p) => p.featured).length).toBeGreaterThanOrEqual(2)
    const drops = active.filter((p) => p.availableFrom && new Date(p.availableFrom).getTime() > Date.now())
    expect(drops).toHaveLength(1)
    const variants = products.flatMap((p) => p.variants)
    expect(variants.some((v) => v.compareAtMinor !== null)).toBe(true)
    expect(variants.every((v) => v.compareAtMinor === null || v.compareAtMinor > v.priceMinor)).toBe(true)
    expect(variants.filter((v) => v.swatch).every((v) => /^#[0-9a-fA-F]{6}$/.test(v.swatch as string))).toBe(true)
  })

  it('validates shop settings like save_shop_settings', async () => {
    const org = await mto()
    const base = (await gw.getShopSettings(org.id))!
    await expect(gw.saveShopSettings(org.id, { ...base, slug: 'Bad Slug!' })).rejects.toThrow(/Shop link/)
    await expect(gw.saveShopSettings(org.id, { ...base, slug: 'ab' })).rejects.toThrow(/Shop link/)
    await expect(gw.saveShopSettings(org.id, { ...base, slug: 'atelier-lumen' })).rejects.toThrow(/already taken/)
    await expect(
      gw.saveShopSettings(org.id, { ...base, deliveryBands: [{ maxKm: 5, feeMinor: 100 }, { maxKm: 5, feeMinor: 200 }] }),
    ).rejects.toThrow(/increasing/)
    await expect(gw.saveShopSettings(org.id, { ...base, deliveryBands: [{ maxKm: 501, feeMinor: 100 }] })).rejects.toThrow(/500 km/)
    await expect(gw.saveShopSettings(org.id, { ...base, deliveryBands: [{ maxKm: 5, feeMinor: -1 }] })).rejects.toThrow(/non-negative/)
    await expect(gw.saveShopSettings(org.id, { ...base, locationLat: null })).rejects.toThrow(/location/)
    await expect(gw.saveShopSettings(org.id, { ...base, coverUrl: 'http://example.com/a.jpg' })).rejects.toThrow(/https/)
    await expect(gw.saveShopSettings(org.id, { ...base, mpesaTill: '12' })).rejects.toThrow(/digits/)
    // Unpublished shops may omit the location; the slug is normalised to lower case.
    await gw.saveShopSettings(org.id, { ...base, slug: 'MTO-Home', published: false, locationLat: null, locationLng: null })
    expect((await gw.getShopSettings(org.id))?.slug).toBe('mto-home')
  })

  it('only roles with org.manage can change shop settings', async () => {
    const org = await mto()
    const base = (await gw.getShopSettings(org.id))!
    __setDemoRole(org.id, 'sales')
    await expect(gw.saveShopSettings(org.id, { ...base, tagline: 'x' })).rejects.toThrow(/cannot change business settings/)
    expect(await gw.getShopSettings(org.id)).not.toBeNull()
  })

  it('validates merchandising: https images, compare-at above price, hex swatch', async () => {
    const org = await mto()
    const products = await gw.listProducts(org.id)
    const board = products.find((p) => p.name === 'Olive Wood Serving Board')!
    const v = board.variants[0]
    await expect(
      gw.setProductMerchandising(org.id, board.id, { images: [{ url: 'http://x.test/a.jpg' }], featured: false, availableFrom: null }),
    ).rejects.toThrow(/https/)
    await expect(gw.setVariantMerchandising(org.id, v.id, { compareAtMinor: v.priceMinor, swatch: null })).rejects.toThrow(/higher/)
    await expect(gw.setVariantMerchandising(org.id, v.id, { compareAtMinor: null, swatch: 'red' })).rejects.toThrow(/hex/)
    await gw.setVariantMerchandising(org.id, v.id, { compareAtMinor: v.priceMinor + 500, swatch: '#aa5500' })
    await gw.setProductMerchandising(org.id, board.id, {
      images: [{ url: 'https://images.example.test/a.jpg', alt: 'Board' }],
      featured: true,
      availableFrom: null,
    })
    const after = (await gw.listProducts(org.id)).find((p) => p.id === board.id)!
    expect(after.featured).toBe(true)
    expect(after.images).toEqual([{ url: 'https://images.example.test/a.jpg', alt: 'Board' }])
    expect(after.variants[0]).toMatchObject({ compareAtMinor: v.priceMinor + 500, swatch: '#aa5500' })
    // Raising the price to or above the compare-at price is refused (mirrors the check constraint).
    await expect(
      gw.saveProduct(org.id, {
        id: after.id,
        name: after.name,
        description: after.description,
        category: after.category,
        status: after.status,
        trackStock: after.trackStock,
        taxRateBps: after.taxRateBps,
        taxCode: after.taxCode,
        variants: [{ id: v.id, name: v.name, sku: v.sku, priceMinor: v.priceMinor + 500, lowStockThreshold: v.lowStockThreshold, isActive: true }],
      }),
    ).rejects.toThrow(/compare-at/)
    __setDemoRole(org.id, 'sales')
    await expect(gw.setVariantMerchandising(org.id, v.id, { compareAtMinor: null, swatch: null })).rejects.toThrow(/cannot edit products/)
  })
})

/* ───────────── Storefront: shopper side (demo) ───────────── */

describe('demo storefront', () => {
  const sf = createDemoStorefront()
  const WESTLANDS = { lat: -1.2676, lng: 36.8108 }
  const near = { lat: WESTLANDS.lat + 5 / 111.195, lng: WESTLANDS.lng } // about 5 km north
  const far = { lat: -4.0435, lng: 39.6682 } // Mombasa

  const key = () => newIdempotencyKey()
  const guest = (variantId: string, quantity = 1, extra: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
    lines: [{ variantId, quantity }],
    method: 'pickup',
    name: 'Wairimu Test',
    phoneE164: '+254799000111',
    payment: 'mpesa',
    marketingOptIn: false,
    ...extra,
  })
  async function variantOf(product: string, variant: string, slug = 'mto-home') {
    const data = await sf.getStorefront(slug)
    const p = data.products.find((x) => x.name === product)
    const v = p?.variants.find((x) => x.name === variant)
    if (!p || !v) throw new Error(`missing ${product} ${variant}`)
    return { p, v }
  }
  async function deliver(orderId: string) {
    const org = await mto()
    await gw.transitionOrder(org.id, orderId, 'confirmed', null)
    await gw.transitionOrder(org.id, orderId, 'ready', null)
    await gw.transitionOrder(org.id, orderId, 'delivered', null)
  }

  it('serves only published shops, featured first, with real ratings and sold counts', async () => {
    await expect(sf.getStorefront('no-such-shop')).rejects.toThrow(/Shop not found/)
    const data = await sf.getStorefront('MTO-HOME')
    expect(data.shop).toMatchObject({ name: 'Mto Home & Living', currency: 'KES', taxMode: 'exclusive', slug: 'mto-home' })
    expect(data.shop.rating?.count).toBe(6)
    expect(data.products.some((p) => p.name === 'Recycled Glass Tumblers (set of 4)')).toBe(false) // archived
    const firstNonFeatured = data.products.findIndex((p) => !p.featured)
    expect(firstNonFeatured).toBeGreaterThan(0)
    expect(data.products.slice(firstNonFeatured).every((p) => !p.featured)).toBe(true)
    const byName = Object.fromEntries(data.products.map((p) => [p.name, p]))
    expect(byName['Stoneware Mug'].soldCount).toBe(6) // 2 + 4 delivered
    expect(byName['Linen Throw'].soldCount).toBeNull() // 1 delivered: hidden below 5
    expect(byName['Stoneware Mug'].rating).toEqual({ average: 5, count: 2 })
    expect(byName['Olive Wood Serving Board'].rating).toBeNull()
    expect(byName['Gift Wrapping'].variants[0].available).toBeNull() // stock not tracked

    const org = await mto()
    const settings = (await gw.getShopSettings(org.id))!
    await gw.saveShopSettings(org.id, { ...settings, published: false })
    await expect(sf.getStorefront('mto-home')).rejects.toThrow(/Shop not found/)
    expect(await sf.listReviews('mto-home', byName['Stoneware Mug'].id)).toEqual([])
  })

  it('lists reviews newest first with first-name authors', async () => {
    const { p } = await variantOf('Stoneware Mug', 'Sand')
    const reviews = await sf.listReviews('mto-home', p.id)
    expect(reviews).toHaveLength(2)
    expect(reviews.map((r) => r.author).sort()).toEqual(['Amina', 'Kevin'])
    expect(reviews[0].createdAt >= reviews[1].createdAt).toBe(true)
  })

  it('quotes from catalogue prices and charges delivery by distance band', async () => {
    const { p, v } = await variantOf('Stoneware Mug', 'Sand')
    const q = await sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 2 }], method: 'delivery', ...near })
    const km = haversineKm(WESTLANDS.lat, WESTLANDS.lng, near.lat, near.lng)
    const bands = [
      { maxKm: 3, feeMinor: 15000 },
      { maxKm: 8, feeMinor: 30000 },
      { maxKm: 15, feeMinor: 50000 },
    ]
    expect(deliveryFeeFor(bands, km)).toBe(30000)
    const expected = computeOrderTotals({
      currency: 'KES',
      taxMode: 'exclusive',
      deliveryFeeMinor: 30000,
      lines: [{ unitPriceMinor: v.priceMinor, quantity: 2, taxRateBps: p.taxRateBps, discountMinor: 0, currency: 'KES' }],
    })
    expect(q).toMatchObject({
      deliveryFeeMinor: 30000,
      distanceKm: Math.round(km * 10) / 10,
      totalMinor: expected.totalMinor,
      taxMinor: expected.taxMinor,
    })
    expect(q.lines[0].unitPriceMinor).toBe(v.priceMinor)
    const pickup = await sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 2 }], method: 'pickup' })
    expect(pickup.deliveryFeeMinor).toBe(0)
    expect(pickup.distanceKm).toBeNull()
    await expect(sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'delivery', ...far })).rejects.toThrow(
      /outside the delivery area/,
    )
    await expect(sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'delivery' })).rejects.toThrow(/Drop a pin/)
    await expect(sf.quote('mto-home', { lines: [], method: 'pickup' })).rejects.toThrow(/empty/)
    await expect(sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1.5 }], method: 'pickup' })).rejects.toThrow(/Invalid quantity/)
  })

  it('refuses a scheduled drop before its time', async () => {
    const { v } = await variantOf('Banana-Fibre Pendant Shade', 'Natural')
    await expect(sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'pickup' })).rejects.toThrow(/not available yet/)
    await expect(sf.placeOrder('mto-home', guest(v.id), key())).rejects.toThrow(/not available yet/)
  })

  it('places a guest order: pending confirmation, stock reserved, customer upserted by phone, idempotent', async () => {
    const org = await mto()
    const { v } = await variantOf('Soy Candle 200 g', 'Vanilla & Fig')
    const before = (await gw.listProducts(org.id)).flatMap((p) => p.variants).find((x) => x.id === v.id)!
    const customersBefore = (await gw.listCustomers(org.id)).length
    const k = key()
    const input = guest(v.id, 2, { method: 'delivery', ...near, landmark: 'Opposite the petrol station', addressLine: 'Gate B' })
    const placed = await sf.placeOrder('mto-home', input, k)
    expect(placed.trackingToken).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(await sf.placeOrder('mto-home', input, k)).toEqual(placed)

    const order = await gw.getOrder(org.id, placed.orderId)
    expect(order).toMatchObject({ status: 'pending_confirmation', channel: 'storefront', deliveryFeeMinor: 30000, totalMinor: placed.totalMinor })
    const after = (await gw.listProducts(org.id)).flatMap((p) => p.variants).find((x) => x.id === v.id)!
    expect(after.reserved).toBe(before.reserved + 2)
    const customers = await gw.listCustomers(org.id)
    expect(customers.length).toBe(customersBefore + 1)
    const c = customers.find((x) => x.phoneE164 === '+254799000111')!
    expect(c).toMatchObject({ name: 'Wairimu Test', marketingConsent: false, tags: ['storefront'] })

    // Same phone again: no new customer; opting in switches consent on.
    await sf.placeOrder('mto-home', guest(v.id, 1, { name: 'W. Test', marketingOptIn: true }), key())
    const again = (await gw.listCustomers(org.id)).filter((x) => x.phoneE164 === '+254799000111')
    expect(again).toHaveLength(1)
    expect(again[0].marketingConsent).toBe(true)

    const tracked = await sf.track(placed.trackingToken)
    expect(tracked).toMatchObject({
      number: placed.number,
      status: 'pending_confirmation',
      customerFirstName: 'Wairimu',
      paymentPreference: 'mpesa',
      paidMinor: 0,
    })
    expect(tracked.fulfilment).toMatchObject({ method: 'delivery', dropLat: near.lat, dropLng: near.lng, landmark: 'Opposite the petrol station' })
    expect(tracked.shop).toMatchObject({ slug: 'mto-home', mpesaTill: '5123456', registeredName: 'MTO HOME AND LIVING' })
    expect(tracked.history.map((h) => h.status)).toEqual(['pending_confirmation'])
    await expect(sf.track('short')).rejects.toThrow(/Order not found/)
    await expect(sf.track('x'.repeat(24))).rejects.toThrow(/Order not found/)
  })

  it('validates guest details, payment choice, stock and keys', async () => {
    const { v } = await variantOf('Stoneware Mug', 'Sage')
    await expect(sf.placeOrder('mto-home', guest(v.id, 1, { phoneE164: '0712345678' }), key())).rejects.toThrow(/valid phone/)
    await expect(sf.placeOrder('mto-home', guest(v.id, 1, { name: 'A' }), key())).rejects.toThrow(/your name/)
    await expect(sf.placeOrder('mto-home', guest(v.id), 'short')).rejects.toThrow(/idempotency/)
    await expect(sf.placeOrder('mto-home', guest(v.id, (v.available ?? 0) + 1), key())).rejects.toThrow(/Only \d+ of Stoneware Mug left/)
    const lumen = await variantOf('Duftkerze Feige', 'Default', 'atelier-lumen')
    await expect(sf.placeOrder('atelier-lumen', guest(lumen.v.id, 1, { payment: 'cod' }), key())).rejects.toThrow(/Cash on delivery/)
    const cod = await sf.placeOrder('mto-home', guest(v.id, 1, { payment: 'cod' }), key())
    expect((await sf.track(cod.trackingToken)).paymentPreference).toBe('cod')
  })

  it('rate-limits a phone after 6 orders an hour (failed attempts do not count)', async () => {
    const { v } = await variantOf('Soy Candle 200 g', 'Cedar & Lemongrass')
    const phone = '+254799000222'
    for (let i = 0; i < 6; i++) await sf.placeOrder('mto-home', guest(v.id, 1, { phoneE164: phone }), key())
    await expect(sf.placeOrder('mto-home', guest(v.id, 1, { phoneE164: phone }), key())).rejects.toThrow(/Too many attempts/)
    await sf.placeOrder('mto-home', guest(v.id, 1, { phoneE164: '+254799000333' }), key())
  })

  it('accepts verified reviews only after delivery, once per product', async () => {
    const { p, v } = await variantOf('Olive Wood Serving Board', 'Default')
    const placed = await sf.placeOrder('mto-home', guest(v.id), key())
    await expect(sf.submitReview(placed.trackingToken, p.id, 5, 'Great')).rejects.toThrow(/once your order is delivered/)
    await deliver(placed.orderId)
    const other = await variantOf('Stoneware Mug', 'Sand')
    await expect(sf.submitReview(placed.trackingToken, other.p.id, 5, null)).rejects.toThrow(/not in this order/)
    await expect(sf.submitReview(placed.trackingToken, p.id, 6, null)).rejects.toThrow(/1 to 5/)
    await sf.submitReview(placed.trackingToken, p.id, 4, '  Beautiful grain.  ')
    await sf.submitReview(placed.trackingToken, p.id, 1, 'Changed my mind') // ignored: once per product
    const reviews = await sf.listReviews('mto-home', p.id)
    expect(reviews).toEqual([{ rating: 4, body: 'Beautiful grain.', author: 'Wairimu', createdAt: expect.any(String) }])
    expect((await sf.track(placed.trackingToken)).reviewedProductIds).toEqual([p.id])
    const refreshed = (await sf.getStorefront('mto-home')).products.find((x) => x.id === p.id)!
    expect(refreshed.rating).toEqual({ average: 4, count: 1 })
    expect(refreshed.soldCount).toBeNull() // 1 delivered unit: still hidden
  })

  it('never claims an M-Pesa payment in the demo', async () => {
    expect(await sf.requestMpesaPrompt('x'.repeat(24), '+254712345678')).toEqual({ status: 'not_configured' })
  })
})
