import { beforeEach, describe, expect, it } from 'vitest'
import { computeOrderTotals } from '@/domain/orders'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { GatewayError, newIdempotencyKey } from './gateway'
import type { NewOrderInput, Product } from './types'

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
