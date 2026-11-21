import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOP_POLICY } from '@/domain/delivery-policy'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { newIdempotencyKey } from './gateway'
import { createDemoStorefront } from './storefront-demo'
import type { PlaceOrderInput } from './storefront'

const gw = createDemoGateway()
const sf = createDemoStorefront()
const NEAR = { lat: -1.2676 + 5 / ((2 * Math.PI * 6371.0088) / 360), lng: 36.8108 } // ~5 km -> KSh 300 band

async function mto() {
  const org = (await gw.listOrganisations()).find((o) => o.baseCurrency === 'KES')
  if (!org) throw new Error('seed missing')
  return org
}

async function mug() {
  const data = await sf.getStorefront('mto-home')
  const v = data.products.find((p) => p.name === 'Stoneware Mug')?.variants[0]
  if (!v) throw new Error('missing mug')
  return v
}

function guest(variantId: string, qty: number, extra: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    lines: [{ variantId, quantity: qty }],
    method: 'delivery',
    ...NEAR,
    name: 'Wanjiru Test',
    phoneE164: '+254799000333',
    payment: 'mpesa',
    marketingOptIn: false,
    landmark: 'Gate B',
    ...extra,
  }
}

const key = () => `k-${newIdempotencyKey()}`

beforeEach(() => resetDemoWorkspace())
afterEach(() => vi.useRealTimers())

describe('demo deposits', () => {
  it('seeds a deposit rule for the Kenyan shop and generic pick-up points', async () => {
    const org = await mto()
    expect(await gw.getShopPolicy(org.id)).toMatchObject({ paymentMode: 'deposit', depositPercentBps: 3000, failedDeliveryPayer: 'buyer' })
    const opts = await sf.getCheckoutOptions('mto-home')
    expect(opts.pickupPoints.length).toBeGreaterThan(0)
    expect(opts.pickupPoints.every((p) => p.name.startsWith('Pick-up point'))).toBe(true)
  })

  it('quotes deposit due now vs balance on delivery and stores it on the order', async () => {
    const v = await mug()
    const q = await sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 3 }], method: 'delivery', ...NEAR })
    expect(q.depositDueMinor).toBeGreaterThan(0)
    expect((q.depositDueMinor ?? 0) + (q.balanceOnDeliveryMinor ?? 0)).toBe(q.totalMinor)
    expect((q.depositDueMinor ?? 0) % 100).toBe(0) // whole shillings
    const placed = await sf.placeOrder('mto-home', guest(v.id, 3), key())
    expect(placed.depositDueMinor).toBe(q.depositDueMinor)
    const t = await sf.track(placed.trackingToken)
    expect(t.delivery).toMatchObject({ depositDueMinor: q.depositDueMinor, dueNowMinor: q.depositDueMinor, attempts: 0, maxAttempts: 2 })
  })

  it('only owners/admins change the policy; full prepay refuses cash on delivery', async () => {
    const org = await mto()
    const v = await mug()
    __setDemoRole(org.id, 'sales')
    await expect(gw.saveShopPolicy(org.id, DEFAULT_SHOP_POLICY)).rejects.toThrow(/cannot/)
    __setDemoRole(org.id, 'owner')
    await expect(gw.saveShopPolicy(org.id, { ...DEFAULT_SHOP_POLICY, maxDeliveryAttempts: 0 })).rejects.toThrow(/Between 1 and 5/)
    await gw.saveShopPolicy(org.id, { ...DEFAULT_SHOP_POLICY, paymentMode: 'full_prepay' })
    await expect(sf.placeOrder('mto-home', guest(v.id, 1, { payment: 'cod' }), key())).rejects.toThrow(/full payment before delivery/)
    const q = await sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'pickup' })
    expect(q.depositDueMinor).toBe(q.totalMinor)
  })

  it('delivers to a pick-up point at the point’s fee, without a pin', async () => {
    const v = await mug()
    const point = (await sf.getCheckoutOptions('mto-home')).pickupPoints[0]
    const q = await sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'pickup_point', pickupPointId: point.id })
    expect(q.deliveryFeeMinor).toBe(point.feeMinor)
    expect(q.pickupPoint?.name).toBe(point.name)
    await expect(sf.quote('mto-home', { lines: [{ variantId: v.id, quantity: 1 }], method: 'pickup_point', pickupPointId: 'nope' })).rejects.toThrow(
      /Choose a pick-up point/,
    )
    const placed = await sf.placeOrder('mto-home', guest(v.id, 1, { method: 'pickup_point', pickupPointId: point.id, lat: undefined, lng: undefined }), key())
    const t = await sf.track(placed.trackingToken)
    expect(t.fulfilment.method).toBe('delivery')
    expect(t.delivery?.handoff).toMatchObject({ kind: 'pickup_point', pickupPoint: { name: point.name } })
  })
})

