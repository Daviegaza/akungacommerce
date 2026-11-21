import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, one } from './helpers'
import { deliverOrder, guestOrder, randomIp, receiveStock, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'

/** Checks for 20261122000100_ops_jobs_privacy_payouts.sql. */
const run = describe.skipIf(!DB_URL)
const KE = { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' }
type Placed = { order_id: string; tracking_token: string }

async function shop() {
  const owner = await createUser('ops')
  const org = await createOrg(owner, 'KES', KE)
  const slug = uniqueSlug('ops')
  await saveShop(owner, org, { slug, cod: true })
  const { variantId } = await createProduct(owner, org, 50_000, { taxBps: 0 })
  await receiveStock(owner, org, variantId, 20)
  return { owner, org, slug, variantId }
}

const place = (slug: string, variantId: string) =>
  sf<Placed>('storefront_place_order', [slug, guestOrder({ lines: [{ variant_id: variantId, quantity: 1 }] }), sfKey()], randomIp())

/** Run SQL as the service role (what Edge Functions and pg_cron use). */
async function asService<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db().connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    const res = await c.query(sql, params)
    await c.query('commit')
    return res.rows as T[]
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

const creds = (org: string, over: Partial<Record<string, string | null>> = {}) => {
  const v = { env: 'sandbox', short: '174379', type: 'CustomerPayBillOnline', party: null, key: 'ck-test-ABCD1234', secret: 'cs-test-secret', pass: 'pk-test-passkey', ...over }
  return [org, v.env, v.short, v.type, v.party, v.key, v.secret, v.pass]
}
const SET = `select public.set_mpesa_credentials($1, $2, $3, $4, $5, $6, $7, $8) as r`

afterAll(async () => {
  await closeDb()
})

run('tracking link expiry', () => {
  it('stamps closed_at on delivery and clears it if the order reopens', async () => {
    const s = await shop()
    const o = await place(s.slug, s.variantId)
    await deliverOrder(s.owner, o.order_id)
    const { rows } = await db().query(`select closed_at from public.orders where id = $1`, [o.order_id])
    expect(rows[0].closed_at).not.toBeNull()
    await db().query(`update public.orders set status = 'confirmed' where id = $1`, [o.order_id])
    const again = await db().query(`select closed_at from public.orders where id = $1`, [o.order_id])
    expect(again.rows[0].closed_at).toBeNull()
  })

  it('expires the buyer link N days after the order closed, per shop; open and recent orders keep theirs', async () => {
    const s = await shop()
    const old = await place(s.slug, s.variantId)
    const recent = await place(s.slug, s.variantId)
    const open = await place(s.slug, s.variantId)
    await deliverOrder(s.owner, old.order_id)
    await deliverOrder(s.owner, recent.order_id)
    await db().query(`update public.orders set closed_at = now() - interval '91 days' where id = $1`, [old.order_id])
    await db().query(`update public.orders set closed_at = now() - interval '89 days' where id = $1`, [recent.order_id])
    await db().query(`update public.orders set created_at = now() - interval '200 days' where id = $1`, [open.order_id])

    expect((await sf<{ number: number }>('storefront_track', [old.tracking_token])).number).toBeTruthy()
    await asService(`select public.expire_tracking_links()`)

    const tok = async (id: string) => (await db().query(`select tracking_token from public.orders where id = $1`, [id])).rows[0].tracking_token
    expect(await tok(old.order_id)).toBeNull()
    expect(await tok(recent.order_id)).toBe(recent.tracking_token)
    expect(await tok(open.order_id)).toBe(open.tracking_token)
    // Every token-based public RPC now treats the old link as unknown.
    await expect(sf('storefront_track', [old.tracking_token])).rejects.toThrow()

    // A shop with a shorter window expires sooner.
    await db().query(`update public.shop_settings set tracking_link_days = 7 where org_id = $1`, [s.org])
    await db().query(`update public.orders set closed_at = now() - interval '8 days' where id = $1`, [recent.order_id])
    await asService(`select public.expire_tracking_links()`)
    expect(await tok(recent.order_id)).toBeNull()
  })

  it('owner sets the window through set_tracking_link_days; other roles and bad values are refused', async () => {
    const s = await shop()
    await asUser(s.owner, 'select public.set_tracking_link_days($1, 30)', [s.org])
    expect((await db().query('select tracking_link_days from public.shop_settings where org_id = $1', [s.org])).rows[0].tracking_link_days).toBe(30)
    await expect(asUser(s.owner, 'select public.set_tracking_link_days($1, 5)', [s.org])).rejects.toThrow(/7 to 3650/)
    const sales = await createUser('sales')
    await addMember(s.owner, s.org, sales, 'sales')
    await expect(asUser(sales, 'select public.set_tracking_link_days($1, 30)', [s.org])).rejects.toThrow()
    await expect(asUser(null, 'select public.set_tracking_link_days($1, 30)', [s.org])).rejects.toThrow(/permission denied/)
  })

  it('rejects windows outside 7..3650 days and is not callable by staff or the public', async () => {
    const s = await shop()
    await expect(db().query(`update public.shop_settings set tracking_link_days = 3 where org_id = $1`, [s.org])).rejects.toThrow()
    await expect(asUser(s.owner, `select public.expire_tracking_links()`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select public.expire_tracking_links()`)).rejects.toThrow(/permission denied/)
  })
})

run('webhook payload retention', () => {
  it('redacts old processed or parked payloads, keeps recent and unprocessed ones, and stays idempotent', async () => {
    const tag = randomUUID()
    const ins = (id: string, age: string, processed: boolean, dead = false) =>
      db().query(
        `insert into public.webhook_events (provider, event_id, payload, received_at, processed_at, dead_at)
         values ('test', $1, '{"from":"+254700000000"}', now() - $2::interval, case when $3 then now() end, case when $4 then now() end)`,
        [`${tag}-${id}`, age, processed, dead],
      )
    await ins('old-done', '40 days', true)
    await ins('old-dead', '40 days', false, true)
    await ins('old-pending', '40 days', false)
    await ins('new-done', '2 days', true)
    await asService(`select public.prune_webhook_payloads()`)
    const { rows } = await db().query(`select event_id, payload from public.webhook_events where event_id like $1`, [`${tag}-%`])
    const by = Object.fromEntries(rows.map((r) => [r.event_id.slice(tag.length + 1), r.payload]))
    expect(by['old-done'].redacted).toBe(true)
    expect(by['old-dead'].redacted).toBe(true)
    expect(by['old-done'].from).toBeUndefined()
    expect(by['old-pending'].from).toBe('+254700000000') // still needs processing
    expect(by['new-done'].from).toBe('+254700000000')
    // The event id survives, so a re-delivery is still recognised as a duplicate.
    await expect(ins('old-done', '1 minute', false)).rejects.toThrow(/duplicate key/)
    await expect(asService(`select public.prune_webhook_payloads(interval '1 hour')`)).rejects.toThrow(/at least one day/)
  })
})

run('per-shop M-Pesa credentials', () => {
  it('stores secrets in Vault, shows staff only a summary, and marks the connection unverified', async () => {
    const s = await shop()
    const { r } = await one<{ r: Record<string, unknown> }>(s.owner, SET, creds(s.org))
    expect(r).toMatchObject({ configured: true, environment: 'sandbox', shortcode: '174379', key_hint: '…1234' })
    expect(JSON.stringify(r)).not.toContain('cs-test-secret')

    const row = (await db().query(`select * from public.org_mpesa_credentials where org_id = $1`, [s.org])).rows[0]
    expect(JSON.stringify(row)).not.toContain('cs-test-secret') // only Vault ids
    const conn = await one<{ state: string }>(s.owner, `select state from public.integration_connections where org_id = $1 and provider = 'mpesa'`, [s.org])
    expect(conn.state).toBe('configured_unverified')

    // Staff cannot read the table or decrypt; the service role can.
    expect(await asUser(s.owner, `select * from public.org_mpesa_credentials`).catch((e) => e.message)).toMatch(/permission denied/)
    await expect(asUser(s.owner, `select public.mpesa_credentials_for($1)`, [s.org])).rejects.toThrow(/permission denied/)
    const [dec] = await asService<{ c: Record<string, string> }>(`select public.mpesa_credentials_for($1) as c`, [s.org])
    expect(dec.c).toMatchObject({ consumer_key: 'ck-test-ABCD1234', consumer_secret: 'cs-test-secret', passkey: 'pk-test-passkey', shortcode: '174379' })
  })

  it('keeps stored secrets when a field is left blank, and replaces them when given', async () => {
    const s = await shop()
    await one(s.owner, SET, creds(s.org))
    await one(s.owner, SET, creds(s.org, { short: '600000', type: 'CustomerBuyGoodsOnline', party: '123456', key: '', secret: '', pass: 'pk-new' }))
    const [dec] = await asService<{ c: Record<string, string> }>(`select public.mpesa_credentials_for($1) as c`, [s.org])
    expect(dec.c).toMatchObject({ consumer_key: 'ck-test-ABCD1234', consumer_secret: 'cs-test-secret', passkey: 'pk-new', shortcode: '600000', party_b: '123456' })
    const vaultRows = (await db().query(`select count(*)::int as n from vault.secrets where name like $1`, [`mpesa:${s.org}:%`])).rows[0].n
    expect(vaultRows).toBe(3)
  })

  it('validates input and allows only owner/admin', async () => {
    const s = await shop()
    await expect(one(s.owner, SET, creds(s.org, { key: '' }))).rejects.toThrow(/consumer key/)
    await expect(one(s.owner, SET, creds(s.org, { short: '12' }))).rejects.toThrow(/5 to 8 digits/)
    await expect(one(s.owner, SET, creds(s.org, { env: 'live' }))).rejects.toThrow(/sandbox or production/)
    const manager = await createUser('mgr')
    await addMember(s.owner, s.org, manager, 'manager')
    await expect(one(manager, SET, creds(s.org))).rejects.toThrow()
    const outsider = await createUser('out')
    await expect(one(outsider, `select public.mpesa_credentials_summary($1)`, [s.org])).rejects.toThrow(/Not found/)
    await expect(asUser(null, SET, creds(s.org))).rejects.toThrow(/permission denied/)
  })

  it('refuses "verified" until an M-Pesa payment has reached Fungua; clearing removes the Vault secrets', async () => {
    const s = await shop()
    await expect(one(s.owner, `select public.mark_mpesa_verified($1)`, [s.org])).rejects.toThrow(/credentials first/)
    await one(s.owner, SET, creds(s.org))
    await expect(one(s.owner, `select public.mark_mpesa_verified($1)`, [s.org])).rejects.toThrow(/test payment/)

    const o = await place(s.slug, s.variantId)
    await db().query(
      `insert into public.mpesa_requests (checkout_request_id, org_id, order_id, amount_minor, provider, status)
       values ($1, $2, $3, 100, 'mpesa', 'paid')`,
      [`ws_CO_${randomUUID()}`, s.org, o.order_id],
    )
    await one(s.owner, `select public.mark_mpesa_verified($1)`, [s.org])
    const conn = await one<{ state: string }>(s.owner, `select state from public.integration_connections where org_id = $1 and provider = 'mpesa'`, [s.org])
    expect(conn.state).toBe('connected_verified')

    // Changing credentials drops back to unverified.
    await one(s.owner, SET, creds(s.org, { key: '', secret: '', pass: '' }))
    expect((await one<{ state: string }>(s.owner, `select state from public.integration_connections where org_id = $1 and provider = 'mpesa'`, [s.org])).state).toBe('configured_unverified')

    await one(s.owner, `select public.clear_mpesa_credentials($1)`, [s.org])
    expect((await db().query(`select count(*)::int as n from vault.secrets where name like $1`, [`mpesa:${s.org}:%`])).rows[0].n).toBe(0)
    expect((await one<{ r: { configured: boolean } }>(s.owner, `select public.mpesa_credentials_summary($1) as r`, [s.org])).r.configured).toBe(false)
  })
})

run('scheduled jobs', () => {
  it('registers every job and HTTP jobs do nothing until the Vault secrets exist', async () => {
    const jobs = await asService<{ job_name: string; active: boolean }>(`select job_name, active from public.rafu_job_status()`)
    expect(jobs.map((j) => j.job_name).sort()).toEqual([
      'rafu-domain-recheck', 'rafu-expire-tracking-links', 'rafu-media-cleanup', 'rafu-mpesa-stk-query',
      'rafu-prune-rate-limits', 'rafu-prune-webhook-payloads', 'rafu-release-stale-orders', 'rafu-whatsapp-retry',
    ])
    expect(jobs.every((j) => j.active)).toBe(true)
    const [r] = await asService<{ id: string | null }>(`select public._invoke_edge_job('media-cleanup') as id`)
    expect(r.id).toBeNull()
    // Every SQL job body runs as the service role without error.
    for (const sql of ['select public.cancel_stale_storefront_orders()', 'select public.prune_rate_limits()', 'select public.expire_tracking_links()', 'select public.prune_webhook_payloads()']) {
      await asService(sql)
    }
    await expect(asUser(null, `select * from public.rafu_job_status()`)).rejects.toThrow(/permission denied/)
  })
})
