import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, level, one, type TestUser } from './helpers'
import {
  asAnon,
  deliverOrder,
  guestOrder,
  orderStatus,
  randomIp,
  receiveStock,
  saveShop,
  sf,
  sfKey,
  uniqueSlug,
} from './storefront-helpers'
import { deliveryFeeFor, haversineKm } from '../../src/gateway/storefront'
import { computeOrderTotals } from '../../src/domain/orders'

const run = describe.skipIf(!DB_URL)

// Shop pin (Westlands, Nairobi) and drop pins at known distances due north.
const SHOP = { lat: -1.2676, lng: 36.8108 }
const KM_PER_DEG_LAT = (2 * Math.PI * 6371.0088) / 360
const north = (km: number) => ({ lat: SHOP.lat + km / KM_PER_DEG_LAT, lng: SHOP.lng })
const BANDS = [
  { maxKm: 3, feeMinor: 15000 },
  { maxKm: 8, feeMinor: 30000 },
  { maxKm: 15, feeMinor: 50000 },
]

type Placed = { order_id: string; number: number; tracking_token: string; total_minor: number; currency: string }

async function kesShop(owner: TestUser, opts: { cod?: boolean } = {}) {
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const slug = uniqueSlug('sf')
  await saveShop(owner, org, { slug, cod: opts.cod })
  const { productId, variantId } = await createProduct(owner, org, 150000, { taxBps: 1600 })
  await receiveStock(owner, org, variantId, 50)
  return { org, slug, productId, variantId }
}

run('storefront: public access', () => {
  let owner: TestUser
  let org: string, slug: string, unpublishedSlug: string

  beforeAll(async () => {
    owner = await createUser('sf-owner')
    ;({ org, slug } = await kesShop(owner))
    const other = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    unpublishedSlug = uniqueSlug('hidden')
    await saveShop(owner, other, { slug: unpublishedSlug, published: false, lat: null, lng: null })
  })

  it('anon can load a published shop with its products and server-computed availability', async () => {
    const data = await sf<{ shop: Record<string, unknown>; products: Record<string, unknown>[] }>('storefront_get', [slug.toUpperCase()])
    expect(data.shop).toMatchObject({ slug, currency: 'KES', tax_mode: 'exclusive', rating: null, mpesa_till: '5123456' })
    expect(data.products).toHaveLength(1)
    const p = data.products[0] as { sold_count: unknown; rating: unknown; variants: { available: number; price_minor: number }[] }
    expect(p.sold_count).toBeNull()
    expect(p.rating).toBeNull()
    expect(p.variants[0]).toMatchObject({ available: 50, price_minor: 150000 })
  })

  it('unpublished or unknown shops are not found', async () => {
    await expect(sf('storefront_get', [unpublishedSlug])).rejects.toThrow(/Shop not found/)
    await expect(sf('storefront_get', ['no-such-shop-here'])).rejects.toThrow(/Shop not found/)
    expect(await sf('storefront_reviews', [unpublishedSlug, '00000000-0000-0000-0000-000000000000'])).toEqual([])
  })

  it('anon cannot read storefront tables directly or call staff/internal functions', async () => {
    for (const table of ['shop_settings', 'reviews', 'orders', 'products', 'customers', 'rate_limits', 'mpesa_requests']) {
      const res = await asAnon(`select * from public.${table}`).then(
        (rows) => ({ rows }),
        (e: Error) => ({ error: e.message }),
      )
      if ('rows' in res) expect(res.rows, table).toHaveLength(0)
      else expect(res.error, table).toMatch(/permission denied/)
    }
    await expect(asAnon(`select public.save_shop_settings($1, '{}'::jsonb)`, [org])).rejects.toThrow(/permission denied/)
    await expect(asAnon(`select public._rate_limit('x', 1, interval '1 hour')`)).rejects.toThrow(/permission denied/)
    await expect(asAnon(`select public.create_order($1, '{}'::jsonb, 'k')`, [org])).rejects.toThrow(/permission denied/)
  })

  it('staff cannot write shop_settings or mpesa_requests directly; they read only their own prompts', async () => {
    await expect(asUser(owner, `update public.shop_settings set published = false where org_id = $1`, [org])).rejects.toThrow(/permission denied/)
    // Since 20261120000020 members may read their own org's prompts (reconciliation view), never write them.
    await expect(asUser(owner, `update public.mpesa_requests set status = 'paid'`)).rejects.toThrow(/permission denied/)
    const foreign = await asUser(owner, `select 1 from public.mpesa_requests where org_id <> $1`, [org])
    expect(foreign).toHaveLength(0)
  })
})

