import { beforeEach, describe, expect, it } from 'vitest'
import { planReturnToShop, returnedToShopBuyerText } from '@/domain/delivery-policy'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { newIdempotencyKey } from './gateway'
import { createDemoStorefront } from './storefront-demo'
import type { PlaceOrderInput } from './storefront'

const gw = createDemoGateway()
const sf = createDemoStorefront()
const NEAR = { lat: -1.2676 + 5 / ((2 * Math.PI * 6371.0088) / 360), lng: 36.8108 } // ~5 km -> KSh 300 band
const key = () => `k-${newIdempotencyKey()}`

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
    name: 'Achieng Test',
    phoneE164: '+254799000555',
    payment: 'mpesa',
    marketingOptIn: false,
    ...extra,
  }
}

async function onHand(orgId: string, variantId: string) {
  const v = (await gw.listProducts(orgId)).flatMap((p) => p.variants).find((x) => x.id === variantId)
  return { onHand: v?.onHand ?? NaN, reserved: v?.reserved ?? NaN }
}

/** A storefront order (3 mugs), deposit paid, out for delivery. */
async function dispatched(opts: { pay?: number | 'deposit' } = { pay: 'deposit' }) {
  const org = await mto()
  const v = await mug()
  const placed = await sf.placeOrder('mto-home', guest(v.id, 3), key())
  const amount = opts.pay === 'deposit' ? (placed.depositDueMinor ?? 0) : (opts.pay ?? 0)
  if (amount > 0) {
    await gw.recordManualPayment(
      org.id,
      { orderId: placed.orderId, amountMinor: amount, currency: 'KES', method: 'mobile_money', externalRef: null, receivedAt: new Date().toISOString(), note: null },
      key(),
    )
  }
  for (const to of ['confirmed', 'ready', 'dispatched'] as const) await gw.transitionOrder(org.id, placed.orderId, to, null)
  return { org, v, placed, paid: amount }
}

beforeEach(() => resetDemoWorkspace())

describe('planReturnToShop (pure)', () => {
  it('keeps the forfeited fee (never more than was paid) and suggests the rest', () => {
    expect(planReturnToShop({ netPaidMinor: 100_000, forfeitedMinor: 30_000 })).toEqual({ keptMinor: 30_000, refundMinor: 70_000 })
    expect(planReturnToShop({ netPaidMinor: 20_000, forfeitedMinor: 30_000 })).toEqual({ keptMinor: 20_000, refundMinor: 0 })
    expect(planReturnToShop({ netPaidMinor: 0, forfeitedMinor: 0 })).toEqual({ keptMinor: 0, refundMinor: 0 })
    expect(planReturnToShop({ netPaidMinor: -5, forfeitedMinor: 10 })).toEqual({ keptMinor: 0, refundMinor: 0 })
  })

  it('buyer wording is plain and names the money', () => {
    const money = (m: number) => `KSh ${m / 100}`
    const t = returnedToShopBuyerText({ attempts: 2, forfeitedMinor: 30_000, refund: { amountMinor: 31_200, keptMinor: 30_000, status: 'pending' } }, money)
    expect(t.title).toBe('Your order went back to the shop')
    expect(t.lines).toEqual([
      'After 2 delivery attempts didn’t go through, your order was taken back to the shop and closed.',
      'The shop owes you KSh 312 and will send it back to you.',
      'The KSh 300 delivery fee was kept, as the shop policy you agreed to says.',
    ])
    expect(returnedToShopBuyerText({ attempts: 1, forfeitedMinor: 0, refund: null }, money).lines).toEqual([
      'After a delivery attempt didn’t go through, your order was taken back to the shop and closed.',
    ])
  })
})

