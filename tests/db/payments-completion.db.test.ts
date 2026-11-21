import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SHOP_POLICY, type ShopPolicy } from '../../src/domain/delivery-policy'
import { policyPayload } from '../../src/gateway/delivery-supabase'
import { DB_URL, asUser, closeDb, createOrg, createProduct, createUser, db, one, type TestUser } from './helpers'
import { guestOrder, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'

/**
 * Migrations 20261120000060 (bank-transfer reconciliation + virtual accounts) and
 * 20261120000061 (STK Push Query fallback + buyer-visible payment events).
 */
const run = describe.skipIf(!DB_URL)

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

type Outcome = { outcome: string; confirmed?: boolean; payment_id?: string; reason?: string; org_id?: string; status?: string }
type Placed = { order_id: string; number: number; tracking_token: string; total_minor: number; deposit_due_minor: number }

const nuban = () => `99${String(randomInt(10_000_000, 99_999_999))}`
const ref = () => `T${randomUUID().replace(/-/g, '').slice(0, 14)}`

interface NgShop {
  owner: TestUser
  org: string
  slug: string
  variantId: string
}

async function ngShop(label: string, opts: { connected?: boolean; deposit?: boolean } = {}): Promise<NgShop> {
  const owner = await createUser(label)
  const org = await createOrg(owner, 'NGN', { country: 'NG', tz: 'Africa/Lagos', locale: 'en-NG' })
  const { variantId } = await createProduct(owner, org, 2_450_000, { track: false })
  const slug = uniqueSlug('ng')
  await saveShop(owner, org, { slug, delivery: false })
  if (opts.connected ?? true) {
    await db().query(`insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'paystack', 'payment', 'connected_verified')`, [org])
  }
  await asUser(owner, `select public.set_bank_transfer_provider($1, 'paystack_dva')`, [org])
  if (opts.deposit) {
    const policy: ShopPolicy = { ...DEFAULT_SHOP_POLICY, paymentMode: 'deposit', depositKind: 'percent', depositPercentBps: 3000, depositMinOrderMinor: 0, depositCoversDelivery: true }
    await asUser(owner, `select public.save_shop_policy($1, $2::jsonb)`, [org, JSON.stringify(policyPayload(policy))])
  }
  return { owner, org, slug, variantId }
}

async function placeBankOrder(shop: NgShop, phone?: string): Promise<Placed> {
  return sf<Placed>('storefront_place_order', [
    shop.slug,
    JSON.stringify(guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }], payment: 'bank_transfer', ...(phone ? { phone_e164: phone } : {}) })),
    sfKey(),
  ])
}

async function assign(shop: NgShop, orderId: string | null, customerId: string | null = null, customerRef: string | null = null) {
  const acct = nuban()
  await svc(`select public.record_virtual_account($1, 'paystack_dva', 'Wema Bank', $2, 'Shop / Fungua', $3, $4, $5)`, [shop.org, acct, customerRef, orderId, customerId])
  return acct
}

async function transfer(acct: string | null, amount: number, reference = ref(), customerRef: string | null = null, currency = 'NGN') {
  const rows = await svc<{ r: Outcome }>(`select public.reconcile_bank_transfer('paystack_dva', $1, $2, $3, $4, $5, '4821', now()) as r`, [
    reference,
    amount,
    currency,
    acct,
    customerRef,
  ])
  return rows[0].r
}

async function payments(shop: NgShop, orderId: string) {
  return asUser<{ method: string; provider: string; verification: string; amount_minor: string; external_ref: string }>(
    shop.owner,
    `select method, provider, verification, amount_minor, external_ref from public.payments where order_id = $1 order by created_at`,
    [orderId],
  )
}
async function status(shop: NgShop, orderId: string) {
  return (await one<{ status: string }>(shop.owner, `select status from public.orders where id = $1`, [orderId])).status
}

let shop: NgShop

beforeAll(async () => {
  if (DB_URL) shop = await ngShop('banktr')
})
afterAll(async () => {
  await closeDb()
})

