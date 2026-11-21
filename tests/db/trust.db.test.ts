import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, one, type TestUser } from './helpers'
import { asAnon, guestOrder, randomIp, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'
import { canExportCustomers } from '../../src/domain/marketing'
import { normaliseBusinessName } from '../../src/domain/trust'
import { ROLES } from '../../src/domain/permissions'

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

interface Shop {
  owner: TestUser
  org: string
  slug: string
  till: string
  variantId: string
}

async function createShop(label: string): Promise<Shop> {
  const owner = await createUser(label)
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const { variantId } = await createProduct(owner, org, 150_000, { track: false })
  const slug = uniqueSlug('tr')
  await saveShop(owner, org, { slug })
  const till = String(randomInt(1_000_000, 9_999_999))
  const wa = `+2547${randomInt(10_000_000, 99_999_999)}`
  await db().query(`update public.shop_settings set mpesa_till = $2, whatsapp_e164 = $3, registered_name = 'Mto Home Ltd' where org_id = $1`, [org, till, wa])
  await db().query(`insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'mpesa', 'payment', 'connected_verified')`, [org])
  await asUser(owner, `select public.set_collections_provider($1, 'daraja', null)`, [org])
  return { owner, org, slug, till, variantId }
}

async function placeOrder(shop: Shop, extra: { marketing_opt_in?: boolean; phone_e164?: string } = {}) {
  const input = guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }], ...extra })
  const placed = await sf<{ order_id: string; tracking_token: string; total_minor: number }>('storefront_place_order', [shop.slug, JSON.stringify(input), sfKey()])
  return { ...placed, phone: input.phone_e164 }
}

async function customerByPhone(user: TestUser, org: string, phone: string) {
  return one<{ id: string; marketing_consent: boolean; consent_updated_at: Date | null; consent_source: string | null }>(
    user,
    `select id, marketing_consent, consent_updated_at, consent_source from public.customers where org_id = $1 and phone_e164 = $2`,
    [org, phone],
  )
}

