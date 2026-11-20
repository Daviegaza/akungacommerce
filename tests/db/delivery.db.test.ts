import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, key, one, type TestUser } from './helpers'
import { asAnon, guestOrder, receiveStock, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'
import { computeDeposit, DEFAULT_SHOP_POLICY, type ShopPolicy } from '../../src/domain/delivery-policy'
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

async function setPolicy(user: TestUser, org: string, p: ShopPolicy) {
  await asUser(user, `select public.save_shop_policy($1, $2::jsonb)`, [org, JSON.stringify(policyPayload(p))])
}

async function kesShop(owner: TestUser, policy: ShopPolicy = DEPOSIT_POLICY) {
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const slug = uniqueSlug('dl')
  await saveShop(owner, org, { slug, cod: true })
  const { variantId } = await createProduct(owner, org, 150000, { taxBps: 1600 })
  await receiveStock(owner, org, variantId, 50)
  await setPolicy(owner, org, policy)
  return { org, slug, variantId }
}

const NEAR = { lat: -1.2676 + 5 / ((2 * Math.PI * 6371.0088) / 360), lng: 36.8108 } // ~5 km north -> KSh 300 band

async function placeDelivery(slug: string, variantId: string, extra: Record<string, unknown> = {}): Promise<Placed> {
  return sf<Placed>('storefront_place_order', [slug, guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], method: 'delivery', ...NEAR, ...extra }), sfKey()])
}

async function pay(user: TestUser, orderId: string, amount: number) {
  await asUser(user, `select public.record_manual_payment($1, $2, 'KES', 'mobile_money', null, now(), null, $3)`, [orderId, amount, key()])
}

async function walk(user: TestUser, orderId: string, steps: string[]) {
  for (const to of steps) await asUser(user, `select public.transition_order($1, $2::public.order_status)`, [orderId, to])
}

