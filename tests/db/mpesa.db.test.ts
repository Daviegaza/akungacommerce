import { randomInt } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, one, type TestUser } from './helpers'
import { guestOrder, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'

const run = describe.skipIf(!DB_URL)

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
const receipt = () => 'T' + Array.from({ length: 9 }, () => ALPHA[randomInt(ALPHA.length)]).join('')
const checkoutId = () => `ws_CO_TEST_${receipt()}`

async function svc<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db().connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    const r = await c.query(sql, params)
    await c.query('commit')
    return r.rows as T[]
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

type Outcome = { outcome: string; status?: string; confirmed?: boolean; payment_id?: string }

async function stkCallback(id: string, code: number, amount: number | null, rcpt: string | null) {
  const rows = await svc<{ r: Outcome }>(`select public.reconcile_mpesa_stk($1, $2, 'desc', $3, $4, '678', now()) as r`, [id, code, amount, rcpt])
  return rows[0].r
}
async function c2b(shortcode: string, rcpt: string, amount: number, ref: string | null) {
  const rows = await svc<{ r: Outcome }>(`select public.reconcile_mpesa_c2b($1, $2, $3, $4, 'Jane ···149', now()) as r`, [shortcode, rcpt, amount, ref])
  return rows[0].r
}

interface Shop {
  owner: TestUser
  org: string
  slug: string
  till: string
  variantId: string
}

async function createShop(label: string, connected = true): Promise<Shop> {
  const owner = await createUser(label)
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const { variantId } = await createProduct(owner, org, 150_000, { track: false })
  const slug = uniqueSlug('mp')
  await saveShop(owner, org, { slug })
  const till = String(randomInt(1_000_000, 9_999_999))
  await db().query(`update public.shop_settings set mpesa_till = $2 where org_id = $1`, [org, till])
  if (connected) {
    await db().query(`insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'mpesa', 'payment', 'connected_verified')`, [org])
  }
  await asUser(owner, `select public.set_collections_provider($1, 'daraja', null)`, [org])
  return { owner, org, slug, till, variantId }
}

async function placeOrder(shop: Shop) {
  return sf<{ order_id: string; number: number; tracking_token: string; total_minor: number }>('storefront_place_order', [
    shop.slug,
    JSON.stringify(guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }] })),
    sfKey(),
  ])
}

/** What mpesa-stk does after Daraja accepts the push. */
async function promptSent(shop: Shop, orderId: string, amount: number) {
  const id = checkoutId()
  await db().query(
    `insert into public.mpesa_requests (checkout_request_id, org_id, order_id, amount_minor, provider, status, phone_hint) values ($1, $2, $3, $4, 'mpesa', 'pending', '678')`,
    [id, shop.org, orderId, amount],
  )
  return id
}

async function order(shop: Shop, id: string) {
  return one<{ status: string }>(shop.owner, `select status from public.orders where id = $1`, [id])
}
async function payments(shop: Shop, id: string) {
  return asUser<{ verification: string; amount_minor: string; external_ref: string }>(
    shop.owner,
    `select verification, amount_minor, external_ref from public.payments where order_id = $1`,
    [id],
  )
}

let shop: Shop

beforeAll(async () => {
  if (DB_URL) shop = await createShop('mpesa')
})
afterAll(async () => {
  await closeDb()
})

