import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, key, one, type TestUser } from './helpers'
import { guestOrder, randomIp, receiveStock, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'
import { DEFAULT_SHOP_POLICY, planReturnToShop, type ShopPolicy } from '../../src/domain/delivery-policy'
import { ORDER_STATUSES, canTransition, needsReturnFlow } from '../../src/domain/orders'
import { policyPayload } from '../../src/gateway/delivery-supabase'

const run = describe.skipIf(!DB_URL)

type Placed = { order_id: string; tracking_token: string; total_minor: number; deposit_due_minor: number }

const DEPOSIT_POLICY: ShopPolicy = {
  ...DEFAULT_SHOP_POLICY,
  paymentMode: 'deposit',
  depositKind: 'percent',
  depositPercentBps: 3000,
  depositMinOrderMinor: 0,
  depositCoversDelivery: true,
  failedDeliveryPayer: 'buyer',
  maxDeliveryAttempts: 2,
}
const NEAR = { lat: -1.2676 + 5 / ((2 * Math.PI * 6371.0088) / 360), lng: 36.8108 } // ~5 km -> KSh 300 band

async function kesShop(owner: TestUser) {
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const slug = uniqueSlug('ops')
  await saveShop(owner, org, { slug, cod: true })
  const { variantId } = await createProduct(owner, org, 150000, { taxBps: 1600 })
  await receiveStock(owner, org, variantId, 50)
  await asUser(owner, `select public.save_shop_policy($1, $2::jsonb)`, [org, JSON.stringify(policyPayload(DEPOSIT_POLICY))])
  return { org, slug, variantId }
}

async function stock(user: TestUser, variantId: string) {
  const r = await one<{ on_hand: number; reserved: number }>(user, `select on_hand, reserved from public.inventory_levels where variant_id = $1`, [variantId])
  return { onHand: Number(r.on_hand), reserved: Number(r.reserved) }
}

async function pay(user: TestUser, orderId: string, amount: number) {
  await asUser(user, `select public.record_manual_payment($1, $2, 'KES', 'mobile_money', null, now(), null, $3)`, [orderId, amount, key()])
}

async function dispatchedOrder(owner: TestUser, slug: string, variantId: string, payAmount: number | 'deposit', qty = 2) {
  const placed = await sf<Placed>('storefront_place_order', [
    slug,
    guestOrder({ lines: [{ variant_id: variantId, quantity: qty }], method: 'delivery', ...NEAR }),
    sfKey(),
  ])
  const amount = payAmount === 'deposit' ? placed.deposit_due_minor : payAmount
  if (amount > 0) await pay(owner, placed.order_id, amount)
  for (const to of ['confirmed', 'ready', 'dispatched']) {
    await asUser(owner, `select public.transition_order($1, $2::public.order_status)`, [placed.order_id, to])
  }
  return { placed, paid: amount }
}

const failDelivery = (user: TestUser, orderId: string, reason: string) =>
  one<{ r: { attempt: number; forfeit_minor: number; final: boolean } }>(user, `select public.mark_delivery_failed($1, $2, null, $3) as r`, [orderId, reason, key()])

const returnToShop = (user: TestUser, orderId: string, k = key(), note: string | null = null) =>
  one<{ r: Record<string, unknown> }>(user, `select public.return_order_to_shop($1, $2, $3) as r`, [orderId, note, k]).then((x) => x.r)

afterAll(async () => {
  if (DB_URL) await closeDb()
})

run('returned to shop (database)', () => {
  let owner: TestUser, manager: TestUser, fulfilment: TestUser, stranger: TestUser
  let org: string, slug: string, variantId: string

  beforeAll(async () => {
    owner = await createUser('ops-owner')
    manager = await createUser('ops-manager')
    fulfilment = await createUser('ops-fulfil')
    stranger = await createUser('ops-stranger')
    ;({ org, slug, variantId } = await kesShop(owner))
    await addMember(owner, org, manager, 'manager')
    await addMember(owner, org, fulfilment, 'fulfilment')
    await createOrg(stranger)
  })

  it('SQL status machine matches TypeScript, including the return-flow-only transition', async () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const { rows } = await db().query<{ a: boolean; f: boolean }>(
          `select public.order_transition_allowed($1::public.order_status, $2::public.order_status) as a,
                  public.order_transition_needs_return_flow($1::public.order_status, $2::public.order_status) as f`,
          [from, to],
        )
        expect(rows[0].a, `${from} -> ${to}`).toBe(canTransition(from, to))
        expect(rows[0].f, `${from} -> ${to} (return flow)`).toBe(needsReturnFlow(from, to))
      }
    }
  })

  it('transition_order refuses to cancel an order that is out for delivery', async () => {
    const { placed } = await dispatchedOrder(owner, slug, variantId, 'deposit')
    await expect(asUser(owner, `select public.transition_order($1, 'cancelled')`, [placed.order_id])).rejects.toThrow(/returned to the shop/)
  })

  it('returns stock, cancels, keeps the forfeited fee, suggests the rest and writes history; idempotent', async () => {
    const before = await stock(owner, variantId)
    const { placed, paid } = await dispatchedOrder(owner, slug, variantId, 'deposit')
    const afterDispatch = await stock(owner, variantId)
    expect(afterDispatch.onHand).toBe(before.onHand - 2)

    expect((await failDelivery(fulfilment, placed.order_id, 'buyer_unreachable')).r).toMatchObject({ attempt: 1, forfeit_minor: 30000 })
    expect((await failDelivery(fulfilment, placed.order_id, 'buyer_refused')).r).toMatchObject({ attempt: 2, final: true })

    // Fulfilment staff record failures but cannot put stock back or work out refunds.
    await expect(returnToShop(fulfilment, placed.order_id)).rejects.toThrow(/permission|cannot/i)
    await expect(returnToShop(stranger, placed.order_id)).rejects.toThrow(/Order not found/)

    const k = key()
    const r = await returnToShop(manager, placed.order_id, k, 'Rider brought it back')
    const forfeited = await one<{ forfeited_fee_minor: string; status: string; returned_at: Date | null }>(
      owner,
      `select forfeited_fee_minor, status, returned_at from public.orders where id = $1`,
      [placed.order_id],
    )
    const plan = planReturnToShop({ netPaidMinor: paid, forfeitedMinor: Number(forfeited.forfeited_fee_minor) })
    expect(r).toMatchObject({ status: 'cancelled', kept_minor: plan.keptMinor, refund_minor: plan.refundMinor, replayed: false })
    expect(forfeited.status).toBe('cancelled')
    expect(forfeited.returned_at).toBeInstanceOf(Date)
    expect(await returnToShop(manager, placed.order_id, k)).toMatchObject({ replayed: true, refund_minor: plan.refundMinor })

    expect(await stock(owner, variantId)).toEqual(before)
    const lines = await asUser<{ quantity: number; returned_quantity: number }>(owner, `select quantity, returned_quantity from public.order_lines where order_id = $1`, [
      placed.order_id,
    ])
    expect(lines.every((l) => l.returned_quantity === l.quantity)).toBe(true)

    const hist = await asUser<{ from_status: string; to_status: string; note: string }>(
      owner,
      `select from_status, to_status, note from public.order_status_history where order_id = $1 order by id`,
      [placed.order_id],
    )
    expect(hist.at(-1)).toMatchObject({ from_status: 'dispatched', to_status: 'cancelled' })
    expect(hist.at(-1)?.note).toBe('Returned to shop after 2 failed delivery attempts. Items back in stock. Rider brought it back')

    const s = await one<{ r: { refund_suggestion: Record<string, unknown> | null; returned_at: string } }>(owner, `select public.order_return_state($1) as r`, [
      placed.order_id,
    ])
    expect(s.r.refund_suggestion).toMatchObject({ status: 'pending', amount_minor: plan.refundMinor, kept_minor: plan.keptMinor, currency: 'KES' })
    // No money moved: no refund rows.
    expect(await asUser(owner, `select 1 from public.refunds where order_id = $1`, [placed.order_id])).toHaveLength(0)

    // Buyer view: returned, refund pending, no staff note.
    const t = await sf<Record<string, unknown> & { events: { kind: string; note: string | null }[] }>('storefront_track_delivery', [placed.tracking_token])
    expect(t.returned_at).toEqual(expect.any(String))
    expect(t.refund).toEqual({ amount_minor: plan.refundMinor, kept_minor: plan.keptMinor, status: 'pending' })
    expect(t.events.at(-1)).toMatchObject({ kind: 'returned', note: null })

    // Rider links were cancelled; a second return is refused.
    expect((await db().query(`select 1 from public.rider_links where order_id = $1 and revoked_at is null`, [placed.order_id])).rows).toHaveLength(0)
    await expect(returnToShop(owner, placed.order_id)).rejects.toThrow(/out for delivery/)
  })

  it('confirming records refunds across payments (newest first), never flips to refunded; dismiss needs a reason', async () => {
    const { placed } = await dispatchedOrder(owner, slug, variantId, 0)
    await pay(owner, placed.order_id, 50000)
    await pay(owner, placed.order_id, 70000)
    await failDelivery(owner, placed.order_id, 'shop_issue')
    await returnToShop(owner, placed.order_id)
    const st = await one<{ r: { refund_suggestion: { id: string; amount_minor: number; kept_minor: number } } }>(owner, `select public.order_return_state($1) as r`, [
      placed.order_id,
    ])
    const sug = st.r.refund_suggestion
    expect(sug).toMatchObject({ amount_minor: 120000, kept_minor: 0 }) // shop's own failure: nothing kept

    await expect(asUser(fulfilment, `select public.confirm_refund_suggestion($1, $2)`, [sug.id, key()])).rejects.toThrow(/permission|cannot/i)
    const k = key()
    await asUser(manager, `select public.confirm_refund_suggestion($1, $2)`, [sug.id, k])
    await asUser(manager, `select public.confirm_refund_suggestion($1, $2)`, [sug.id, k])
    const refunds = await asUser<{ amount_minor: string }>(owner, `select amount_minor from public.refunds where order_id = $1 order by created_at`, [placed.order_id])
    expect(refunds.map((x) => Number(x.amount_minor)).sort((a, b) => a - b)).toEqual([50000, 70000])
    const o = await one<{ status: string }>(owner, `select status from public.orders where id = $1`, [placed.order_id])
    expect(o.status).toBe('cancelled')
    await expect(asUser(owner, `select public.dismiss_refund_suggestion($1, 'x')`, [sug.id])).rejects.toThrow(/already settled/)

    const second = await dispatchedOrder(owner, slug, variantId, 40000)
    await returnToShop(owner, second.placed.order_id)
    const st2 = await one<{ r: { refund_suggestion: { id: string } } }>(owner, `select public.order_return_state($1) as r`, [second.placed.order_id])
    await expect(asUser(owner, `select public.dismiss_refund_suggestion($1, '  ')`, [st2.r.refund_suggestion.id])).rejects.toThrow(/Say why/)
    await asUser(owner, `select public.dismiss_refund_suggestion($1, 'Store credit given')`, [st2.r.refund_suggestion.id])
    const after = await one<{ r: { refund_suggestion: Record<string, unknown> } }>(owner, `select public.order_return_state($1) as r`, [second.placed.order_id])
    expect(after.r.refund_suggestion).toMatchObject({ status: 'dismissed', resolution_note: 'Store credit given' })
  })

  it('refund suggestions are readable by members only and cannot be written directly', async () => {
    expect(await asUser(stranger, `select * from public.refund_suggestions where org_id = $1`, [org])).toHaveLength(0)
    expect((await asUser(owner, `select * from public.refund_suggestions where org_id = $1`, [org])).length).toBeGreaterThan(0)
    await expect(
      asUser(owner, `insert into public.refund_suggestions (org_id, order_id, amount_minor, currency, reason) select org_id, id, 1, 'KES', 'x' from public.orders where org_id = $1 limit 1`, [org]),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select public.return_order_to_shop(gen_random_uuid(), null, 'abcdefghij')`)).rejects.toThrow(/permission denied/)
  })
})

run('storefront consent source (database)', () => {
  let owner: TestUser
  let org: string, slug: string, variantId: string

  beforeAll(async () => {
    owner = await createUser('consent-owner')
    ;({ org, slug, variantId } = await kesShop(owner))
  })

  it('a storefront order placed by a signed-in browser records consent source checkout, not staff', async () => {
    const phone = '+254711' + String(Math.floor(100000 + Math.random() * 899999))
    const client = await db().connect()
    try {
      await client.query('begin')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'authenticated', email: owner.email })])
      await client.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': randomIp() })])
      await client.query('set local role authenticated')
      await client.query(`select public.storefront_place_order($1, $2, $3)`, [
        slug,
        guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], phone_e164: phone, marketing_opt_in: true }),
        sfKey(),
      ])
      // The marker does not leak into the rest of the transaction.
      const { rows } = await client.query<{ v: string }>(`select coalesce(current_setting('akunga.consent_source', true), '') as v`)
      expect(rows[0].v).toBe('')
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
    const c = await one<{ marketing_consent: boolean; consent_source: string }>(
      owner,
      `select marketing_consent, consent_source from public.customers where org_id = $1 and phone_e164 = $2`,
      [org, phone],
    )
    expect(c).toMatchObject({ marketing_consent: true, consent_source: 'checkout' })

    // Staff edits still say staff.
    await asUser(owner, `update public.customers set marketing_consent = false where org_id = $1 and phone_e164 = $2`, [org, phone])
    await asUser(owner, `update public.customers set marketing_consent = true where org_id = $1 and phone_e164 = $2`, [org, phone])
    expect(
      await one(owner, `select consent_source from public.customers where org_id = $1 and phone_e164 = $2`, [org, phone]),
    ).toMatchObject({ consent_source: 'staff' })
  })

  it('the wrapped order core is not callable by browsers', async () => {
    await expect(asUser(owner, `select public._storefront_place_order_core('x', '{}'::jsonb, 'abcdefghij')`)).rejects.toThrow(/permission denied/)
  })
})

run('orphaned product photos (database)', () => {
  let owner: TestUser
  let org: string
  const names: string[] = []
  const base = 'http://127.0.0.1:58321/storage/v1/object/public/product-images/'

  /** Insert an object row directly (as the DB owner) with a chosen age. */
  async function object(name: string, ageHours: number) {
    await db().query(`insert into storage.objects (bucket_id, name, created_at) values ('product-images', $1, now() - make_interval(hours => $2))`, [name, ageHours])
    names.push(name)
    return name
  }

  async function orphans(minAge = '24 hours') {
    const { rows } = await db().query<{ name: string; org_id: string }>(`select name, org_id from public.list_orphan_product_images($1::interval, 1000)`, [minAge])
    return rows.filter((r) => names.includes(r.name))
  }

  beforeAll(async () => {
    owner = await createUser('media-owner')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  })

  afterAll(async () => {
    const client = await db().connect()
    try {
      await client.query('begin')
      await client.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      await client.query(`delete from storage.objects where bucket_id = 'product-images' and name = any($1)`, [names])
      await client.query('commit')
    } finally {
      client.release()
    }
  })

  it('lists only old objects that no product or shop references', async () => {
    const { productId } = await createProduct(owner, org, 1000)
    const used = await object(`${org}/${randomUUID()}.webp`, 48)
    const orphan = await object(`${org}/${randomUUID()}.webp`, 48)
    const young = await object(`${org}/${randomUUID()}.webp`, 2)
    const nested = await object(`${org}/nested/${randomUUID()}.webp`, 48)
    const noOrg = await object(`not-an-org/${randomUUID()}.webp`, 48)
    await asUser(owner, `select public.set_product_merchandising($1, $2, $3::jsonb, false, null)`, [org, productId, JSON.stringify([{ url: base + used }])])

    const listed = (await orphans()).map((r) => r.name)
    expect(listed).toContain(orphan)
    expect(listed).not.toContain(used)
    expect(listed).not.toContain(young)
    expect(listed).not.toContain(nested)
    expect(listed).not.toContain(noOrg)
    expect((await orphans()).find((r) => r.name === orphan)?.org_id).toBe(org)

    // Removing the photo from the product makes it an orphan; the minimum age never drops below 1 hour.
    await asUser(owner, `select public.set_product_merchandising($1, $2, '[]'::jsonb, false, null)`, [org, productId])
    expect((await orphans()).map((r) => r.name)).toContain(used)
    expect((await orphans('1 minute')).map((r) => r.name)).toContain(young)
    const fresh = await object(`${org}/${randomUUID()}.webp`, 0)
    expect((await orphans('0 seconds')).map((r) => r.name)).not.toContain(fresh)
  })

  it('is for the service role only', async () => {
    await expect(asUser(owner, `select * from public.list_orphan_product_images()`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select * from public.list_orphan_product_images()`)).rejects.toThrow(/permission denied/)
  })
})