describe('demo: returned to shop', () => {
  it('a plain status change cannot cancel an order that is out for delivery', async () => {
    const { org, placed } = await dispatched()
    await expect(gw.transitionOrder(org.id, placed.orderId, 'cancelled', null)).rejects.toThrow(/returned to the shop/)
    expect((await gw.getOrder(org.id, placed.orderId)).status).toBe('dispatched')
  })

  it('after the last failed attempt: stock back, order cancelled, fee kept, rest suggested as a refund, history and tracking updated', async () => {
    const { org, v, placed, paid } = await dispatched()
    const stockBefore = await onHand(org.id, v.id)
    await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'buyer_unreachable', note: null }, key())
    const last = await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'buyer_refused', note: null }, key())
    expect(last.final).toBe(true)

    const k = key()
    const r = await gw.returnToShop(org.id, placed.orderId, { note: 'Rider brought it back' }, k)
    // Fee kept for the first buyer-caused failure (KSh 300) and the second (capped at what is left of the deposit).
    const d = await gw.getOrderDelivery(org.id, placed.orderId)
    expect(r.keptMinor).toBe(d.forfeitedMinor)
    expect(r.refundMinor).toBe(paid - d.forfeitedMinor)
    expect(r.replayed).toBe(false)
    expect(await gw.returnToShop(org.id, placed.orderId, { note: null }, k)).toMatchObject({ replayed: true, refundMinor: r.refundMinor })

    const detail = await gw.getOrder(org.id, placed.orderId)
    expect(detail.status).toBe('cancelled')
    expect(detail.lines.every((l) => l.returnedQuantity === l.quantity)).toBe(true)
    const last2 = detail.history.at(-1)
    expect(last2).toMatchObject({ fromStatus: 'dispatched', toStatus: 'cancelled' })
    expect(last2?.note).toMatch(/^Returned to shop after 2 failed delivery attempts\. Items back in stock\. Rider brought it back$/)

    const stockAfter = await onHand(org.id, v.id)
    expect(stockAfter.onHand).toBe(stockBefore.onHand + 3)
    expect(stockAfter.reserved).toBe(stockBefore.reserved)

    expect(d.returnedAt).toEqual(expect.any(String))
    expect(d.refundSuggestion).toMatchObject({ status: 'pending', amountMinor: r.refundMinor, keptMinor: r.keptMinor, currency: 'KES' })
    // Nothing was refunded automatically.
    expect(detail.refunds).toHaveLength(0)

    const t = await sf.track(placed.trackingToken)
    expect(t.status).toBe('cancelled')
    expect(t.delivery?.returnedAt).toEqual(expect.any(String))
    expect(t.delivery?.refund).toEqual(d.refundSuggestion?.amountMinor ? { amountMinor: r.refundMinor, keptMinor: r.keptMinor, status: 'pending' } : null)
    expect(t.delivery?.events.at(-1)).toMatchObject({ kind: 'returned', note: null })
  })

  it('confirming the suggestion records ordinary refunds; dismissing needs a reason; both write history', async () => {
    const { org, placed } = await dispatched({ pay: 100_000 })
    await gw.markDeliveryFailed(org.id, placed.orderId, { reason: 'rider_issue', note: null }, key())
    await gw.returnToShop(org.id, placed.orderId, { note: null }, key())
    const s = (await gw.getOrderDelivery(org.id, placed.orderId)).refundSuggestion
    // Not the buyer's fault: everything they paid is refundable.
    expect(s).toMatchObject({ status: 'pending', amountMinor: 100_000, keptMinor: 0 })

    __setDemoRole(org.id, 'fulfilment')
    await expect(gw.confirmRefundSuggestion(org.id, s!.id, key())).rejects.toThrow(/cannot/)
    __setDemoRole(org.id, 'owner')
    const k = key()
    await gw.confirmRefundSuggestion(org.id, s!.id, k)
    await gw.confirmRefundSuggestion(org.id, s!.id, k)
    const detail = await gw.getOrder(org.id, placed.orderId)
    expect(detail.refunds.map((x) => x.amountMinor)).toEqual([100_000])
    expect(detail.status).toBe('cancelled') // never flips to "refunded" for a returned order
    expect(detail.history.at(-1)?.note).toBe('Refund to the buyer recorded for the returned order.')
    expect((await gw.getOrderDelivery(org.id, placed.orderId)).refundSuggestion?.status).toBe('confirmed')
    await expect(gw.dismissRefundSuggestion(org.id, s!.id, 'x')).rejects.toThrow(/already settled/)
    expect((await sf.track(placed.trackingToken)).delivery?.refund?.status).toBe('confirmed')

    const second = await dispatched({ pay: 50_000 })
    await gw.returnToShop(second.org.id, second.placed.orderId, { note: null }, key())
    const s2 = (await gw.getOrderDelivery(org.id, second.placed.orderId)).refundSuggestion!
    await expect(gw.dismissRefundSuggestion(org.id, s2.id, '  ')).rejects.toThrow(/Say why/)
    await gw.dismissRefundSuggestion(org.id, s2.id, 'Buyer took store credit')
    expect((await gw.getOrderDelivery(org.id, second.placed.orderId)).refundSuggestion).toMatchObject({ status: 'dismissed', resolutionNote: 'Buyer took store credit' })
    expect((await gw.getOrder(org.id, second.placed.orderId)).refunds).toHaveLength(0)
  })

  it('nothing paid: no refund suggestion; needs refunds permission, a delivery order out for delivery', async () => {
    const { org, placed } = await dispatched({ pay: 0 })
    __setDemoRole(org.id, 'fulfilment')
    await expect(gw.returnToShop(org.id, placed.orderId, { note: null }, key())).rejects.toThrow(/cannot/)
    __setDemoRole(org.id, 'owner')
    await expect(gw.returnToShop(org.id, placed.orderId, { note: null }, 'short')).rejects.toThrow(/idempotency/)
    const r = await gw.returnToShop(org.id, placed.orderId, { note: null }, key())
    expect(r).toMatchObject({ refundMinor: 0, refundSuggestionId: null })
    expect((await gw.getOrderDelivery(org.id, placed.orderId)).refundSuggestion).toBeNull()
    await expect(gw.returnToShop(org.id, placed.orderId, { note: null }, key())).rejects.toThrow(/out for delivery/)

    const v = await mug()
    const pickup = await sf.placeOrder('mto-home', guest(v.id, 1, { method: 'pickup', lat: undefined, lng: undefined, phoneE164: '+254799000666' }), key())
    await expect(gw.returnToShop(org.id, pickup.orderId, { note: null }, key())).rejects.toThrow(/out for delivery/)
  })

  it('a rider link cannot act on a returned order', async () => {
    const org = await mto()
    const v = await mug()
    const placed = await sf.placeOrder('mto-home', guest(v.id, 3), key())
    await gw.recordManualPayment(
      org.id,
      { orderId: placed.orderId, amountMinor: placed.depositDueMinor ?? 0, currency: 'KES', method: 'mobile_money', externalRef: null, receivedAt: new Date().toISOString(), note: null },
      key(),
    )
    await gw.transitionOrder(org.id, placed.orderId, 'confirmed', null)
    const link = await gw.createRiderLink(org.id, placed.orderId, { riderName: 'Juma', hours: 6 })
    await sf.riderAccept(link.token, 'Juma')
    await sf.riderAction(link.token, 'picked_up')
    await gw.returnToShop(org.id, placed.orderId, { note: null }, key())
    await expect(sf.riderJob(link.token)).rejects.toThrow(/cancelled this rider link/)
  })
})