run('STK reconciliation (reconcile_mpesa_stk)', () => {
  it('records a matching callback once, confirms the order and logs the receipt in history', async () => {
    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    const r = receipt()
    expect(await stkCallback(id, 0, Number(o.total_minor), r)).toMatchObject({ outcome: 'recorded', confirmed: true })
    expect(await stkCallback(id, 0, Number(o.total_minor), r)).toMatchObject({ outcome: 'duplicate' })
    expect(await stkCallback(id, 1032, null, null)).toMatchObject({ outcome: 'duplicate' })
    const pays = await payments(shop, o.order_id)
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({ verification: 'provider_verified', external_ref: r })
    expect((await order(shop, o.order_id)).status).toBe('confirmed')
    const h = await one<{ note: string }>(shop.owner, `select note from public.order_status_history where order_id = $1 order by id desc limit 1`, [o.order_id])
    expect(h.note).toBe(`Paid in full by M-Pesa (verified receipt ${r})`)
    const req = await one<{ status: string; receipt: string }>(shop.owner, `select status, receipt from public.mpesa_requests where checkout_request_id = $1`, [id])
    expect(req).toEqual({ status: 'paid', receipt: r })
    const tracked = await sf<{ paid_minor: number }>('storefront_track', [o.tracking_token])
    expect(Number(tracked.paid_minor)).toBe(Number(o.total_minor))
  })

  it('a failure resolves the prompt without money; a later success (late callback) is still recorded', async () => {
    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    expect(await stkCallback(id, 1037, null, null)).toMatchObject({ outcome: 'not_paid', status: 'timeout' })
    expect(await payments(shop, o.order_id)).toHaveLength(0)
    expect(await stkCallback(id, 0, Number(o.total_minor), receipt())).toMatchObject({ outcome: 'recorded' })
  })

  it('an amount mismatch goes to review, never onto the order; staff can attach it as a partial payment', async () => {
    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    const r = receipt()
    expect(await stkCallback(id, 0, 100_000, r)).toMatchObject({ outcome: 'review', status: 'mismatch' })
    expect(await payments(shop, o.order_id)).toHaveLength(0)
    const rec = await one<{ id: string; status: string; order_id: string }>(shop.owner, `select id, status, order_id from public.mpesa_receipts where receipt = $1`, [r])
    expect(rec).toMatchObject({ status: 'mismatch', order_id: o.order_id })
    await asUser(shop.owner, `select public.attach_mpesa_receipt($1, $2, $3)`, [shop.org, rec.id, o.order_id])
    expect(await payments(shop, o.order_id)).toHaveLength(1)
    expect((await order(shop, o.order_id)).status).toBe('pending_confirmation') // partial
    await expect(asUser(shop.owner, `select public.attach_mpesa_receipt($1, $2, $3)`, [shop.org, rec.id, o.order_id])).rejects.toThrow(/already been resolved/)
  })

  it('a payment arriving after the order was cancelled is queued as late', async () => {
    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    await asUser(shop.owner, `select public.transition_order($1, 'cancelled')`, [o.order_id])
    expect(await stkCallback(id, 0, Number(o.total_minor), receipt())).toMatchObject({ outcome: 'review', status: 'late' })
    expect(await payments(shop, o.order_id)).toHaveLength(0)
  })

  it('a second paid prompt on a paid order is an extra payment for review', async () => {
    const o = await placeOrder(shop)
    const a = await promptSent(shop, o.order_id, Number(o.total_minor))
    const b = await promptSent(shop, o.order_id, Number(o.total_minor))
    expect(await stkCallback(a, 0, Number(o.total_minor), receipt())).toMatchObject({ outcome: 'recorded' })
    expect(await stkCallback(b, 0, Number(o.total_minor), receipt())).toMatchObject({ outcome: 'review', status: 'late' })
    expect(await payments(shop, o.order_id)).toHaveLength(1)
  })

  it('unknown requests and malformed successes are not processed', async () => {
    expect(await stkCallback('ws_CO_nope', 0, 100, receipt())).toEqual({ outcome: 'unknown_request' })
    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    expect(await stkCallback(id, 0, Number(o.total_minor), null)).toEqual({ outcome: 'invalid' })
  })

  it('without a verified connection the money is kept for review instead of recorded', async () => {
    const other = await createShop('mpesa-nc', false)
    const o = await placeOrder(other)
    const id = await promptSent(other, o.order_id, Number(o.total_minor))
    expect(await stkCallback(id, 0, Number(o.total_minor), receipt())).toMatchObject({ outcome: 'review', status: 'mismatch' })
    expect(await payments(other, o.order_id)).toHaveLength(0)
  })
})

