import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, key, one, type TestUser } from './helpers'
import { asAnon, saveShop, sf, uniqueSlug } from './storefront-helpers'

/**
 * Parity and expansion RPCs (20261120000050): CSV import, shop extras, team
 * invites, custom domains, storefront extras and eTIMS invoices. Every call
 * runs as `authenticated` / `anon` so RLS and permission checks apply.
 */
const run = describe.skipIf(!DB_URL)

type Json = Record<string, unknown>
const row = (line: number, over: Json = {}) => ({
  line, name: `CSV Product ${line}`, description: null, category: null, variant_name: null, sku: null,
  price_minor: 1000, compare_at_minor: null, stock: null, image_url: null, ...over,
})

async function importRows(user: TestUser, org: string, rows: Json[], mode = 'update', dry = false) {
  const r = await one<{ r: Json }>(user, `select public.import_products($1, $2::jsonb, $3, $4) as r`, [org, JSON.stringify(rows), mode, dry])
  return r.r as { ok: boolean; created_products: number; created_variants: number; updated_variants: number; skipped: number; errors: { line: number; message: string }[] }
}

async function countProducts(org: string) {
  const r = await db().query(`select count(*)::int as n from public.products where org_id = $1`, [org])
  return r.rows[0].n as number
}

run('CSV product import (import_products)', () => {
  let owner: TestUser
  let sales: TestUser
  let org: string
  let otherOrg: string

  beforeAll(async () => {
    owner = await createUser('imp-owner')
    sales = await createUser('imp-sales')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, sales, 'sales')
    const other = await createUser('imp-other')
    otherOrg = await createOrg(other, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  })

  it('dry run validates and counts but writes nothing', async () => {
    const tag = randomUUID().slice(0, 6)
    const before = await countProducts(org)
    const rows = [row(2, { name: `Towel ${tag}`, variant_name: 'Blue', sku: `T-${tag}-B`, stock: 5 }), row(3, { name: `Towel ${tag}`, variant_name: 'Red', sku: `T-${tag}-R` })]
    const r = await importRows(owner, org, rows, 'update', true)
    expect(r).toMatchObject({ ok: true, created_products: 1, created_variants: 2 })
    expect(await countProducts(org)).toBe(before)
  })

  it('creates grouped products with stock, compare-at and images, then updates by SKU', async () => {
    const tag = randomUUID().slice(0, 6)
    const rows = [
      row(2, { name: `Kikoi ${tag}`, variant_name: 'Blue', sku: `K-${tag}-B`, price_minor: 250000, compare_at_minor: 300000, stock: 7, image_url: 'https://img.test/k.jpg' }),
      row(3, { name: `kikoi ${tag}`, variant_name: 'Red', sku: `K-${tag}-R`, price_minor: 250000, stock: 0 }),
    ]
    const r = await importRows(owner, org, rows)
    expect(r).toMatchObject({ ok: true, created_products: 1, created_variants: 2, updated_variants: 0 })
    const v = await one<{ price_minor: string; compare_at_minor: string; on_hand: number; images: Json[]; track_stock: boolean }>(
      owner,
      `select v.price_minor, v.compare_at_minor, il.on_hand, p.images, p.track_stock from public.product_variants v
         join public.products p on p.id = v.product_id join public.inventory_levels il on il.variant_id = v.id
        where v.org_id = $1 and v.sku = $2`,
      [org, `K-${tag}-B`],
    )
    expect(Number(v.price_minor)).toBe(250000)
    expect(Number(v.compare_at_minor)).toBe(300000)
    expect(v.on_hand).toBe(7)
    expect(v.images).toEqual([{ url: 'https://img.test/k.jpg' }])
    expect(v.track_stock).toBe(true)

    const skip = await importRows(owner, org, [row(2, { sku: `k-${tag}-b`, price_minor: 1 })], 'skip')
    expect(skip).toMatchObject({ ok: true, skipped: 1, updated_variants: 0 })

    const upd = await importRows(owner, org, [row(2, { sku: `k-${tag}-b`, price_minor: 260000, stock: 3 })], 'update')
    expect(upd).toMatchObject({ ok: true, updated_variants: 1, created_products: 0 })
    const after = await one<{ price_minor: string; compare_at_minor: string | null; on_hand: number }>(
      owner,
      `select v.price_minor, v.compare_at_minor, il.on_hand from public.product_variants v join public.inventory_levels il on il.variant_id = v.id where v.org_id = $1 and v.sku = $2`,
      [org, `K-${tag}-B`],
    )
    expect(Number(after.price_minor)).toBe(260000)
    expect(after.compare_at_minor).toBeNull()
    expect(after.on_hand).toBe(3)
  })

  it('is all-or-nothing: invalid rows are reported with line numbers and nothing is written', async () => {
    const before = await countProducts(org)
    const r = await importRows(owner, org, [row(2), row(3, { name: '' }), row(4, { price_minor: 100, compare_at_minor: 50 }), row(5, { image_url: 'javascript:alert(1)' }), row(6, { sku: 'DUP' }), row(7, { sku: 'dup' })])
    expect(r.ok).toBe(false)
    expect(r.errors.map((e) => e.line).sort()).toEqual([3, 4, 5, 7])
    expect(await countProducts(org)).toBe(before)
  })

  it('rolls back everything when a write fails mid-way (stock below reserved)', async () => {
    const tag = randomUUID().slice(0, 6)
    const { variantId } = await createProduct(owner, org, 5000)
    await db().query(`update public.product_variants set sku = $2 where id = $1`, [variantId, `R-${tag}`])
    await asUser(owner, `select public.adjust_stock($1, $2, 5, 'received_from_supplier', null, $3)`, [org, variantId, key()])
    await db().query(`update public.inventory_levels set reserved = 4 where variant_id = $1`, [variantId])
    const before = await countProducts(org)
    const r = await importRows(owner, org, [row(2, { name: `New ${tag}` }), row(3, { sku: `R-${tag}`, stock: 1 })])
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ line: 3 })
    expect(r.errors[0].message).toMatch(/reserved/)
    expect(await countProducts(org)).toBe(before)
  })

  it('enforces permission, the row limit and tenant isolation', async () => {
    await expect(importRows(sales, org, [row(2)])).rejects.toThrow(/permission/)
    await expect(importRows(owner, otherOrg, [row(2)])).rejects.toThrow(/permission/)
    const many = Array.from({ length: 2001 }, (_, i) => row(i + 2))
    await expect(importRows(owner, org, many)).rejects.toThrow(/2,000/)
    await expect(asAnon(`select public.import_products($1, '[]'::jsonb, 'update', true)`, [org])).rejects.toThrow(/permission denied/)
  })
})