run('virtual accounts + tracking details', () => {
  it('tracking shows no account until one is stored, then bank, number, exact amount and reference', async () => {
    const o = await placeBankOrder(shop)
    const before = await sf<{ provider: string; account: unknown; due_now_minor: number; reference: number }>('storefront_bank_transfer', [o.tracking_token])
    expect(before).toMatchObject({ provider: 'paystack_dva', account: null, reference: o.number })
    expect(Number(before.due_now_minor)).toBe(Number(o.total_minor))
    const acct = await assign(shop, o.order_id)
    const after = await sf<{ account: Record<string, string> }>('storefront_bank_transfer', [o.tracking_token])
    expect(after.account).toEqual({ bank_name: 'Wema Bank', account_number: acct, account_name: 'Shop / Fungua' })
  })

  it('is null for orders that are not NGN bank transfer', async () => {
    const o = await sf<Placed>('storefront_place_order', [shop.slug, JSON.stringify(guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }], payment: 'other' })), sfKey()])
    expect(await sf('storefront_bank_transfer', [o.tracking_token])).toBeNull()
  })

  it('re-assigning retires the previous account; only service role can store accounts; members read only their own', async () => {
    const o = await placeBankOrder(shop)
    const first = await assign(shop, o.order_id)
    const second = await assign(shop, o.order_id)
    const rows = await asUser<{ account_number: string; status: string }>(shop.owner, `select account_number, status from public.virtual_accounts where order_id = $1 order by created_at`, [o.order_id])
    expect(rows).toEqual([
      { account_number: first, status: 'retired' },
      { account_number: second, status: 'active' },
    ])
    await expect(
      asUser(shop.owner, `select public.record_virtual_account($1, 'paystack_dva', 'X Bank', '9912345678', null, null, $2, null)`, [shop.org, o.order_id]),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(shop.owner, `insert into public.virtual_accounts (org_id, provider, bank_name, account_number, order_id) values ($1, 'paystack_dva', 'X', '9912345678', $2)`, [shop.org, o.order_id])).rejects.toThrow(/permission denied/)
    const stranger = await createUser('stranger')
    await createOrg(stranger, 'NGN', { country: 'NG', tz: 'Africa/Lagos', locale: 'en-NG' })
    expect(await asUser(stranger, `select id from public.virtual_accounts where org_id = $1`, [shop.org])).toHaveLength(0)
  })

  it('refuses accounts for non-NGN businesses and malformed numbers', async () => {
    const o = await placeBankOrder(shop)
    await expect(svc(`select public.record_virtual_account($1, 'paystack_dva', 'Wema', '123', null, null, $2, null)`, [shop.org, o.order_id])).rejects.toThrow(/10 digits/)
    const kesOwner = await createUser('kes')
    const kesOrg = await createOrg(kesOwner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await expect(svc(`select public.record_virtual_account($1, 'paystack_dva', 'Wema', $2, null, null, null, $3)`, [kesOrg, nuban(), randomUUID()])).rejects.toThrow(/NGN/)
    await expect(svc(`select public.record_virtual_account($1, 'paystack_dva', 'Wema', $2, null, null, null, null)`, [shop.org, nuban()])).rejects.toThrow(/order or a customer/)
  })
})