run('C2B reconciliation (reconcile_mpesa_c2b)', () => {
  it('matches an exact balance with the order number as account, otherwise queues it; replays are duplicates', async () => {
    const o = await placeOrder(shop)
    const r = receipt()
    expect(await c2b(shop.till, r, Number(o.total_minor), `#${o.number}`)).toMatchObject({ outcome: 'recorded', confirmed: true })
    expect(await c2b(shop.till, r, Number(o.total_minor), `#${o.number}`)).toMatchObject({ outcome: 'duplicate' })
    expect(await c2b(shop.till, receipt(), 50_000, null)).toMatchObject({ outcome: 'unmatched' })
    const o2 = await placeOrder(shop)
    expect(await c2b(shop.till, receipt(), 1_000, String(o2.number))).toMatchObject({ outcome: 'unmatched' })
    expect(await payments(shop, o2.order_id)).toHaveLength(0)
  })

  it('ignores shortcodes that do not belong to exactly one verified Daraja shop', async () => {
    expect(await c2b('99999', receipt(), 100, null)).toEqual({ outcome: 'unknown_shortcode' })
    const unverified = await createShop('mpesa-unv', false)
    expect(await c2b(unverified.till, receipt(), 100, null)).toEqual({ outcome: 'unknown_shortcode' })
  })
})