run('custom domain check (database)', () => {
  let owner: TestUser, manager: TestUser
  let org: string
  let host: string

  beforeAll(async () => {
    owner = await createUser('dom-owner')
    manager = await createUser('dom-manager')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, manager, 'manager')
    await saveShop(owner, org, { slug: uniqueSlug('dom') })
    host = `shop-${randomUUID().slice(0, 8)}.mtohome.co.ke`
  })

  it('"Check now" needs org.manage and a domain, and is limited to 5 per 15 minutes per shop', async () => {
    await expect(asUser(owner, `select public.request_custom_domain_check($1)`, [org])).rejects.toThrow(/Add a domain first/)
    await asUser(owner, `select public.set_custom_domain($1, $2)`, [org, host])
    await expect(asUser(manager, `select public.request_custom_domain_check($1)`, [org])).rejects.toThrow(/permission/)
    await expect(asUser(null, `select public.request_custom_domain_check($1)`, [org])).rejects.toThrow(/permission denied/)
    for (let i = 0; i < 5; i++) {
      const r = await one<{ r: { hostname: string; verification_token: string; status: string } }>(owner, `select public.request_custom_domain_check($1) as r`, [org])
      expect(r.r).toMatchObject({ hostname: host, status: 'pending_dns' })
      expect(r.r.verification_token).toMatch(/^[a-f0-9]{32}$/)
    }
    await expect(asUser(owner, `select public.request_custom_domain_check($1)`, [org])).rejects.toThrow(/Too many attempts/)
  })

  it('the scheduled list covers pending/failed domains not checked in the last hour; marking is service-role only', async () => {
    const listed = async () => (await db().query<{ hostname: string }>(`select hostname from public.list_custom_domains_to_check(100)`)).rows.map((r) => r.hostname)
    expect(await listed()).toContain(host)
    await db().query(`select public.mark_custom_domain_status($1, 'failed', 'No CNAME record found yet.')`, [host])
    expect(await listed()).not.toContain(host) // just checked
    await db().query(`update public.custom_domains set last_checked_at = now() - interval '2 hours' where hostname = $1`, [host])
    expect(await listed()).toContain(host)
    await db().query(`select public.mark_custom_domain_status($1, 'verified', null)`, [host])
    await db().query(`update public.custom_domains set last_checked_at = now() - interval '2 hours' where hostname = $1`, [host])
    expect(await listed()).not.toContain(host) // verified domains are not re-checked on schedule
    await expect(asUser(owner, `select * from public.list_custom_domains_to_check(10)`)).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `select public.mark_custom_domain_status($1, 'verified', null)`, [host])).rejects.toThrow(/permission denied/)
  })
})