describe('demo: storefront consent source', () => {
  it('records consent from a storefront order as checkout even with a staff session in the browser', async () => {
    const org = await mto()
    const v = await mug()
    // The demo workspace is signed in as staff by default (the same browser session the merchant uses).
    await sf.placeOrder('mto-home', guest(v.id, 1, { method: 'pickup', lat: undefined, lng: undefined, phoneE164: '+254799000777', marketingOptIn: true }), key())
    const c = (await gw.listCustomers(org.id)).find((x) => x.phoneE164 === '+254799000777')
    expect(c).toMatchObject({ marketingConsent: true, consentSource: 'checkout' })

    // An existing customer (created by staff, no consent) who opts in at checkout is also stamped checkout.
    await gw.saveCustomer(org.id, { name: 'Known Buyer', phoneE164: '+254799000888', email: null, countryCode: 'KE', marketingConsent: false, tags: [], notes: null })
    await sf.placeOrder('mto-home', guest(v.id, 1, { method: 'pickup', lat: undefined, lng: undefined, phoneE164: '+254799000888', marketingOptIn: true }), key())
    expect((await gw.listCustomers(org.id)).find((x) => x.phoneE164 === '+254799000888')).toMatchObject({ marketingConsent: true, consentSource: 'checkout' })
  })
})