run('shop extras, storefront extras and custom domains', () => {
  let owner: TestUser
  let manager: TestUser
  let org: string
  let slug: string

  beforeAll(async () => {
    owner = await createUser('ext-owner')
    manager = await createUser('ext-mgr')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, manager, 'manager')
    slug = uniqueSlug('ext')
    await saveShop(owner, org, { slug })
  })

  it('validates pixel / GA4 IDs and KRA PIN server-side; only org.manage may save', async () => {
    await expect(asUser(owner, `select public.save_shop_tracking($1, $2, null)`, [org, "1234');alert(1)//"])).rejects.toThrow(/digits/)
    await expect(asUser(owner, `select public.save_shop_tracking($1, null, $2)`, [org, 'UA-123-1'])).rejects.toThrow(/G-/)
    await asUser(owner, `select public.save_shop_tracking($1, $2, $3)`, [org, '1234 5678 9012 345', 'g-abc1234'])
    await expect(asUser(manager, `select public.save_shop_tracking($1, null, null)`, [org])).rejects.toThrow(/permission/)
    await expect(asUser(owner, `select public.save_kra_pin($1, $2)`, [org, 'P12345'])).rejects.toThrow(/KRA PIN/)
    await asUser(owner, `select public.save_kra_pin($1, $2)`, [org, 'p051234567x'])
    const x = await one<Json>(manager, `select meta_pixel_id, ga4_id, kra_pin from public.shop_extras where org_id = $1`, [org])
    expect(x).toEqual({ meta_pixel_id: '123456789012345', ga4_id: 'G-ABC1234', kra_pin: 'P051234567X' })
    // Direct writes are closed.
    await expect(asUser(owner, `update public.shop_extras set meta_pixel_id = '1' where org_id = $1`, [org])).rejects.toThrow(/permission denied/)
  })

  it('storefront extras expose only the pixel IDs and bank-transfer availability', async () => {
    const r = await sf<Json>('storefront_extras', [slug])
    expect(r).toEqual({ meta_pixel_id: '123456789012345', ga4_id: 'G-ABC1234', bank_transfer_provider: 'none', bank_transfer: false })
    await expect(sf('storefront_extras', ['no-such-shop-x'])).rejects.toThrow(/not found/)
  })

  it('bank transfer only for NGN and only shown when the provider is connected_verified', async () => {
    await expect(asUser(owner, `select public.set_bank_transfer_provider($1, 'paystack_dva')`, [org])).rejects.toThrow(/NGN/)
    const ng = await createUser('ext-ng')
    const ngOrg = await createOrg(ng, 'NGN', { country: 'NG', tz: 'Africa/Lagos', locale: 'en-NG' })
    const ngSlug = uniqueSlug('ng')
    await saveShop(ng, ngOrg, { slug: ngSlug })
    await asUser(ng, `select public.set_bank_transfer_provider($1, 'paystack_dva')`, [ngOrg])
    expect((await sf<Json>('storefront_extras', [ngSlug])).bank_transfer).toBe(false)
    await db().query(`insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'paystack', 'payment', 'connected_verified')`, [ngOrg])
    expect((await sf<Json>('storefront_extras', [ngSlug])).bank_transfer).toBe(true)
  })

  it('custom domain: validated, unique, pending until the service role verifies it', async () => {
    await expect(asUser(owner, `select public.set_custom_domain($1, $2)`, [org, 'https://bad/path'])).rejects.toThrow(/domain/)
    await expect(asUser(owner, `select public.set_custom_domain($1, $2)`, [org, 'shop.example.com'])).rejects.toThrow(/own/)
    await expect(asUser(manager, `select public.set_custom_domain($1, $2)`, [org, 'shop.x-test.co.ke'])).rejects.toThrow(/permission/)
    const host = `shop-${randomUUID().slice(0, 8)}.mybrand-test.co.ke`
    const d = await one<{ r: Json }>(owner, `select public.set_custom_domain($1, $2) as r`, [org, host.toUpperCase() + '.'])
    expect(d.r).toMatchObject({ hostname: host, status: 'pending_dns' })
    expect(await sf('storefront_resolve_host', [host])).toBeNull()
    await expect(asUser(owner, `select public.mark_custom_domain_status($1, 'verified', null)`, [host])).rejects.toThrow(/permission denied/)

    const c = await db().connect()
    try {
      await c.query('begin')
      await c.query('set local role service_role')
      await c.query(`select public.mark_custom_domain_status($1, 'verified', null)`, [host])
      await c.query('commit')
    } finally {
      c.release()
    }
    expect(await sf('storefront_resolve_host', [host])).toBe(slug)

    const other = await createUser('ext-other')
    const otherOrg = await createOrg(other, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await saveShop(other, otherOrg, { slug: uniqueSlug('oth') })
    await expect(asUser(other, `select public.set_custom_domain($1, $2)`, [otherOrg, host])).rejects.toThrow(/another shop/)
    // Members of another org cannot read this domain row.
    expect(await asUser(other, `select * from public.custom_domains where org_id = $1`, [org])).toEqual([])
    await asUser(owner, `select public.remove_custom_domain($1)`, [org])
    expect(await sf('storefront_resolve_host', [host])).toBeNull()
  })
})