run('trust, verification and consent (database)', () => {
  let shop: Shop
  let manager: TestUser
  let sales: TestUser
  let analyst: TestUser
  let stranger: TestUser
  let reviewer: TestUser

  beforeAll(async () => {
    shop = await createShop('trust-owner')
    manager = await createUser('trust-manager')
    sales = await createUser('trust-sales')
    analyst = await createUser('trust-analyst')
    stranger = await createUser('trust-stranger')
    reviewer = await createUser('trust-reviewer')
    await createOrg(stranger)
    await addMember(shop.owner, shop.org, manager, 'manager')
    await addMember(shop.owner, shop.org, sales, 'sales')
    await addMember(shop.owner, shop.org, analyst, 'analyst')
    await db().query(`insert into public.platform_admins (user_id) values ($1)`, [reviewer.id])
  })

  afterAll(async () => {
    await closeDb()
  })

  describe('marketing consent', () => {
    it('checkout opt-in is stamped with time and source; an unticked box stores nothing', async () => {
      const yes = await placeOrder(shop, { marketing_opt_in: true })
      const c = await customerByPhone(shop.owner, shop.org, yes.phone)
      expect(c.marketing_consent).toBe(true)
      expect(c.consent_source).toBe('checkout')
      expect(c.consent_updated_at).toBeInstanceOf(Date)

      const no = await placeOrder(shop)
      const n = await customerByPhone(shop.owner, shop.org, no.phone)
      expect(n).toMatchObject({ marketing_consent: false, consent_updated_at: null, consent_source: null })
    })

    it('the timestamp only moves when consent changes; staff changes are marked staff', async () => {
      const { phone } = await placeOrder(shop, { marketing_opt_in: true })
      const before = await customerByPhone(shop.owner, shop.org, phone)
      await asUser(sales, `update public.customers set notes = 'VIP', consent_updated_at = now() + interval '1 day' where id = $1`, [before.id])
      const same = await customerByPhone(shop.owner, shop.org, phone)
      expect(same.consent_updated_at?.toISOString()).toBe(before.consent_updated_at?.toISOString())
      expect(same.consent_source).toBe('checkout')

      await asUser(sales, `update public.customers set marketing_consent = false, consent_source = 'checkout' where id = $1`, [before.id])
      const off = await customerByPhone(shop.owner, shop.org, phone)
      expect(off).toMatchObject({ marketing_consent: false, consent_source: 'staff' })
    })

    it('opt_out_customer records how; analysts cannot; other businesses cannot', async () => {
      const { phone } = await placeOrder(shop, { marketing_opt_in: true })
      const c = await customerByPhone(shop.owner, shop.org, phone)
      await expect(asUser(analyst, `select public.opt_out_customer($1, $2, 'stop_reply')`, [shop.org, c.id])).rejects.toThrow(/permission/)
      await expect(asUser(stranger, `select public.opt_out_customer($1, $2, 'stop_reply')`, [shop.org, c.id])).rejects.toThrow(/permission/)
      await expect(asUser(sales, `select public.opt_out_customer($1, $2, 'whatever')`, [shop.org, c.id])).rejects.toThrow(/how the customer/)
      await asUser(sales, `select public.opt_out_customer($1, $2, 'stop_reply')`, [shop.org, c.id])
      expect(await customerByPhone(shop.owner, shop.org, phone)).toMatchObject({ marketing_consent: false, consent_source: 'stop_reply' })
    })

    it('the buyer can opt out from the tracking link (all records with that phone)', async () => {
      const first = await placeOrder(shop, { marketing_opt_in: true })
      const second = await placeOrder(shop, { marketing_opt_in: true, phone_e164: first.phone })
      await sf('storefront_marketing_opt_out', [second.tracking_token])
      expect(await customerByPhone(shop.owner, shop.org, first.phone)).toMatchObject({ marketing_consent: false, consent_source: 'buyer_link' })
      await expect(sf('storefront_marketing_opt_out', ['x'.repeat(24)])).rejects.toThrow(/Order not found/)
    })
  })

  describe('re-engagement', () => {
    it('refuses non-consenting customers, enforces 7 days, logs contacts readable by members only', async () => {
      const no = await placeOrder(shop)
      const yes = await placeOrder(shop, { marketing_opt_in: true })
      const noC = await customerByPhone(shop.owner, shop.org, no.phone)
      const yesC = await customerByPhone(shop.owner, shop.org, yes.phone)

      await expect(asUser(sales, `select public.start_marketing_chat($1, $2, 'recent')`, [shop.org, noC.id])).rejects.toThrow(/not agreed to offers/)
      const r = await one<{ phone: string }>(sales, `select public.start_marketing_chat($1, $2, 'recent') as phone`, [shop.org, yesC.id])
      expect(r.phone).toBe(yes.phone)
      await expect(asUser(sales, `select public.start_marketing_chat($1, $2, 'top')`, [shop.org, yesC.id])).rejects.toThrow(/last 7 days/)
      await expect(asUser(analyst, `select public.start_marketing_chat($1, $2, 'recent')`, [shop.org, yesC.id])).rejects.toThrow(/permission/)
      await expect(asUser(sales, `select public.start_marketing_chat($1, $2, 'everyone')`, [shop.org, yesC.id])).rejects.toThrow(/Unknown customer group/)

      const mine = await asUser(analyst, `select customer_id from public.marketing_contacts where org_id = $1`, [shop.org])
      expect(mine.map((m) => m.customer_id)).toContain(yesC.id)
      expect(await asUser(stranger, `select * from public.marketing_contacts where org_id = $1`, [shop.org])).toEqual([])
      await expect(asUser(sales, `insert into public.marketing_contacts (org_id, customer_id, segment) values ($1, $2, 'recent')`, [shop.org, noC.id])).rejects.toThrow(
        /permission denied/,
      )
    })
  })

  describe('customer export', () => {
    it('matches canExportCustomers() for every role', async () => {
      const o = await createUser('trust-roles')
      const org = await createOrg(o)
      for (const role of ROLES) {
        const r = await one<{ ok: boolean }>(o, `select (public.member_role_in($1) is not null) as ok`, [org])
        expect(r.ok).toBe(true)
        const ok = await db().query(`select coalesce($1::public.member_role in ('owner', 'admin', 'manager'), false) as ok`, [role])
        expect(ok.rows[0].ok).toBe(canExportCustomers(role))
      }
    })

    it('owners and managers get server-computed rows; sales, strangers and anon do not; each export is audited', async () => {
      const { phone } = await placeOrder(shop, { marketing_opt_in: true })
      const rows = (await one<{ r: Record<string, unknown>[] }>(manager, `select public.export_customers($1) as r`, [shop.org])).r
      const row = rows.find((x) => x.phone_e164 === phone)!
      expect(row).toMatchObject({ order_count: 1, marketing_consent: true, consent_source: 'checkout' })
      expect(row.spent).toEqual([{ currency: 'KES', total_minor: 150_000 }])

      await expect(asUser(sales, `select public.export_customers($1)`, [shop.org])).rejects.toThrow(/owners, admins and managers/)
      await expect(asUser(stranger, `select public.export_customers($1)`, [shop.org])).rejects.toThrow(/owners, admins and managers/)
      await expect(asAnon(`select public.export_customers($1)`, [shop.org])).rejects.toThrow(/permission denied/)
      const audit = await asUser(shop.owner, `select actor_id from public.audit_log where org_id = $1 and entity = 'customers' and action = 'export'`, [shop.org])
      expect(audit.map((a) => a.actor_id)).toContain(manager.id)
    })
  })

  describe('verification', () => {
    it('a new shop has no badges and hides its completed-order count below 5', async () => {
      const t = await sf<Record<string, unknown>>('storefront_trust', [shop.slug])
      expect(t).toMatchObject({ phone_verified: false, mpesa_name: null, documents_approved: false, completed_orders: null })
      expect(typeof t.on_rafu_since).toBe('string')
    })

    it('phone is verified only by a confirmed auth phone equal to the shop WhatsApp number of an owner/admin', async () => {
      const wa = (await db().query(`select whatsapp_e164 from public.shop_settings where org_id = $1`, [shop.org])).rows[0].whatsapp_e164 as string
      // A manager confirming the number does not count.
      await db().query(`update auth.users set phone = $2, phone_confirmed_at = now() where id = $1`, [manager.id, wa.slice(1)])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).phone_verified).toBe(false)
      // An unconfirmed owner phone does not count. (Auth phones are unique, so release the manager's first.)
      await db().query(`update auth.users set phone = null, phone_confirmed_at = null where id = $1`, [manager.id])
      await db().query(`update auth.users set phone = $2, phone_confirmed_at = null where id = $1`, [shop.owner.id, wa.slice(1)])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).phone_verified).toBe(false)
      await db().query(`update auth.users set phone_confirmed_at = now() where id = $1`, [shop.owner.id])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).phone_verified).toBe(true)
      const v = await one<{ v: Record<string, unknown> }>(analyst, `select public.get_shop_verification($1) as v`, [shop.org])
      expect(v.v.phone_verified).toBe(true)
      await expect(asUser(stranger, `select public.get_shop_verification($1)`, [shop.org])).rejects.toThrow(/Business not found/)
    })

    it('M-Pesa name: service role only, shortcode must be a verified Daraja shop, badge only when names match', async () => {
      await expect(asUser(shop.owner, `select public.record_mpesa_business_name($1, 'MTO HOME LIMITED', 'daraja_status')`, [shop.till])).rejects.toThrow(/permission denied/)
      expect((await svc<{ r: { outcome: string } }>(`select public.record_mpesa_business_name('99999999', 'X Y', 'daraja_status') as r`))[0].r.outcome).toBe('unknown_shortcode')

      await svc(`select public.record_mpesa_business_name($1, 'SOMEONE ELSE', 'daraja_status')`, [shop.till])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).mpesa_name).toBeNull()
      const v = await one<{ v: Record<string, unknown> }>(shop.owner, `select public.get_shop_verification($1) as v`, [shop.org])
      expect(v.v).toMatchObject({ reported_name: 'SOMEONE ELSE', name_matched: false })

      await svc(`select public.record_mpesa_business_name($1, $2, 'daraja_status')`, [shop.till, `${shop.till} - MTO HOME LIMITED`])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).mpesa_name).toBe('MTO HOME LIMITED')
    })

    it('SQL and TypeScript normalise business names the same way', async () => {
      for (const n of ['5123456 - Mto Home Ltd.', 'Jua & Sons Enterprises', '  kibanda   co ', 'ACME-ENT', 'Wanjiku’s Shop']) {
        const r = await one<{ n: string }>(shop.owner, `select public._normalise_business_name($1) as n`, [n])
        expect(r.n).toBe(normaliseBusinessName(n))
      }
    })

    it('documents: owner uploads to own folder, a platform reviewer approves; nobody else can review', async () => {
      const otherFolder = `${randomUUID()}/${randomUUID()}.pdf`
      await expect(asUser(shop.owner, `insert into storage.objects (bucket_id, name) values ('verification-docs', $1)`, [otherFolder])).rejects.toThrow(/row-level security/)
      await expect(
        asUser(manager, `insert into storage.objects (bucket_id, name) values ('verification-docs', $1)`, [`${shop.org}/${randomUUID()}.pdf`]),
      ).rejects.toThrow(/row-level security/)
      const path = `${shop.org}/${randomUUID()}.pdf`
      await asUser(shop.owner, `insert into storage.objects (bucket_id, name) values ('verification-docs', $1) returning name`, [path])

      await expect(asUser(shop.owner, `select public.submit_verification_documents($1, 'kra_pin', $2)`, [shop.org, [`${shop.org}/missing.pdf`]])).rejects.toThrow(
        /did not finish/,
      )
      await expect(asUser(manager, `select public.submit_verification_documents($1, 'kra_pin', $2)`, [shop.org, [path]])).rejects.toThrow(/permission/)
      await asUser(shop.owner, `select public.submit_verification_documents($1, 'kra_pin', $2)`, [shop.org, [path]])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).documents_approved).toBe(false)

      await expect(asUser(shop.owner, `select public.review_verification_documents($1, 'approved', null)`, [shop.org])).rejects.toThrow(/Only Fungua reviewers/)
      await expect(asUser(shop.owner, `select public.admin_verification_queue()`)).rejects.toThrow(/Only Fungua reviewers/)
      const queue = (await one<{ q: { org_id: string; paths: string[] }[] }>(reviewer, `select public.admin_verification_queue() as q`)).q
      expect(queue.find((q) => q.org_id === shop.org)?.paths).toEqual([path])
      // Reviewers can read the file; another business cannot.
      expect(await asUser(reviewer, `select name from storage.objects where bucket_id = 'verification-docs' and name = $1`, [path])).toHaveLength(1)
      expect(await asUser(stranger, `select name from storage.objects where bucket_id = 'verification-docs' and name = $1`, [path])).toHaveLength(0)

      await expect(asUser(reviewer, `select public.review_verification_documents($1, 'rejected', '')`, [shop.org])).rejects.toThrow(/Say why/)
      await asUser(reviewer, `select public.review_verification_documents($1, 'approved', null)`, [shop.org])
      expect((await sf<Record<string, unknown>>('storefront_trust', [shop.slug])).documents_approved).toBe(true)
      // Merchants cannot write the status themselves.
      await expect(asUser(shop.owner, `update public.shop_verifications set documents_status = 'approved' where org_id = $1`, [shop.org])).rejects.toThrow(
        /permission denied/,
      )
    })

    it('unpublished shops have no public trust data', async () => {
      const s2 = await createShop('trust-unpub')
      await db().query(`update public.shop_settings set published = false where org_id = $1`, [s2.org])
      await expect(sf('storefront_trust', [s2.slug])).rejects.toThrow(/Shop not found/)
    })
  })

  describe('reports', () => {
    it('anonymous reports are stored, rate-limited per client, and visible only to reviewers', async () => {
      const ip = randomIp()
      await expect(sf('storefront_report_shop', [shop.slug, 'other', ' '], ip)).rejects.toThrow(/what happened/)
      await expect(sf('storefront_report_shop', [shop.slug, 'bogus', null], ip)).rejects.toThrow(/what went wrong/)
      await sf('storefront_report_shop', [shop.slug, 'not_as_described', 'Colour was different'], ip)
      await sf('storefront_report_shop', [shop.slug, 'not_delivered', null], ip)
      await expect(sf('storefront_report_shop', [shop.slug, 'fake_shop', null], ip)).rejects.toThrow(/Too many/)

      await expect(asAnon(`select * from public.shop_reports`)).rejects.toThrow(/permission denied/)
      await expect(asUser(shop.owner, `select * from public.shop_reports`)).rejects.toThrow(/permission denied/)
      await expect(asUser(shop.owner, `select public.admin_shop_reports(null)`)).rejects.toThrow(/Only Fungua reviewers/)

      const reports = (await one<{ r: { id: string; org_id: string; reason: string }[] }>(reviewer, `select public.admin_shop_reports('open') as r`)).r.filter(
        (r) => r.org_id === shop.org,
      )
      expect(reports.map((r) => r.reason).sort()).toEqual(['not_as_described', 'not_delivered'])
      await asUser(reviewer, `select public.resolve_shop_report($1, 'reviewed')`, [reports[0].id])
      await expect(asUser(reviewer, `select public.resolve_shop_report($1, 'dismissed')`, [reports[0].id])).rejects.toThrow(/already handled/)
      const cols = await db().query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'shop_reports'`)
      expect(cols.rows.map((r) => r.column_name)).not.toContain('ip')
    })
  })

  describe('payment receipts on the tracking page', () => {
    it('shows only provider-verified payments, masked, with the paid-to name', async () => {
      const s3 = await createShop('trust-receipt')
      const placed = await placeOrder(s3)
      expect(await sf('storefront_payment_receipts', [placed.tracking_token])).toEqual([])

      await asUser(s3.owner, `select public.record_manual_payment($1, 50000, 'KES', 'mobile_money', 'SJK4H7Q2P1', now(), null, $2)`, [placed.order_id, sfKey()])
      expect(await sf('storefront_payment_receipts', [placed.tracking_token])).toEqual([])

      await svc(`select public.record_verified_payment($1, 'mpesa', 'mobile_money', 100000, 'KES', 'TKL9A2B3C4', now())`, [placed.order_id])
      let r = await sf<Record<string, unknown>[]>('storefront_payment_receipts', [placed.tracking_token])
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ amount_minor: 100000, currency: 'KES', receipt_masked: 'TKL•••••C4', paid_to_name: 'Mto Home Ltd', paid_to_verified: false })

      await svc(`select public.record_mpesa_business_name($1, 'MTO HOME LIMITED', 'daraja_status')`, [s3.till])
      r = await sf<Record<string, unknown>[]>('storefront_payment_receipts', [placed.tracking_token])
      expect(r[0]).toMatchObject({ paid_to_name: 'MTO HOME LIMITED', paid_to_verified: true })
      await expect(sf('storefront_payment_receipts', ['short'])).rejects.toThrow(/Order not found/)
    })
  })
})