run('storefront: quotes and delivery fees', () => {
  let owner: TestUser
  let slug: string, variantId: string

  beforeAll(async () => {
    owner = await createUser('sf-quote')
    ;({ slug, variantId } = await kesShop(owner))
  })

  it('SQL haversine_km and delivery_fee_for match the TypeScript helpers', async () => {
    for (const km of [0.5, 2.9, 3.2, 7.5, 12, 14.9, 40]) {
      const p = north(km)
      const r = await one<{ km: number; fee: string | null }>(
        owner,
        `select public.haversine_km($1, $2, $3, $4) as km, public.delivery_fee_for($5::jsonb, public.haversine_km($1, $2, $3, $4)) as fee`,
        [SHOP.lat, SHOP.lng, p.lat, p.lng, JSON.stringify(BANDS.map((b) => ({ max_km: b.maxKm, fee_minor: b.feeMinor })))],
      )
      const jsKm = haversineKm(SHOP.lat, SHOP.lng, p.lat, p.lng)
      expect(r.km).toBeCloseTo(jsKm, 9)
      expect(r.km).toBeCloseTo(km, 6)
      expect(r.fee === null ? null : Number(r.fee)).toBe(deliveryFeeFor(BANDS, jsKm))
    }
  })

  it('ignores client prices and charges delivery by distance band', async () => {
    for (const [km, fee] of [
      [2, 15000],
      [5, 30000],
      [12, 50000],
    ] as const) {
      const p = north(km)
      const q = await sf<Record<string, number>>('storefront_quote', [
        slug,
        JSON.stringify({ lines: [{ variant_id: variantId, quantity: 2, unit_price_minor: 1 }], method: 'delivery', ...p, total_minor: 5 }),
      ])
      const expected = computeOrderTotals({
        currency: 'KES',
        taxMode: 'exclusive',
        deliveryFeeMinor: fee,
        lines: [{ unitPriceMinor: 150000, quantity: 2, taxRateBps: 1600, discountMinor: 0, currency: 'KES' }],
      })
      expect(Number(q.delivery_fee_minor)).toBe(fee)
      expect(Number(q.delivery_fee_minor)).toBe(deliveryFeeFor(BANDS, haversineKm(SHOP.lat, SHOP.lng, p.lat, p.lng)))
      expect(Number(q.distance_km)).toBeCloseTo(km, 1)
      expect(Number(q.subtotal_minor)).toBe(300000)
      expect(Number(q.tax_minor)).toBe(expected.taxMinor)
      expect(Number(q.total_minor)).toBe(expected.totalMinor)
    }
  })

  it('rejects out-of-area pins, missing pins, empty bags and bad quantities', async () => {
    const quote = (input: unknown) => sf('storefront_quote', [slug, JSON.stringify(input)])
    await expect(quote({ lines: [{ variant_id: variantId, quantity: 1 }], method: 'delivery', ...north(20) })).rejects.toThrow(
      /outside the delivery area \(20(\.0)? km away\)/,
    )
    await expect(quote({ lines: [{ variant_id: variantId, quantity: 1 }], method: 'delivery' })).rejects.toThrow(/Drop a pin/)
    await expect(quote({ lines: [], method: 'pickup' })).rejects.toThrow(/empty/)
    await expect(quote({ lines: [{ variant_id: variantId, quantity: 0 }], method: 'pickup' })).rejects.toThrow(/Invalid quantity/)
    await expect(quote({ lines: [{ variant_id: variantId, quantity: 51 }], method: 'pickup' })).rejects.toThrow(/Only 50 of/)
  })
})