run('team invites', () => {
  let owner: TestUser
  let admin: TestUser
  let sales: TestUser
  let org: string

  beforeAll(async () => {
    owner = await createUser('inv-owner')
    admin = await createUser('inv-admin')
    sales = await createUser('inv-sales')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, admin, 'admin')
    await addMember(owner, org, sales, 'sales')
  })

  async function invite(by: TestUser, email: string | null, phone: string | null, role: string) {
    const r = await one<{ r: { invite: Json; token: string } }>(by, `select public.create_team_invite($1, $2, $3, $4::public.member_role) as r`, [org, email, phone, role])
    return r.r
  }

  it('stores only a hash of the token and accepts once for the matching email', async () => {
    const invitee = await createUser('inv-new')
    const { invite: inv, token } = await invite(owner, invitee.email.toUpperCase(), null, 'fulfilment')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(inv).toMatchObject({ role: 'fulfilment', status: 'pending', email: invitee.email })
    const stored = await db().query(`select token_hash from public.team_invites where id = $1`, [inv.id])
    expect(stored.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))

    const preview = await sf<Json>('preview_team_invite', [token])
    expect(preview).toMatchObject({ role: 'fulfilment', status: 'pending', contact_kind: 'email' })
    expect(String(preview.contact_hint)).toContain('***@')

    const stranger = await createUser('inv-stranger')
    await expect(asUser(stranger, `select public.accept_team_invite($1)`, [token])).rejects.toThrow(/different email/)
    await expect(asAnon(`select public.accept_team_invite($1)`, [token])).rejects.toThrow(/permission denied/)

    const joined = await one<{ id: string }>(invitee, `select public.accept_team_invite($1) as id`, [token])
    expect(joined.id).toBe(org)
    const m = await one<{ role: string }>(owner, `select role from public.memberships where org_id = $1 and user_id = $2`, [org, invitee.id])
    expect(m.role).toBe('fulfilment')
    await expect(asUser(invitee, `select public.accept_team_invite($1)`, [token])).rejects.toThrow(/already used/)
  })

  it('phone invites are single-use bearer links; expired invites cannot be used', async () => {
    const { invite: inv, token } = await invite(admin, null, '+254712000999', 'sales')
    const someone = await createUser('inv-phone')
    await db().query(`update public.team_invites set expires_at = now() - interval '1 minute' where id = $1`, [inv.id])
    expect((await sf<Json>('preview_team_invite', [token])).status).toBe('expired')
    await expect(asUser(someone, `select public.accept_team_invite($1)`, [token])).rejects.toThrow(/expired/)

    const fresh = await invite(admin, null, '+254712000998', 'sales')
    await asUser(someone, `select public.accept_team_invite($1)`, [fresh.token])
    const other = await createUser('inv-phone2')
    await expect(asUser(other, `select public.accept_team_invite($1)`, [fresh.token])).rejects.toThrow(/already used/)
  })

  it('role rules: only owners invite owners, staff cannot invite or list, revoke closes the link', async () => {
    await expect(invite(admin, 'boss@example.test', null, 'owner')).rejects.toThrow(/Only an owner/)
    await expect(invite(sales, 'x@example.test', null, 'sales')).rejects.toThrow(/permission/)
    await expect(asUser(sales, `select public.list_team_invites($1)`, [org])).rejects.toThrow(/permission/)
    await expect(invite(owner, 'bad-email', null, 'sales')).rejects.toThrow(/valid email/)
    await expect(invite(owner, 'a@example.test', '+254712000000', 'sales')).rejects.toThrow(/email or by phone/)

    const { invite: inv, token } = await invite(owner, `rev-${randomUUID().slice(0, 6)}@example.test`, null, 'analyst')
    await asUser(admin, `select public.revoke_team_invite($1, $2)`, [org, inv.id])
    expect((await sf<Json>('preview_team_invite', [token])).status).toBe('revoked')
    const list = await one<{ r: Json[] }>(owner, `select public.list_team_invites($1) as r`, [org])
    expect(list.r.some((i) => i.id === inv.id && i.status === 'revoked')).toBe(true)
    expect(JSON.stringify(list.r)).not.toMatch(/token/)
    // The table itself is closed to clients.
    await expect(asUser(owner, `select * from public.team_invites`)).rejects.toThrow(/permission denied/)
  })
})

