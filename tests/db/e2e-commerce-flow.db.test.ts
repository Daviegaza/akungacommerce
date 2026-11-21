import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createSupabaseStorefront } from '../../src/gateway/storefront-supabase'
import type { CommerceGateway } from '../../src/gateway/gateway'
import { SHOP_PIN, seedMerchant, shopSettings } from '../support/merchant'

/**
 * End-to-end commerce flow through the SAME gateway code the browser uses
 * (src/gateway/supabase.ts and storefront-supabase.ts), over HTTP against a real
 * Supabase stack (Auth + PostgREST + RLS + RPCs). No demo data is involved.
 *
 * Merchant signs up -> creates a business -> adds a product -> receives stock ->
 * publishes the shop -> a shopper (anon key only) loads the shop, gets a server quote
 * and places an order -> stock is reserved -> the merchant sees the order ->
 * moves it through fulfilment -> the shopper's tracking link shows each step.
 * Run for two organisations at once to prove they never see each other's data.
 *
 * Needs SUPABASE_API_URL and SUPABASE_ANON_KEY (local: `npx supabase status`).
 */
const API = process.env.SUPABASE_API_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const run = describe.skipIf(!API || !ANON)

const NEAR = { lat: SHOP_PIN.lat + 3 / 111.2, lng: SHOP_PIN.lng }

const gateways: CommerceGateway[] = []
afterAll(async () => {
  for (const g of gateways) await g.signOut().catch(() => {})
})

async function merchant(label: string, productName: string, priceMinor: number) {
  const m = await seedMerchant(API, ANON, label, productName, priceMinor)
  gateways.push(m.g)
  return m
}

run('end-to-end commerce flow (real gateways, two organisations)', () => {
  it('merchant product -> public shop -> server-priced order -> stock reserved -> fulfilment -> tracking', async () => {
    const a = await merchant('alpha', 'Sisal Basket', 250_000)
    const b = await merchant('bravo', 'Clay Vase', 99_000)
    const shopper = createSupabaseStorefront(API, ANON)

    // The public shop shows the merchant's real catalogue, and only that merchant's.
    const shopA = await shopper.getStorefront(a.slug)
    expect(shopA.products.map((p) => p.name)).toEqual(['Sisal Basket'])
    const shopB = await shopper.getStorefront(b.slug)
    expect(shopB.products.map((p) => p.name)).toEqual(['Clay Vase'])

    // Server quote: price, 16 % tax and the 3 km band (<= 5 km -> KES 200) come from the server.
    const lines = [{ variantId: a.variantId, quantity: 2 }]
    const quote = await shopper.quote(a.slug, { lines, method: 'delivery', ...NEAR })
    expect(quote).toMatchObject({ currency: 'KES', subtotalMinor: 500_000, taxMinor: 80_000, deliveryFeeMinor: 20_000, totalMinor: 600_000 })

    // A variant from another shop cannot be bought through this shop.
    await expect(shopper.quote(a.slug, { lines: [{ variantId: b.variantId, quantity: 1 }], method: 'pickup' })).rejects.toThrow()

    // Place the order. Client-sent extras (a forged price) are not part of the contract and are ignored.
    const forged = { ...lines[0], unitPriceMinor: 1 } as (typeof lines)[number]
    const key = randomUUID()
    const placed = await shopper.placeOrder(
      a.slug,
      { lines: [forged], method: 'delivery', ...NEAR, name: 'Wanjiku Test', phoneE164: '+254711000111', payment: 'cod', addressLine: 'Rhapta Rd', marketingOptIn: false },
      key,
    )
    expect(placed.totalMinor).toBe(600_000)
    // Same idempotency key = same order, not a second one.
    const again = await shopper.placeOrder(
      a.slug,
      { lines, method: 'delivery', ...NEAR, name: 'Wanjiku Test', phoneE164: '+254711000111', payment: 'cod', addressLine: 'Rhapta Rd', marketingOptIn: false },
      key,
    )
    expect(again.orderId).toBe(placed.orderId)

    // Stock is reserved for the pending order.
    const variant = (await a.g.listProducts(a.orgId)).flatMap((p) => p.variants).find((v) => v.id === a.variantId)!
    expect({ onHand: variant.onHand, reserved: variant.reserved }).toEqual({ onHand: 10, reserved: 2 })

    // The merchant receives it; the other merchant cannot see it.
    const ordersA = await a.g.listOrders(a.orgId)
    expect(ordersA.map((o) => o.id)).toContain(placed.orderId)
    expect(ordersA.find((o) => o.id === placed.orderId)).toMatchObject({ status: 'pending_confirmation', channel: 'storefront', totalMinor: 600_000 })
    expect((await b.g.listOrders(b.orgId)).map((o) => o.id)).not.toContain(placed.orderId)
    await expect(b.g.getOrder(a.orgId, placed.orderId)).rejects.toThrow()
    await expect(b.g.transitionOrder(a.orgId, placed.orderId, 'cancelled', 'not mine')).rejects.toThrow()

    // Tracking before fulfilment.
    let tracked = await shopper.track(placed.trackingToken)
    expect(tracked).toMatchObject({ number: placed.number, status: 'pending_confirmation', totalMinor: 600_000, customerFirstName: 'Wanjiku' })

    // Merchant fulfils.
    await a.g.transitionOrder(a.orgId, placed.orderId, 'confirmed', null)
    await a.g.transitionOrder(a.orgId, placed.orderId, 'preparing', null)
    await a.g.updateFulfilment(a.orgId, placed.orderId, { assignee: 'Otieno', trackingRef: null })
    await a.g.transitionOrder(a.orgId, placed.orderId, 'ready', null)
    await a.g.transitionOrder(a.orgId, placed.orderId, 'dispatched', null)

    // Dispatch commits the stock.
    const afterDispatch = (await a.g.listProducts(a.orgId)).flatMap((p) => p.variants).find((v) => v.id === a.variantId)!
    expect({ onHand: afterDispatch.onHand, reserved: afterDispatch.reserved }).toEqual({ onHand: 8, reserved: 0 })

    tracked = await shopper.track(placed.trackingToken)
    expect(tracked.status).toBe('dispatched')
    expect(tracked.history.map((h) => h.status)).toEqual(['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched'])

    await a.g.transitionOrder(a.orgId, placed.orderId, 'delivered', null)
    expect((await shopper.track(placed.trackingToken)).status).toBe('delivered')

    // The tracking token is the only key: a made-up token finds nothing.
    await expect(shopper.track(randomUUID().replace(/-/g, ''))).rejects.toThrow()
  })

  it('an unpublished shop is not reachable', async () => {
    const c = await merchant('charlie', 'Linen Throw', 120_000)
    await c.g.saveShopSettings(c.orgId, { ...shopSettings(c.slug), published: false })
    await expect(createSupabaseStorefront(API, ANON).getStorefront(c.slug)).rejects.toThrow()
  })
})