run('merchant RPCs, RLS and storefront access', () => {
  it('only members see receipts and prompts; anon sees nothing; reconcile is service-role only', async () => {
    const stranger = await createUser('stranger')
    expect(await asUser(stranger, `select 1 from public.mpesa_receipts where org_id = $1`, [shop.org])).toHaveLength(0)
    expect(await asUser(stranger, `select 1 from public.mpesa_requests where org_id = $1`, [shop.org])).toHaveLength(0)
    expect((await asUser(shop.owner, `select 1 from public.mpesa_receipts where org_id = $1`, [shop.org])).length).toBeGreaterThan(0)
    await expect(asUser(null, `select * from public.mpesa_receipts`)).rejects.toThrow(/permission denied/)
    await expect(asUser(shop.owner, `select public.reconcile_mpesa_stk('x', 0, '', 1, 'TAAAAAAAAA', null, now())`)).rejects.toThrow(/permission denied/)
    await expect(asUser(shop.owner, `select public.reconcile_mpesa_c2b('123456', 'TAAAAAAAAA', 1, null, null, now())`)).rejects.toThrow(/permission denied/)
    await expect(asUser(shop.owner, `insert into public.mpesa_receipts (org_id, provider, source, receipt, amount_minor, status) values ($1, 'mpesa', 'c2b', 'TBBBBBBBBB', 1, 'unmatched')`, [shop.org])).rejects.toThrow(/permission denied/)
  })

  it('analysts cannot attach, dismiss or change the provider; dismiss needs a reason', async () => {
    const analyst = await createUser('mp-analyst')
    await addMember(shop.owner, shop.org, analyst, 'analyst')
    await c2b(shop.till, receipt(), 12_300, null)
    const rec = await one<{ id: string }>(shop.owner, `select id from public.mpesa_receipts where org_id = $1 and status = 'unmatched' and amount_minor = 12300 limit 1`, [shop.org])
    const o = await placeOrder(shop)
    await expect(asUser(analyst, `select public.attach_mpesa_receipt($1, $2, $3)`, [shop.org, rec.id, o.order_id])).rejects.toThrow(/permission/)
    await expect(asUser(analyst, `select public.dismiss_mpesa_receipt($1, $2, 'x')`, [shop.org, rec.id])).rejects.toThrow(/permission/)
    await expect(asUser(analyst, `select public.set_collections_provider($1, 'manual', null)`, [shop.org])).rejects.toThrow(/permission/)
    await expect(asUser(shop.owner, `select public.dismiss_mpesa_receipt($1, $2, '  ')`, [shop.org, rec.id])).rejects.toThrow(/reason/)
    await asUser(shop.owner, `select public.dismiss_mpesa_receipt($1, $2, 'Personal transfer')`, [shop.org, rec.id])
    const after = await one<{ status: string }>(shop.owner, `select status from public.mpesa_receipts where id = $1`, [rec.id])
    expect(after.status).toBe('dismissed')
  })

  it('verify_mpesa_receipt: verified for own codes, not found for other shops, flags manual entries, manual mode says so', async () => {
    const o = await placeOrder(shop)
    const r = receipt()
    await c2b(shop.till, r, Number(o.total_minor), String(o.number))
    const v = await one<{ r: { format_ok: boolean; receipt: { status: string; order_number: number } } }>(
      shop.owner,
      `select public.verify_mpesa_receipt($1, $2) as r`,
      [shop.org, r.toLowerCase()],
    )
    expect(v.r.receipt).toMatchObject({ status: 'matched', order_number: o.number })
    const other = await createShop('mpesa-other')
    const leak = await one<{ r: { receipt: unknown } }>(other.owner, `select public.verify_mpesa_receipt($1, $2) as r`, [other.org, r])
    expect(leak.r.receipt).toBeNull()
    await expect(asUser(other.owner, `select public.verify_mpesa_receipt($1, $2)`, [shop.org, r])).rejects.toThrow(/not found/i)
    const bad = await one<{ r: { format_ok: boolean } }>(shop.owner, `select public.verify_mpesa_receipt($1, 'x!') as r`, [shop.org])
    expect(bad.r.format_ok).toBe(false)

    const o2 = await placeOrder(other)
    const typed = receipt()
    await asUser(other.owner, `select public.record_manual_payment($1, 1000, 'KES', 'mobile_money', $2, now(), null, $3)`, [o2.order_id, typed, sfKey()])
    await asUser(other.owner, `select public.set_collections_provider($1, 'manual', null)`, [other.org])
    const manual = await one<{ r: { provider: string; receipt: unknown; manual_order_numbers: number[] } }>(
      other.owner,
      `select public.verify_mpesa_receipt($1, $2) as r`,
      [other.org, typed],
    )
    expect(manual.r).toMatchObject({ provider: 'manual', receipt: null, manual_order_numbers: [o2.number] })
  })

  it('set_collections_provider validates the choice', async () => {
    await expect(asUser(shop.owner, `select public.set_collections_provider($1, 'aggregator', null)`, [shop.org])).rejects.toThrow(/which aggregator/)
    await expect(asUser(shop.owner, `select public.set_collections_provider($1, 'paypal', null)`, [shop.org])).rejects.toThrow(/Choose manual/)
    const owner = await createUser('noshop')
    const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await expect(asUser(owner, `select public.set_collections_provider($1, 'daraja', null)`, [org])).rejects.toThrow(/Set up your shop/)
  })

  it('storefront: payment options and prompt status for the link holder only', async () => {
    expect(await sf('storefront_payment_options', [shop.slug])).toEqual({ provider: 'daraja', stk: true })
    const unverified = await createShop('mpesa-opt', false)
    expect(await sf('storefront_payment_options', [unverified.slug])).toEqual({ provider: 'daraja', stk: false })
    await asUser(unverified.owner, `select public.set_collections_provider($1, 'aggregator', 'intasend')`, [unverified.org])
    expect(await sf('storefront_payment_options', [unverified.slug])).toEqual({ provider: 'aggregator', stk: false })

    const o = await placeOrder(shop)
    const id = await promptSent(shop, o.order_id, Number(o.total_minor))
    expect(await sf('storefront_payment_status', [o.tracking_token, id])).toEqual({ status: 'pending', result_code: null })
    await stkCallback(id, 1032, null, null)
    expect(await sf('storefront_payment_status', [o.tracking_token, id])).toEqual({ status: 'cancelled', result_code: 1032 })
    const o2 = await placeOrder(shop)
    await expect(sf('storefront_payment_status', [o2.tracking_token, id])).rejects.toThrow(/not found/)
    await expect(sf('storefront_payment_status', ['short', id])).rejects.toThrow(/not found/)
  })
})