run('eTIMS tax invoices', () => {
  let owner: TestUser
  let fulfil: TestUser
  let org: string
  let variantId: string

  beforeAll(async () => {
    owner = await createUser('tax-owner')
    fulfil = await createUser('tax-fulfil')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, fulfil, 'fulfilment')
    variantId = (await createProduct(owner, org, 250000, { taxBps: 1600, track: false })).variantId
  })

  async function order(status = 'confirmed', delivery = 15000) {
    const r = await one<{ id: string }>(owner, `select public.create_order($1, $2::jsonb, $3) as id`, [
      org,
      JSON.stringify({ status, channel: 'whatsapp', delivery_fee_minor: delivery, fulfilment: { method: 'delivery' }, lines: [{ variant_id: variantId, quantity: 2 }] }),
      key(),
    ])
    return r.id
  }

  it('needs the seller KRA PIN, numbers per org, is idempotent and immutable', async () => {
    const o1 = await order()
    const o2 = await order()
    await expect(asUser(owner, `select public.issue_tax_invoice($1, $2, null, null)`, [org, o1])).rejects.toThrow(/KRA PIN/)
    await asUser(owner, `select public.save_kra_pin($1, 'P051234567X')`, [org])
    await expect(asUser(owner, `select public.issue_tax_invoice($1, $2, 'bad', null)`, [org, o1])).rejects.toThrow(/Buyer KRA PIN/)
    await expect(asUser(fulfil, `select public.issue_tax_invoice($1, $2, null, null)`, [org, o1])).rejects.toThrow(/permission/)

    const id1 = (await one<{ id: string }>(owner, `select public.issue_tax_invoice($1, $2, 'a123456789z', 'Acme Ltd') as id`, [org, o1])).id
    const id2 = (await one<{ id: string }>(owner, `select public.issue_tax_invoice($1, $2, null, null) as id`, [org, o2])).id
    const again = (await one<{ id: string }>(owner, `select public.issue_tax_invoice($1, $2, null, 'Other') as id`, [org, o1])).id
    expect(again).toBe(id1)

    const inv = await one<Json>(fulfil, `select invoice_number, buyer_pin, buyer_name, net_minor, tax_minor, delivery_minor, total_minor, lines, kra_status from public.tax_invoices where id = $1`, [id1])
    expect(inv.invoice_number).toBe(1)
    expect(inv).toMatchObject({ buyer_pin: 'A123456789Z', buyer_name: 'Acme Ltd', kra_status: 'not_submitted' })
    expect(Number(inv.net_minor)).toBe(500000)
    expect(Number(inv.tax_minor)).toBe(80000)
    expect(Number(inv.net_minor) + Number(inv.tax_minor) + Number(inv.delivery_minor)).toBe(Number(inv.total_minor))
    expect((inv.lines as Json[])[0]).toMatchObject({ quantity: 2, net_minor: 500000, tax_minor: 80000, gross_minor: 580000 })
    expect((await one<{ n: number }>(owner, `select invoice_number as n from public.tax_invoices where id = $1`, [id2])).n).toBe(2)

    await expect(db().query(`update public.tax_invoices set total_minor = 1 where id = $1`, [id1])).rejects.toThrow(/permanent/)
    await expect(asUser(owner, `insert into public.tax_invoices (org_id) values ($1)`, [org])).rejects.toThrow(/permission denied/)
  })

  it('refuses drafts and other tenants', async () => {
    const draft = await order('draft')
    await expect(asUser(owner, `select public.issue_tax_invoice($1, $2, null, null)`, [org, draft])).rejects.toThrow(/confirmed orders/)
    const outsider = await createUser('tax-out')
    const outOrg = await createOrg(outsider, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await asUser(outsider, `select public.save_kra_pin($1, 'A000000000B')`, [outOrg])
    const o = await order()
    await expect(asUser(outsider, `select public.issue_tax_invoice($1, $2, null, null)`, [outOrg, o])).rejects.toThrow(/not found/)
    expect(await asUser(outsider, `select * from public.tax_invoices where org_id = $1`, [org])).toEqual([])
  })
})

afterAll(async () => {
  await closeDb()
})
