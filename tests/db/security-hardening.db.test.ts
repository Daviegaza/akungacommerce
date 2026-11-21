import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { DB_URL, asUser, closeDb, createOrg, createProduct, createUser, db, key, one } from './helpers'
import { guestOrder, randomIp, receiveStock, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'

/** Checks for 20261121000090_security_hardening.sql. */
const run = describe.skipIf(!DB_URL)
const KE = { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' }
const phone = () => `+2547${String(randomInt(10_000_000, 99_999_999))}`

type Placed = { order_id: string; number: number; total_minor: number; tracking_token: string }

async function shop() {
  const owner = await createUser('sec')
  const org = await createOrg(owner, 'KES', KE)
  const slug = uniqueSlug('sec')
  await saveShop(owner, org, { slug, cod: true })
  const { variantId } = await createProduct(owner, org, 100_000, { taxBps: 0 })
  await receiveStock(owner, org, variantId, 50)
  return { owner, org, slug, variantId }
}

const place = (slug: string, input: Record<string, unknown>, k = sfKey()) =>
  sf<Placed>('storefront_place_order', [slug, input, k], randomIp())

async function stock(org: string, variantId: string) {
  const { rows } = await db().query(`select sum(on_hand)::int as on_hand, sum(reserved)::int as reserved from public.inventory_levels where org_id = $1 and variant_id = $2`, [org, variantId])
  return rows[0] as { on_hand: number; reserved: number }
}

afterAll(async () => {
  await closeDb()
})

run('security hardening', () => {
  it('_client_ip uses the last x-forwarded-for hop, not the client-supplied first one', async () => {
    const c = await db().connect()
    try {
      await c.query('begin')
      await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' })])
      expect((await c.query(`select public._client_ip() as ip`)).rows[0].ip).toBe('9.9.9.9')
      await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': '8.8.8.8' })])
      expect((await c.query(`select public._client_ip() as ip`)).rows[0].ip).toBe('8.8.8.8')
      await c.query('rollback')
    } finally {
      c.release()
    }
  })

  it('caps open unpaid orders per phone per shop at 3; an idempotent retry still works', async () => {
    const s = await shop()
    const tel = phone()
    const input = guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: tel })
    const firstKey = sfKey()
    const first = await place(s.slug, input, firstKey)
    await place(s.slug, input)
    await place(s.slug, input)
    await expect(place(s.slug, input)).rejects.toThrow(/already have 3 orders waiting/)
    // Same key as the first order = same order back, not a refusal.
    expect((await place(s.slug, input, firstKey)).order_id).toBe(first.order_id)
    // Another phone is unaffected.
    await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: phone() }))
  })

  it('refuses the order (and creates nothing) when the server total differs from the total the buyer saw', async () => {
    const s = await shop()
    const tel = phone()
    const base = guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: tel })
    await expect(place(s.slug, { ...base, expected_total_minor: 1 })).rejects.toThrow(/total changed/)
    const { rows } = await db().query(`select count(*)::int as n from public.orders where org_id = $1`, [s.org])
    expect(rows[0].n).toBe(0)
    expect((await stock(s.org, s.variantId)).reserved).toBe(0)
    const ok = await place(s.slug, { ...base, expected_total_minor: 100_000 })
    expect(Number(ok.total_minor)).toBe(100_000)
  })

  it('cancels stale unpaid storefront orders and releases their stock; recent or paid ones stay', async () => {
    const s = await shop()
    const stale = await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 2 }], phone_e164: phone() }))
    const fresh = await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: phone() }))
    const paid = await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: phone() }))
    await asUser(s.owner, `select public.record_manual_payment($1, 100000, 'KES', 'cash', null, now(), null, $2)`, [paid.order_id, key()])
    await db().query(`update public.orders set created_at = now() - interval '2 days' where id = any($1)`, [[stale.order_id, paid.order_id]])
    expect((await stock(s.org, s.variantId)).reserved).toBe(4)

    const { rows } = await db().query(`select public.cancel_stale_storefront_orders(interval '24 hours') as n`)
    expect(rows[0].n).toBeGreaterThanOrEqual(1)
    const status = async (id: string) => (await one<{ status: string }>(s.owner, `select status from public.orders where id = $1`, [id])).status
    expect(await status(stale.order_id)).toBe('cancelled')
    expect(await status(fresh.order_id)).toBe('pending_confirmation')
    expect(await status(paid.order_id)).not.toBe('cancelled')
    expect((await stock(s.org, s.variantId)).reserved).toBe(2)
  })

  it('an anonymous checkout cannot switch marketing back on after an opt-out', async () => {
    const s = await shop()
    const tel = phone()
    await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: tel, marketing_opt_in: true }))
    const { rows } = await db().query<{ id: string }>(`select id from public.customers where org_id = $1 and phone_e164 = $2`, [s.org, tel])
    await asUser(s.owner, `select public.opt_out_customer($1, $2, 'stop_reply')`, [s.org, rows[0].id])
    await db().query(`update public.orders set status = 'confirmed' where org_id = $1`, [s.org]) // free the open-order slot
    await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: tel, marketing_opt_in: true }))
    const c = await db().query(`select marketing_consent, consent_source from public.customers where id = $1`, [rows[0].id])
    expect(c.rows[0]).toEqual({ marketing_consent: false, consent_source: 'stop_reply' })
  })

  it('a first-time buyer can still opt in at checkout', async () => {
    const s = await shop()
    const tel = phone()
    await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: tel, marketing_opt_in: true }))
    const c = await db().query(`select marketing_consent, consent_source from public.customers where org_id = $1 and phone_e164 = $2`, [s.org, tel])
    expect(c.rows[0]).toEqual({ marketing_consent: true, consent_source: 'checkout' })
  })

  it('rider links are revoked when the order is delivered or cancelled', async () => {
    const s = await shop()
    const o = await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: phone() }))
    const hash = randomBytes(32).toString('hex')
    await db().query(`insert into public.rider_links (org_id, order_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '12 hours')`, [s.org, o.order_id, hash])
    await db().query(`select public._transition_order_core($1, 'cancelled', null)`, [o.order_id])
    const { rows } = await db().query(`select revoked_at from public.rider_links where token_hash = $1`, [hash])
    expect(rows[0].revoked_at).not.toBeNull()
  })

  it('a manual payment above the balance due is refused', async () => {
    const s = await shop()
    const o = await place(s.slug, guestOrder({ lines: [{ variant_id: s.variantId, quantity: 1 }], phone_e164: phone() }))
    await expect(
      asUser(s.owner, `select public.record_manual_payment($1, 100001, 'KES', 'cash', null, now(), null, $2)`, [o.order_id, key()]),
    ).rejects.toThrow(/more than the balance due/)
    await asUser(s.owner, `select public.record_manual_payment($1, 60000, 'KES', 'cash', null, now(), null, $2)`, [o.order_id, key()])
    await expect(
      asUser(s.owner, `select public.record_manual_payment($1, 40001, 'KES', 'cash', null, now(), null, $2)`, [o.order_id, key()]),
    ).rejects.toThrow(/more than the balance due/)
  })

  it('an email invitation needs a confirmed email address', async () => {
    const owner = await createUser('inv-own')
    const org = await createOrg(owner, 'KES', KE)
    const invitee = await createUser('inv-unc')
    await db().query(`update auth.users set email_confirmed_at = null where id = $1`, [invitee.id])
    const r = await one<{ r: { token: string } }>(owner, `select public.create_team_invite($1, $2, null, 'sales'::public.member_role) as r`, [org, invitee.email])
    await expect(asUser(invitee, `select public.accept_team_invite($1)`, [r.r.token])).rejects.toThrow(/Confirm your email/)
    await db().query(`update auth.users set email_confirmed_at = now() where id = $1`, [invitee.id])
    await asUser(invitee, `select public.accept_team_invite($1)`, [r.r.token])
  })

  it('outbound messages: recipient from the database, consent checked, every attempt logged', async () => {
    const owner = await createUser('msg')
    const org = await createOrg(owner, 'KES', KE)
    const tel = phone()
    const { rows } = await db().query<{ id: string }>(
      `insert into public.customers (org_id, name, phone_e164, marketing_consent) values ($1, 'Baraka', $2, false) returning id`,
      [org, tel],
    )
    const cust = rows[0].id
    await expect(asUser(owner, `select public.begin_outbound_message($1, $2, 'whatsapp', 'marketing')`, [org, cust])).rejects.toThrow(/not agreed/)
    const b = await one<{ r: { id: string; to: string } }>(owner, `select public.begin_outbound_message($1, $2, 'whatsapp', 'transactional') as r`, [org, cust])
    expect(b.r.to).toBe(tel)
    await asUser(owner, `select public.finish_outbound_message($1, 'not_configured', null, null)`, [b.r.id])
    const log = await one<{ status: string }>(owner, `select status from public.outbound_messages where id = $1`, [b.r.id])
    expect(log.status).toBe('not_configured')
    // Another organisation's customer is not reachable.
    const other = await createUser('msg2')
    const otherOrg = await createOrg(other, 'KES', KE)
    await expect(asUser(other, `select public.begin_outbound_message($1, $2, 'sms', 'transactional')`, [otherOrg, cust])).rejects.toThrow(/Customer not found/)
    await expect(asUser(null, `select public.begin_outbound_message($1, $2, 'sms', 'transactional')`, [org, cust])).rejects.toThrow(/permission denied/)
    // Per-customer limit: 10 an hour.
    for (let i = 1; i < 10; i++) await asUser(owner, `select public.begin_outbound_message($1, $2, 'sms', 'transactional')`, [org, cust])
    await expect(asUser(owner, `select public.begin_outbound_message($1, $2, 'sms', 'transactional')`, [org, cust])).rejects.toThrow(/Too many attempts/)
  })

  it('maintenance functions are service-role only', async () => {
    const u = await createUser('maint')
    await expect(asUser(u, `select public.cancel_stale_storefront_orders()`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select public.prune_rate_limits()`)).rejects.toThrow(/permission denied/)
    const { rows } = await db().query(`select public.prune_rate_limits(interval '30 days') as n`)
    expect(typeof rows[0].n).toBe('number')
    void randomUUID
  })
})