run('storefront: guest checkout', () => {
  let owner: TestUser
  let org: string, slug: string, variantId: string, productId: string

  beforeAll(async () => {
    owner = await createUser('sf-checkout')
    ;({ org, slug, variantId, productId } = await kesShop(owner))
  })

  const place = (input: unknown, idem = sfKey(), s = slug, ip?: string) =>
    sf<Placed>('storefront_place_order', [s, JSON.stringify(input), idem], ip)

  it('creates a pending_confirmation storefront order that reserves stock and upserts the customer by phone', async () => {
    const phone = '+254700111222'
    const before = await level(owner, variantId)
    const idem = sfKey()
    const input = guestOrder({ lines: [{ variant_id: variantId, quantity: 3, unit_price_minor: 1 }], method: 'delivery', ...north(5), phone_e164: phone })
    const placed = await place(input, idem)
    expect(placed.tracking_token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(placed.currency).toBe('KES')

    // Same key (double tap / retry) -> same order, no second reservation.
    const again = await place(input, idem)
    expect(again).toEqual(placed)
    const after = await level(owner, variantId)
    expect(after.reserved).toBe(before.reserved + 3)
    expect(after.on_hand).toBe(before.on_hand)

    const o = await orderStatus(owner, placed.order_id)
    expect(o).toMatchObject({ status: 'pending_confirmation', channel: 'storefront' })
    expect(Number(o.delivery_fee_minor)).toBe(30000)
    expect(Number(o.total_minor)).toBe(placed.total_minor)

    const customers = await asUser<{ id: string; marketing_consent: boolean; tags: string[]; name: string }>(
      owner,
      `select id, marketing_consent, tags, name from public.customers where org_id = $1 and phone_e164 = $2`,
      [org, phone],
    )
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({ marketing_consent: false, tags: ['storefront'], name: 'Wairimu Test' })
    expect(o.customer_id).toBe(customers[0].id)

    // Same phone, new order: reuses the customer; opting in switches consent on (never off).
    await place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], phone_e164: phone, marketing_opt_in: true, name: 'Someone Else' }))
    const after2 = await asUser<{ marketing_consent: boolean }>(owner, `select marketing_consent from public.customers where org_id = $1 and phone_e164 = $2`, [org, phone])
    expect(after2).toEqual([{ marketing_consent: true }])
  })

  it('rejects overselling without reserving anything', async () => {
    const before = await level(owner, variantId)
    const available = before.on_hand - before.reserved
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: available + 1 }] }))).rejects.toThrow(/Only \d+ of .* left/)
    expect(await level(owner, variantId)).toEqual(before)
  })

  it('rejects COD when the shop has it off, bad phones and names', async () => {
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], payment: 'cod' }))).rejects.toThrow(/Cash on delivery is not available/)
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], phone_e164: '0712345678' }))).rejects.toThrow(/valid phone/)
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], name: 'A' }))).rejects.toThrow(/your name/)
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }] }), 'short')).rejects.toThrow(/idempotency/)
  })

  it('accepts COD when enabled', async () => {
    const codShop = await kesShop(owner, { cod: true })
    const placed = await place(guestOrder({ lines: [{ variant_id: codShop.variantId, quantity: 1 }], payment: 'cod' }), sfKey(), codShop.slug)
    const t = await sf<{ payment_preference: string }>('storefront_track', [placed.tracking_token])
    expect(t.payment_preference).toBe('cod')
  })

  it('refuses a scheduled drop before available_from', async () => {
    const drop = await createProduct(owner, org, 99000)
    await receiveStock(owner, org, drop.variantId, 5)
    await asUser(owner, `select public.set_product_merchandising($1, $2, '[]'::jsonb, true, now() + interval '3 days')`, [org, drop.productId])
    await expect(place(guestOrder({ lines: [{ variant_id: drop.variantId, quantity: 1 }] }))).rejects.toThrow(/is not available yet/)
    await asUser(owner, `select public.set_product_merchandising($1, $2, '[]'::jsonb, true, now() - interval '1 minute')`, [org, drop.productId])
    expect((await place(guestOrder({ lines: [{ variant_id: drop.variantId, quantity: 1 }] }))).order_id).toBeTruthy()
  })

  it('rate-limits a phone after 6 orders an hour', async () => {
    const phone = '+254700333444'
    for (let i = 0; i < 6; i++) await place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], phone_e164: phone }), sfKey(), slug, randomIp())
    await expect(place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], phone_e164: phone }), sfKey(), slug, randomIp())).rejects.toThrow(
      /Too many attempts/,
    )
  })

  it('tracks an order by token and refuses bad tokens', async () => {
    const placed = await place(guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], method: 'delivery', ...north(2), name: 'Achieng Otieno' }))
    const t = await sf<Record<string, unknown>>('storefront_track', [placed.tracking_token])
    expect(t).toMatchObject({ number: placed.number, status: 'pending_confirmation', customer_first_name: 'Achieng', paid_minor: 0, reviewed_product_ids: [] })
    expect((t.lines as { product_id: string }[])[0].product_id).toBe(productId)
    expect((t.history as { status: string }[]).map((h) => h.status)).toEqual(['pending_confirmation'])
    expect((t.fulfilment as { method: string; drop_lat: number }).method).toBe('delivery')
    expect((t.fulfilment as { drop_lat: number }).drop_lat).toBeCloseTo(north(2).lat, 9)
    expect((t.shop as { slug: string }).slug).toBe(slug)
    await expect(sf('storefront_track', ['short'])).rejects.toThrow(/Order not found/)
    await expect(sf('storefront_track', ['x'.repeat(24)])).rejects.toThrow(/Order not found/)
  })
})