run('reconcile_bank_transfer', () => {
  it('records an exact transfer once (idempotent on the Paystack reference) and confirms the order', async () => {
    const o = await placeBankOrder(shop)
    const acct = await assign(shop, o.order_id)
    const r = ref()
    expect(await transfer(acct, Number(o.total_minor), r)).toMatchObject({ outcome: 'recorded', confirmed: true })
    expect(await transfer(acct, Number(o.total_minor), r)).toMatchObject({ outcome: 'duplicate' })
    const pays = await payments(shop, o.order_id)
    expect(pays).toEqual([{ method: 'bank_transfer', provider: 'paystack', verification: 'provider_verified', amount_minor: String(o.total_minor), external_ref: r }])
    expect(await status(shop, o.order_id)).toBe('confirmed')
    const h = await one<{ note: string }>(shop.owner, `select note from public.order_status_history where order_id = $1 order by id desc limit 1`, [o.order_id])
    expect(h.note).toBe(`Paid in full by bank transfer (verified reference ${r})`)
    const rec = await one<{ source: string; provider: string; status: string; account_ref: string; payer_hint: string }>(
      shop.owner,
      `select source, provider, status, account_ref, payer_hint from public.mpesa_receipts where receipt = $1`,
      [r],
    )
    expect(rec).toEqual({ source: 'bank_transfer', provider: 'paystack', status: 'matched', account_ref: acct, payer_hint: '···4821' })
    // The "Confirmed by M-Pesa" receipt card never shows a bank reference.
    expect(await sf('storefront_payment_receipts', [o.tracking_token])).toEqual([])
  })

  it('a different amount waits in the queue against the mapped order; staff can attach it as a bank_transfer payment', async () => {
    const o = await placeBankOrder(shop)
    const acct = await assign(shop, o.order_id)
    const res = await transfer(acct, 1_000_000)
    expect(res).toMatchObject({ outcome: 'unmatched', reason: 'The amount does not equal the deposit or balance due' })
    expect(await payments(shop, o.order_id)).toHaveLength(0)
    const q = await one<{ id: string; status: string; order_id: string }>(shop.owner, `select id, status, order_id from public.mpesa_receipts where account_ref = $1`, [acct])
    expect(q).toMatchObject({ status: 'unmatched', order_id: o.order_id })
    await asUser(shop.owner, `select public.attach_mpesa_receipt($1, $2, $3)`, [shop.org, q.id, o.order_id])
    const pays = await payments(shop, o.order_id)
    expect(pays[0]).toMatchObject({ method: 'bank_transfer', provider: 'paystack', amount_minor: '1000000' })
    expect(await status(shop, o.order_id)).toBe('pending_confirmation')
  })

  it('records exactly the deposit due now and confirms with a deposit note', async () => {
    const dep = await ngShop('banktr-dep', { deposit: true })
    const o = await placeBankOrder(dep)
    expect(Number(o.deposit_due_minor)).toBeGreaterThan(0)
    const acct = await assign(dep, o.order_id)
    const r = ref()
    expect(await transfer(acct, Number(o.deposit_due_minor), r)).toMatchObject({ outcome: 'recorded', confirmed: true })
    const h = await one<{ note: string }>(dep.owner, `select note from public.order_status_history where order_id = $1 order by id desc limit 1`, [o.order_id])
    expect(h.note).toBe(`Deposit paid by bank transfer (verified reference ${r}); balance due on delivery`)
  })

  it('unknown accounts, wrong currency and bad input never record', async () => {
    expect(await transfer(nuban(), 1000)).toEqual({ outcome: 'unknown_account' })
    expect(await transfer(null, 1000)).toEqual({ outcome: 'unknown_account' })
    expect(await transfer(nuban(), 0)).toEqual({ outcome: 'invalid' })
    expect(await transfer(nuban(), 1000, 'x')).toEqual({ outcome: 'invalid' })
    const o = await placeBankOrder(shop)
    const acct = await assign(shop, o.order_id)
    expect(await transfer(acct, Number(o.total_minor), ref(), null, 'USD')).toMatchObject({ outcome: 'unmatched', reason: "The transfer is not in the order's currency" })
    expect(await payments(shop, o.order_id)).toHaveLength(0)
  })

  it('a business whose Paystack connection is not verified gets the transfer queued, not recorded', async () => {
    const unverified = await ngShop('banktr-unv', { connected: false })
    const o = await placeBankOrder(unverified)
    const acct = await assign(unverified, o.order_id)
    const res = await transfer(acct, Number(o.total_minor))
    expect(res.outcome).toBe('unmatched')
    expect(res.reason).toMatch(/^Could not record automatically/)
    expect(await payments(unverified, o.order_id)).toHaveLength(0)
  })

  it('customer accounts match the single open order due exactly that amount (by account or customer_code)', async () => {
    const phone = `+23480${String(randomInt(10_000_000, 99_999_999))}`
    const a = await placeBankOrder(shop, phone)
    const custId = (await one<{ customer_id: string }>(shop.owner, `select customer_id from public.orders where id = $1`, [a.order_id])).customer_id
    const code = `CUS_${randomUUID().slice(0, 10)}`
    const acct = await assign(shop, null, custId, code)
    expect(await transfer(null, Number(a.total_minor), ref(), code)).toMatchObject({ outcome: 'recorded' })
    // Two open orders now due the same amount: ambiguous, so it waits.
    await placeBankOrder(shop, phone)
    await placeBankOrder(shop, phone)
    expect(await transfer(acct, Number(a.total_minor))).toMatchObject({
      outcome: 'unmatched',
      reason: 'No single open order for this customer is due exactly this amount',
    })
  })

  it('cannot be called by signed-in users or anon', async () => {
    await expect(asUser(shop.owner, `select public.reconcile_bank_transfer('paystack_dva', 'T1234567', 100, 'NGN', '9912345678', null, null, now())`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(asUser(null, `select public.reconcile_bank_transfer('paystack_dva', 'T1234567', 100, 'NGN', '9912345678', null, null, now())`)).rejects.toThrow(
      /permission denied/,
    )
  })
})

run('buyer-visible payment events (storefront_track_payments)', () => {
  it('lists each succeeded payment without changing status history', async () => {
    const o = await placeBankOrder(shop)
    const acct = await assign(shop, o.order_id)
    expect(await sf('storefront_track_payments', [o.tracking_token])).toEqual([])
    await transfer(acct, 1_000_000)
    const q = await one<{ id: string }>(shop.owner, `select id from public.mpesa_receipts where account_ref = $1`, [acct])
    await asUser(shop.owner, `select public.attach_mpesa_receipt($1, $2, $3)`, [shop.org, q.id, o.order_id])
    const events = await sf<{ amount_minor: number; currency: string; method: string; verified: boolean; received_at: string }[]>('storefront_track_payments', [o.tracking_token])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ currency: 'NGN', method: 'bank_transfer', verified: true })
    expect(Number(events[0].amount_minor)).toBe(1_000_000)
    expect(Object.keys(events[0]).sort()).toEqual(['amount_minor', 'currency', 'method', 'received_at', 'verified'])
    const tracked = await sf<{ history: { status: string }[] }>('storefront_track', [o.tracking_token])
    expect(tracked.history.map((h) => h.status)).toEqual(['pending_confirmation'])
    await expect(sf('storefront_track_payments', ['x'.repeat(30)])).rejects.toThrow(/Order not found/)
  })
})