run('deposits: server-side math and policy', () => {
  let owner: TestUser, sales: TestUser
  let org: string, slug: string, variantId: string

  beforeAll(async () => {
    owner = await createUser('dl-owner')
    sales = await createUser('dl-sales')
    ;({ org, slug, variantId } = await kesShop(owner))
    await addMember(owner, org, sales, 'sales')
  })

  it('SQL _deposit_due matches the TypeScript rules (rounding, threshold, fixed, currencies)', async () => {
    const policies: ShopPolicy[] = [
      DEFAULT_SHOP_POLICY,
      { ...DEFAULT_SHOP_POLICY, paymentMode: 'full_prepay' },
      { ...DEPOSIT_POLICY, depositCoversDelivery: false },
      { ...DEPOSIT_POLICY, depositMinOrderMinor: 200000 },
      { ...DEPOSIT_POLICY, depositKind: 'fixed', depositFixedMinor: 50000 },
      { ...DEPOSIT_POLICY, depositPercentBps: 1000 },
    ]
    const cases: [number, number, string][] = [
      [123456, 0, 'KES'],
      [199999, 30000, 'KES'],
      [200000, 15000, 'KES'],
      [30000, 0, 'KES'],
      [3333, 0, 'JPY'],
      [10001, 0, 'KWD'],
      [4999, 390, 'EUR'],
    ]
    for (const p of policies) {
      for (const [total, fee, cur] of cases) {
        const { rows } = await db().query<{ d: string }>(`select public._deposit_due($1::jsonb, $2, $3, $4) as d`, [
          JSON.stringify(policyPayload(p)),
          total,
          fee,
          cur,
        ])
        expect(Number(rows[0].d), `${p.paymentMode}/${p.depositKind} ${total} ${cur}`).toBe(
          computeDeposit(p, { totalMinor: total, deliveryFeeMinor: fee, currency: cur }).depositDueMinor,
        )
      }
    }
  })

  it('only owners/admins can change the policy, and it is validated', async () => {
    await expect(setPolicy(sales, org, DEPOSIT_POLICY)).rejects.toThrow(/permission|cannot/i)
    await expect(setPolicy(owner, org, { ...DEPOSIT_POLICY, depositPercentBps: 20 })).rejects.toThrow(/between 1% and 100%/)
    await expect(setPolicy(owner, org, { ...DEPOSIT_POLICY, maxDeliveryAttempts: 9 })).rejects.toThrow(/Between 1 and 5/)
    await expect(asAnon(`select public.save_shop_policy($1, '{}'::jsonb)`, [org])).rejects.toThrow(/permission denied/)
  })

  it('the quote carries the deposit; the order stores it; client-sent amounts are ignored', async () => {
    const q = await sf<Record<string, number | string>>('storefront_quote', [
      slug,
      { lines: [{ variant_id: variantId, quantity: 1 }], method: 'delivery', ...NEAR, deposit_due_minor: 1, total_minor: 1 },
    ])
    // 1500 + 16% tax + 300 delivery = 2040; 30% = 612
    expect(q).toMatchObject({ total_minor: 204000, delivery_fee_minor: 30000, deposit_due_minor: 61200, balance_on_delivery_minor: 142800, payment_mode: 'deposit' })
    const placed = await placeDelivery(slug, variantId, { deposit_due_minor: 0 })
    expect(placed.deposit_due_minor).toBe(61200)
    const row = await one<{ deposit_due_minor: string; delivery_policy: Record<string, unknown> }>(
      owner,
      `select deposit_due_minor, delivery_policy from public.orders where id = $1`,
      [placed.order_id],
    )
    expect(Number(row.deposit_due_minor)).toBe(61200)
    expect(row.delivery_policy).toMatchObject({ payment_mode: 'deposit', failed_delivery_payer: 'buyer', max_delivery_attempts: 2 })
    const t = await sf<Record<string, number>>('storefront_track_delivery', [placed.tracking_token])
    expect(t).toMatchObject({ deposit_due_minor: 61200, deposit_paid_minor: 0, due_now_minor: 61200, balance_due_minor: 204000 })
    await pay(owner, placed.order_id, 61200)
    expect(await sf('storefront_track_delivery', [placed.tracking_token])).toMatchObject({ deposit_paid_minor: 61200, due_now_minor: 142800 })
    const due = await db().query<{ d: string }>(`select public.order_amount_due_now($1) as d`, [placed.order_id])
    expect(Number(due.rows[0].d)).toBe(142800)
    await expect(asAnon(`select public.order_amount_due_now($1)`, [placed.order_id])).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `select public.order_amount_due_now($1)`, [placed.order_id])).rejects.toThrow(/permission denied/)
  })

  it('full prepay refuses cash on delivery on the server', async () => {
    const other = await kesShop(owner, { ...DEFAULT_SHOP_POLICY, paymentMode: 'full_prepay' })
    await expect(
      sf('storefront_place_order', [other.slug, guestOrder({ lines: [{ variant_id: other.variantId, quantity: 1 }], payment: 'cod' }), sfKey()]),
    ).rejects.toThrow(/full payment before delivery/)
    const ok = await sf<Placed>('storefront_place_order', [other.slug, guestOrder({ lines: [{ variant_id: other.variantId, quantity: 1 }] }), sfKey()])
    expect(ok.deposit_due_minor).toBe(ok.total_minor)
  })

  it('pick-up points: listed to buyers, priced by the server, snapshotted on the order', async () => {
    const id = (await one<{ id: string }>(owner, `select public.save_pickup_point($1, $2::jsonb) as id`, [
      org,
      JSON.stringify({ name: 'Pick-up point · CBD', area: 'Moi Avenue', hours: '8–7', fee_minor: 10000 }),
    ])).id
    await expect(asUser(sales, `select public.save_pickup_point($1, $2::jsonb)`, [org, JSON.stringify({ name: 'X point', fee_minor: 1 })])).rejects.toThrow()
    const opts = await sf<{ pickup_points: { id: string; fee_minor: number }[]; policy: Record<string, unknown> }>('storefront_checkout_options', [slug])
    expect(opts.pickup_points).toContainEqual(expect.objectContaining({ id, fee_minor: 10000 }))
    expect(opts.policy).toMatchObject({ payment_mode: 'deposit' })
    const q = await sf<Record<string, unknown>>('storefront_quote', [slug, { lines: [{ variant_id: variantId, quantity: 1 }], method: 'pickup_point', pickup_point_id: id }])
    expect(q).toMatchObject({ delivery_fee_minor: 10000, total_minor: 184000 })
    await expect(sf('storefront_quote', [slug, { lines: [{ variant_id: variantId, quantity: 1 }], method: 'pickup_point', pickup_point_id: 'nope' }])).rejects.toThrow(/Choose a pick-up point/)
    const placed = await sf<Placed>('storefront_place_order', [slug, guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }], method: 'pickup' as never, ...{ method: 'pickup_point', pickup_point_id: id } }), sfKey()])
    const f = await one<{ method: string; handoff: string; pickup_point: { name: string } }>(owner, `select method, handoff, pickup_point from public.fulfilments where order_id = $1`, [placed.order_id])
    expect(f).toMatchObject({ method: 'delivery', handoff: 'pickup_point', pickup_point: { name: 'Pick-up point · CBD' } })
    await asUser(owner, `select public.archive_pickup_point($1, $2)`, [org, id])
    await expect(sf('storefront_quote', [slug, { lines: [{ variant_id: variantId, quantity: 1 }], method: 'pickup_point', pickup_point_id: id }])).rejects.toThrow(/Choose a pick-up point/)
  })

})