describe('demo failed delivery and rider link', () => {
  async function dispatchedOrder(paid: boolean) {
    const org = await mto()
    const v = await mug()
    const placed = await sf.placeOrder('mto-home', guest(v.id, 3), key())
    if (paid) {
      await gw.recordManualPayment(
        org.id,
        { orderId: placed.orderId, amountMinor: placed.depositDueMinor ?? 0, currency: 'KES', method: 'mobile_money', externalRef: null, receivedAt: new Date().toISOString(), note: null },
        key(),
      )
    }
    for (const to of ['confirmed', 'ready', 'dispatched'] as const) await gw.transitionOrder(org.id, placed.orderId, to, null)
    return { org, placed }
  }

  it('applies the agreed policy: fee kept for buyer faults, attempts counted, stop at max, history and tracking updated', async () => {
    const { org, placed } = await dispatchedOrder(true)
    const k = key()
    const r1 = await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'buyer_unreachable', note: 'Phone off' }, k)
    expect(r1).toEqual({ attempt: 1, forfeitMinor: 30000, final: false })
    expect(await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'buyer_unreachable', note: null }, k)).toEqual(r1)
    const r2 = await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'shop_issue', note: null }, key())
    expect(r2).toEqual({ attempt: 2, forfeitMinor: 0, final: true })
    await expect(gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'other', note: null }, key())).rejects.toThrow(/All 2 delivery attempts/)

    const detail = await gw.getOrder(org.id, placed.orderId)
    expect(detail.status).toBe('dispatched')
    expect(detail.history.filter((h) => h.fromStatus === h.toStatus).map((h) => h.note)).toEqual([
      'Delivery attempt 1 of 2 failed: Buyer could not be reached. Delivery fee kept from deposit per policy. Phone off',
      'Delivery attempt 2 of 2 failed: Problem on the shop’s side.',
    ])
    const d = await gw.getOrderDelivery(org.id, placed.orderId)
    expect(d).toMatchObject({ attempts: 2, forfeitedMinor: 30000 })
    const t = await sf.track(placed.trackingToken)
    expect(t.delivery?.events.map((e) => [e.kind, e.reason, e.forfeitedMinor])).toEqual([
      ['failed', 'buyer_unreachable', 30000],
      ['failed', 'shop_issue', 0],
    ])
  })

  it('needs fulfilment permission and an order out for delivery', async () => {
    const org = await mto()
    const v = await mug()
    const placed = await sf.placeOrder('mto-home', guest(v.id, 1), key())
    await expect(gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'other', note: null }, key())).rejects.toThrow(/out for delivery/)
    __setDemoRole(org.id, 'analyst')
    await expect(gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'other', note: null }, key())).rejects.toThrow(/cannot/)
  })

  it('rider link: masked phone until accepted, deposit gate, actions update the order, expiry and revoke', async () => {
    const org = await mto()
    const v = await mug()
    const placed = await sf.placeOrder('mto-home', guest(v.id, 3), key())
    await expect(gw.createRiderLink(org.id, placed.orderId, { riderName: 'Otieno', hours: 6 })).rejects.toThrow(/Confirm the order/)
    await gw.transitionOrder(org.id, placed.orderId, 'confirmed', null)
    const link = await gw.createRiderLink(org.id, placed.orderId, { riderName: 'Otieno', hours: 6 })
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/)

    const job = await sf.riderJob(link.token)
    expect(job).toMatchObject({ accepted: false, phoneMasked: true, buyerPhone: '••• ••• 333', drop: { landmark: 'Gate B' } })
    await expect(sf.riderAction(link.token, 'picked_up')).rejects.toThrow(/Accept the job first/)
    expect(await sf.riderAccept(link.token, 'Otieno K')).toMatchObject({ accepted: true, buyerPhone: '+254799000333' })
    await expect(sf.riderAction(link.token, 'picked_up')).rejects.toThrow(/deposit has not been received/)
    await gw.recordManualPayment(
      org.id,
      { orderId: placed.orderId, amountMinor: placed.depositDueMinor ?? 0, currency: 'KES', method: 'mobile_money', externalRef: null, receivedAt: new Date().toISOString(), note: null },
      key(),
    )
    expect(await sf.riderAction(link.token, 'picked_up')).toMatchObject({ status: 'dispatched' })
    expect(await sf.riderAction(link.token, 'failed', 'buyer_refused')).toMatchObject({ attempts: 1 })
    expect(await sf.riderAction(link.token, 'delivered')).toMatchObject({ status: 'delivered', collectMinor: expect.any(Number) })
    expect((await gw.getOrder(org.id, placed.orderId)).fulfilment.assignee).toBe('Otieno K')

    await expect(sf.riderJob('A'.repeat(32))).rejects.toThrow(/not valid/)

    const p2 = await sf.placeOrder('mto-home', guest(v.id, 1, { phoneE164: '+254799000444' }), key())
    await gw.transitionOrder(org.id, p2.orderId, 'confirmed', null)
    vi.useFakeTimers({ now: Date.now() })
    const l2 = await gw.createRiderLink(org.id, p2.orderId, { riderName: null, hours: 1 })
    vi.setSystemTime(Date.now() + 61 * 60_000)
    await expect(sf.riderJob(l2.token)).rejects.toThrow(/expired/)
    vi.useRealTimers()
    const l3 = await gw.createRiderLink(org.id, p2.orderId, { riderName: null, hours: 12 })
    await gw.revokeRiderLink(org.id, p2.orderId)
    await expect(sf.riderJob(l3.token)).rejects.toThrow(/cancelled this rider link/)
  })

  it('records courier handoff with a tracking number', async () => {
    const { org, placed } = await dispatchedOrder(false)
    await expect(gw.setOrderHandoff(org.id, placed.orderId, { kind: 'courier', carrier: '' })).rejects.toThrow(/courier/)
    await gw.setOrderHandoff(org.id, placed.orderId, { kind: 'courier', carrier: 'G4S', trackingRef: 'AB123' })
    const t = await sf.track(placed.trackingToken)
    expect(t.fulfilment.trackingRef).toBe('AB123')
    expect(t.delivery?.handoff).toMatchObject({ kind: 'courier', carrier: 'G4S' })
  })
})