/* ───────────── STK Push Query fallback ───────────── */

interface KeShop {
  owner: TestUser
  org: string
  slug: string
  variantId: string
}

async function keShop(): Promise<KeShop> {
  const owner = await createUser('stkq')
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const { variantId } = await createProduct(owner, org, 150_000, { track: false })
  const slug = uniqueSlug('stkq')
  await saveShop(owner, org, { slug })
  await db().query(`insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'mpesa', 'payment', 'connected_verified')`, [org])
  await asUser(owner, `select public.set_collections_provider($1, 'daraja', null)`, [org])
  return { owner, org, slug, variantId }
}

async function prompt(ke: KeShop, minutesAgo: number) {
  const o = await sf<Placed>('storefront_place_order', [ke.slug, JSON.stringify(guestOrder({ lines: [{ variant_id: ke.variantId, quantity: 1 }] })), sfKey()])
  const id = `ws_CO_Q_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  await db().query(
    `insert into public.mpesa_requests (checkout_request_id, org_id, order_id, amount_minor, provider, status, phone_hint, created_at)
     values ($1, $2, $3, $4, 'mpesa', 'pending', '678', now() - make_interval(mins => $5))`,
    [id, ke.org, o.order_id, Number(o.total_minor), minutesAgo],
  )
  return { o, id }
}

async function query(id: string, code: number | null) {
  return (await svc<{ r: Outcome }>(`select public.apply_mpesa_stk_query($1, $2, 'desc') as r`, [id, code]))[0].r
}
async function req(ke: KeShop, id: string) {
  return one<{ status: string; result_code: number | null; query_count: number; resolved_at: string | null }>(
    ke.owner,
    `select status, result_code, query_count, resolved_at from public.mpesa_requests where checkout_request_id = $1`,
    [id],
  )
}

let ke: KeShop

run('STK Push Query (apply_mpesa_stk_query)', () => {
  beforeAll(async () => {
    ke = await keShop()
  })

  it('lists only prompts pending for 2 minutes to 24 hours', async () => {
    const fresh = await prompt(ke, 0)
    const due = await prompt(ke, 5)
    const stale = await prompt(ke, 25 * 60)
    const ids = (await svc<{ checkout_request_id: string }>(`select checkout_request_id from public.mpesa_prompts_due_for_query(100)`)).map((r) => r.checkout_request_id)
    expect(ids).toContain(due.id)
    expect(ids).not.toContain(fresh.id)
    expect(ids).not.toContain(stale.id)
    // Just queried -> not due again for 2 minutes.
    expect(await query(due.id, null)).toMatchObject({ outcome: 'still_pending' })
    const again = (await svc<{ checkout_request_id: string }>(`select checkout_request_id from public.mpesa_prompts_due_for_query(100)`)).map((r) => r.checkout_request_id)
    expect(again).not.toContain(due.id)
    expect(await req(ke, due.id)).toMatchObject({ status: 'pending', query_count: 1, resolved_at: null })
  })

  it('a query success never records money; the later callback with a receipt records exactly once', async () => {
    const { o, id } = await prompt(ke, 5)
    expect(await query(id, 0)).toMatchObject({ outcome: 'awaiting_receipt' })
    expect(await req(ke, id)).toMatchObject({ status: 'awaiting_receipt', result_code: 0, resolved_at: null })
    const pays = await asUser(ke.owner, `select id from public.payments where order_id = $1`, [o.order_id])
    expect(pays).toHaveLength(0)
    expect(await sf<{ status: string }>('storefront_payment_status', [o.tracking_token, id])).toMatchObject({ status: 'awaiting_receipt' })
    // Repeating the query changes nothing.
    expect(await query(id, 0)).toMatchObject({ outcome: 'noop' })
    const receipt = `Q${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`
    const cb = (await svc<{ r: Outcome }>(`select public.reconcile_mpesa_stk($1, 0, 'ok', $2, $3, '678', now()) as r`, [id, Number(o.total_minor), receipt]))[0].r
    expect(cb).toMatchObject({ outcome: 'recorded', confirmed: true })
    expect(await req(ke, id)).toMatchObject({ status: 'paid' })
    expect(await asUser(ke.owner, `select id from public.payments where order_id = $1`, [o.order_id])).toHaveLength(1)
  })

  it('cancelled, timeout and insufficient funds resolve the prompt without money', async () => {
    for (const [code, expected] of [
      [1032, 'cancelled'],
      [1037, 'timeout'],
      [1, 'failed'],
    ] as const) {
      const { id } = await prompt(ke, 5)
      expect(await query(id, code)).toMatchObject({ outcome: 'not_paid', status: expected })
      const r = await req(ke, id)
      expect(r.status).toBe(expected)
      expect(r.resolved_at).not.toBeNull()
    }
    expect(await query('ws_CO_missing', 0)).toEqual({ outcome: 'unknown_request' })
  })

  it('cannot be called by signed-in users', async () => {
    await expect(asUser(ke.owner, `select public.apply_mpesa_stk_query('x', 0, 'x')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(ke.owner, `select * from public.mpesa_prompts_due_for_query(5)`)).rejects.toThrow(/permission denied/)
  })
})