run('storefront: verified reviews and sold counts', () => {
  let owner: TestUser
  let slug: string, variantId: string, productId: string

  beforeAll(async () => {
    owner = await createUser('sf-reviews')
    ;({ slug, variantId, productId } = await kesShop(owner))
  })

  const place = (qty: number, name = 'Brian Kip') =>
    sf<Placed>('storefront_place_order', [slug, JSON.stringify(guestOrder({ lines: [{ variant_id: variantId, quantity: qty }], name })), sfKey()])
  const product = async () =>
    (await sf<{ products: { id: string; sold_count: number | null; rating: { average: number; count: number } | null }[] }>('storefront_get', [slug])).products.find(
      (p) => p.id === productId,
    )!

  it('rejects reviews before delivery, accepts one per product after, and hides sold counts below 5', async () => {
    const a = await place(2)
    await expect(sf('storefront_review', [a.tracking_token, productId, 5, 'Great'])).rejects.toThrow(/once your order is delivered/)
    await deliverOrder(owner, a.order_id)

    await expect(sf('storefront_review', [a.tracking_token, productId, 6, null])).rejects.toThrow(/1 to 5/)
    await expect(sf('storefront_review', [a.tracking_token, '00000000-0000-0000-0000-000000000000', 5, null])).rejects.toThrow(/not in this order/)
    await sf('storefront_review', [a.tracking_token, productId, 4, '  Solid and well made.  '])
    await sf('storefront_review', [a.tracking_token, productId, 1, 'second try']) // ignored: once per product
    const reviews = await sf<{ rating: number; body: string; author: string }[]>('storefront_reviews', [slug, productId])
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ rating: 4, body: 'Solid and well made.', author: 'Brian' })
    expect((await sf<{ reviewed_product_ids: string[] }>('storefront_track', [a.tracking_token])).reviewed_product_ids).toEqual([productId])

    let p = await product()
    expect(p.rating).toEqual({ average: 4, count: 1 })
    expect(p.sold_count).toBeNull() // 2 delivered: hidden below 5

    const b = await place(3, 'Njeri W')
    await deliverOrder(owner, b.order_id)
    p = await product()
    expect(Number(p.sold_count)).toBe(5)
    const shop = await sf<{ shop: { rating: { average: number; count: number } } }>('storefront_get', [slug])
    expect(shop.shop.rating).toEqual({ average: 4, count: 1 })
  })
})

run('storefront: shop settings permissions', () => {
  let owner: TestUser, sales: TestUser, stranger: TestUser
  let org: string, slug: string

  beforeAll(async () => {
    owner = await createUser('sf-perm-owner')
    sales = await createUser('sf-perm-sales')
    stranger = await createUser('sf-perm-stranger')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, sales, 'sales')
    slug = uniqueSlug('perm')
    await saveShop(owner, org, { slug })
  })

  it('owners can save shop settings; sales cannot', async () => {
    const r = await one<{ slug: string; published: boolean }>(owner, `select slug, published from public.shop_settings where org_id = $1`, [org])
    expect(r).toEqual({ slug, published: true })
    await expect(saveShop(sales, org, { slug })).rejects.toThrow(/permission/)
    // Sales (a member) can still read the settings.
    expect(await asUser(sales, `select slug from public.shop_settings where org_id = $1`, [org])).toEqual([{ slug }])
  })

  it('validates slugs, bands and the published-with-delivery location rule', async () => {
    const strangerOrg = await createOrg(stranger, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await expect(saveShop(stranger, strangerOrg, { slug })).rejects.toThrow(/That shop link is already taken/)
    await expect(saveShop(stranger, strangerOrg, { slug: 'Bad Slug!' })).rejects.toThrow(/check constraint|violates/)
    await expect(
      saveShop(stranger, strangerOrg, { slug: uniqueSlug(), bands: [{ max_km: 5, fee_minor: 1 }, { max_km: 4, fee_minor: 2 }] }),
    ).rejects.toThrow(/increasing distances/)
    await expect(saveShop(stranger, strangerOrg, { slug: uniqueSlug(), lat: null, lng: null })).rejects.toThrow(/check constraint|violates/)
  })

  it("a second organisation cannot read the first organisation's shop settings", async () => {
    expect(await asUser(stranger, `select * from public.shop_settings where org_id = $1`, [org])).toHaveLength(0)
    expect(await asUser(stranger, `select * from public.reviews where org_id = $1`, [org])).toHaveLength(0)
  })

  it('merchandising enforces https images, compare-at above price and catalogue permission', async () => {
    const { productId, variantId } = await createProduct(owner, org, 1000)
    await expect(
      asUser(owner, `select public.set_product_merchandising($1, $2, '[{"url":"http://x.test/a.jpg"}]'::jsonb, false, null)`, [org, productId]),
    ).rejects.toThrow(/https/)
    await expect(asUser(owner, `select public.set_variant_merchandising($1, $2, 1000, null)`, [org, variantId])).rejects.toThrow(/check constraint/)
    await asUser(owner, `select public.set_variant_merchandising($1, $2, 1500, '#aa5500')`, [org, variantId])
    await expect(asUser(sales, `select public.set_variant_merchandising($1, $2, 2000, null)`, [org, variantId])).rejects.toThrow(/permission/)
  })
})

afterAll(async () => {
  await closeDb()
})