run('failed deliveries and rider links', () => {
  let owner: TestUser, analyst: TestUser, stranger: TestUser
  let org: string, slug: string, variantId: string

  beforeAll(async () => {
    owner = await createUser('fd-owner')
    analyst = await createUser('fd-analyst')
    stranger = await createUser('fd-stranger')
    ;({ org, slug, variantId } = await kesShop(owner))
    await addMember(owner, org, analyst, 'analyst')
    await createOrg(stranger, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  })

  it('keeps the delivery fee from a paid deposit for buyer-caused failures, counts attempts, stops at the max', async () => {
    const placed = await placeDelivery(slug, variantId)
    await pay(owner, placed.order_id, 61200)
    await expect(asUser(owner, `select public.mark_delivery_failed($1, 'buyer_unreachable', null, $2)`, [placed.order_id, key()])).rejects.toThrow(
      /out for delivery/,
    )
    await walk(owner, placed.order_id, ['confirmed', 'ready', 'dispatched'])
    await expect(asUser(analyst, `select public.mark_delivery_failed($1, 'buyer_unreachable', null, $2)`, [placed.order_id, key()])).rejects.toThrow()
    await expect(asUser(stranger, `select public.mark_delivery_failed($1, 'buyer_unreachable', null, $2)`, [placed.order_id, key()])).rejects.toThrow(
      /Order not found/,
    )

    const k = key()
    const first = await one<{ r: Record<string, unknown> }>(owner, `select public.mark_delivery_failed($1, 'buyer_unreachable', 'No answer x3', $2) as r`, [placed.order_id, k])
    expect(first.r).toEqual({ attempt: 1, forfeit_minor: 30000, final: false })
    // Same key: no second attempt.
    expect((await one<{ r: unknown }>(owner, `select public.mark_delivery_failed($1, 'buyer_unreachable', null, $2) as r`, [placed.order_id, k])).r).toEqual(first.r)

    const second = await one<{ r: Record<string, unknown> }>(owner, `select public.mark_delivery_failed($1, 'rider_issue', null, $2) as r`, [placed.order_id, key()])
    expect(second.r).toEqual({ attempt: 2, forfeit_minor: 0, final: true }) // the rider's failure never costs the buyer
    await expect(asUser(owner, `select public.mark_delivery_failed($1, 'buyer_unreachable', null, $2)`, [placed.order_id, key()])).rejects.toThrow(
      /All 2 delivery attempts/,
    )

    const order = await one<{ status: string; delivery_attempts: number; forfeited_fee_minor: string }>(
      owner,
      `select status, delivery_attempts, forfeited_fee_minor from public.orders where id = $1`,
      [placed.order_id],
    )
    expect(order).toMatchObject({ status: 'dispatched', delivery_attempts: 2 })
    expect(Number(order.forfeited_fee_minor)).toBe(30000)
    const history = await asUser<{ note: string }>(owner, `select note from public.order_status_history where order_id = $1 and from_status = to_status order by id`, [placed.order_id])
    expect(history.map((h) => h.note)).toEqual([
      'Delivery attempt 1 of 2 failed: Buyer could not be reached. Delivery fee kept from deposit per policy. No answer x3',
      'Delivery attempt 2 of 2 failed: Rider could not make it.',
    ])
    const tracked = await sf<{ events: { kind: string; reason: string; forfeited_minor: number; note: unknown }[]; attempts: number }>('storefront_track_delivery', [
      placed.tracking_token,
    ])
    expect(tracked.attempts).toBe(2)
    expect(tracked.events.map((e) => [e.kind, e.reason, e.forfeited_minor, e.note])).toEqual([
      ['failed', 'buyer_unreachable', 30000, null], // staff notes stay internal
      ['failed', 'rider_issue', 0, null],
    ])
    await expect(asUser(owner, `update public.delivery_events set forfeited_minor = 0 where order_id = $1`, [placed.order_id])).rejects.toThrow()
  })

  it('rider link: unguessable, masked phone until accepted, deposit gate, status updates, expiry and revoke', async () => {
    const placed = await placeDelivery(slug, variantId)
    await expect(asUser(owner, `select public.create_rider_link($1, 'Otieno', 6)`, [placed.order_id])).rejects.toThrow(/Confirm the order/)
    await walk(owner, placed.order_id, ['confirmed'])
    await expect(asUser(stranger, `select public.create_rider_link($1, 'X', 6)`, [placed.order_id])).rejects.toThrow(/Order not found/)
    const link = (await one<{ r: { token: string; expires_at: string } }>(owner, `select public.create_rider_link($1, 'Otieno', 6) as r`, [placed.order_id])).r
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    const stored = await db().query(`select token_hash from public.rider_links where order_id = $1`, [placed.order_id])
    expect(JSON.stringify(stored.rows)).not.toContain(link.token)

    const job = await sf<Record<string, unknown>>('rider_job', [link.token])
    expect(job).toMatchObject({ accepted: false, phone_masked: true, collect_minor: 204000, deposit_outstanding_minor: 61200 })
    expect(String(job.buyer_phone)).toMatch(/^••• ••• \d{3}$/)
    await expect(sf('rider_update', [link.token, 'picked_up', null])).rejects.toThrow(/Accept the job first/)
    const accepted = await sf<Record<string, unknown>>('rider_accept', [link.token, 'Otieno K'])
    expect(accepted).toMatchObject({ accepted: true, phone_masked: false })
    expect(String(accepted.buyer_phone)).toMatch(/^\+2547\d{8}$/)
    await expect(sf('rider_update', [link.token, 'picked_up', null])).rejects.toThrow(/deposit has not been received/)

    await pay(owner, placed.order_id, 61200)
    expect(await sf('rider_update', [link.token, 'picked_up', null])).toMatchObject({ status: 'dispatched', collect_minor: 142800 })
    expect(await sf('rider_update', [link.token, 'failed', 'buyer_refused'])).toMatchObject({ attempts: 1 })
    expect(await sf('rider_update', [link.token, 'delivered', null])).toMatchObject({ status: 'delivered' })
    const history = await asUser<{ to_status: string }>(owner, `select to_status from public.order_status_history where order_id = $1 order by id`, [placed.order_id])
    expect(history.map((h) => h.to_status)).toEqual(['pending_confirmation', 'confirmed', 'ready', 'dispatched', 'dispatched', 'delivered'])

    // A forged token, an expired token and a revoked token are all refused.
    await expect(sf('rider_job', ['A'.repeat(32)])).rejects.toThrow(/not valid/)
    await expect(sf('rider_job', ['short'])).rejects.toThrow(/not valid/)
    const p2 = await placeDelivery(slug, variantId)
    await walk(owner, p2.order_id, ['confirmed'])
    const l2 = (await one<{ r: { token: string } }>(owner, `select public.create_rider_link($1, null, 1) as r`, [p2.order_id])).r
    await db().query(`update public.rider_links set expires_at = now() - interval '1 second' where order_id = $1`, [p2.order_id])
    await expect(sf('rider_job', [l2.token])).rejects.toThrow(/expired/)
    const l3 = (await one<{ r: { token: string } }>(owner, `select public.create_rider_link($1, null, 12) as r`, [p2.order_id])).r
    await asUser(owner, `select public.revoke_rider_link($1)`, [p2.order_id])
    await expect(sf('rider_job', [l3.token])).rejects.toThrow(/cancelled this rider link/)
  })

  it('handoff: courier and pick-up point are recorded; tables stay closed to anon', async () => {
    const placed = await placeDelivery(slug, variantId)
    await asUser(owner, `select public.set_order_handoff($1, $2::jsonb)`, [placed.order_id, JSON.stringify({ kind: 'courier', carrier: 'G4S', tracking_ref: 'AB123' })])
    const f = await one<{ handoff: string; carrier: string; tracking_ref: string }>(owner, `select handoff, carrier, tracking_ref from public.fulfilments where order_id = $1`, [placed.order_id])
    expect(f).toEqual({ handoff: 'courier', carrier: 'G4S', tracking_ref: 'AB123' })
    await expect(asUser(owner, `select public.set_order_handoff($1, '{"kind":"courier"}'::jsonb)`, [placed.order_id])).rejects.toThrow(/courier/)
    const d = await one<{ r: Record<string, unknown> }>(owner, `select public.order_delivery($1) as r`, [placed.order_id])
    expect(d.r).toMatchObject({ handoff: { kind: 'courier', carrier: 'G4S' }, deposit_due_minor: 61200 })
    await expect(asUser(stranger, `select public.order_delivery($1)`, [placed.order_id])).rejects.toThrow(/Order not found/)

    for (const table of ['shop_policies', 'pickup_points', 'delivery_events', 'rider_links']) {
      const res = await asAnon(`select * from public.${table}`).then(
        (rows) => ({ rows }),
        (e: Error) => ({ error: e.message }),
      )
      if ('rows' in res) expect(res.rows, table).toHaveLength(0)
      else expect(res.error, table).toMatch(/permission denied/)
    }
    // Stranger (another tenant) sees none of this org's rows.
    expect(await asUser(stranger, `select * from public.pickup_points where org_id = $1`, [org])).toHaveLength(0)
    expect(await asUser(stranger, `select * from public.delivery_events where org_id = $1`, [org])).toHaveLength(0)
    await expect(asUser(owner, `select * from public.rider_links`)).rejects.toThrow(/permission denied/) // RPC only
    for (const fn of [`public.mark_delivery_failed($1, 'other', null, 'kkkkkkkkkk')`, `public.create_rider_link($1, null, 1)`, `public._apply_failed_delivery($1, 'other', null, 'staff', null)`]) {
      await expect(asAnon(`select ${fn}`, [placed.order_id]), fn).rejects.toThrow(/permission denied/)
    }
    await expect(asUser(owner, `select public._transition_order_core($1, 'cancelled', null)`, [placed.order_id])).rejects.toThrow(/permission denied/)
  })
})

afterAll(async () => {
  await closeDb()
})
