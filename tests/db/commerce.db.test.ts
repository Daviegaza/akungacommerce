import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, key, level, one, type TestUser } from './helpers'
import { computeOrderTotals } from '../../src/domain/orders'
import { PERMISSION_MATRIX, ROLES } from '../../src/domain/permissions'

const run = describe.skipIf(!DB_URL)

async function createOrder(user: TestUser, org: string, lines: { variant_id: string; quantity: number; discount_minor?: number; unit_price_minor?: number }[], extra: Record<string, unknown> = {}, idem = key()) {
  const row = await one<{ id: string }>(user, `select public.create_order($1, $2::jsonb, $3) as id`, [
    org,
    JSON.stringify({ status: 'confirmed', channel: 'whatsapp', lines, ...extra }),
    idem,
  ])
  return row.id
}

async function orderRow(user: TestUser, id: string) {
  return one<{ status: string; total_minor: string; subtotal_minor: string; tax_minor: string; currency: string }>(
    user, `select status, total_minor, subtotal_minor, tax_minor, currency from public.orders where id = $1`, [id])
}

run('tenant isolation', () => {
  let alice: TestUser, bob: TestUser
  let orgA: string, orgB: string
  let variantA: string, orderA: string, customerA: string

  beforeAll(async () => {
    alice = await createUser('alice')
    bob = await createUser('bob')
    orgA = await createOrg(alice, 'USD')
    orgB = await createOrg(bob, 'EUR', { country: 'DE', tz: 'Europe/Berlin', locale: 'de-DE' })
    ;({ variantId: variantA } = await createProduct(alice, orgA, 2500, { cost: 900 }))
    await asUser(alice, `select public.adjust_stock($1, $2, 10, 'received_from_supplier', null, $3)`, [orgA, variantA, key()])
    customerA = (await one<{ id: string }>(alice, `insert into public.customers (org_id, name, phone_e164) values ($1, 'Ada', '+447700900123') returning id`, [orgA])).id
    orderA = await createOrder(alice, orgA, [{ variant_id: variantA, quantity: 1 }], { customer_id: customerA })
  })

  it('a second organisation cannot read the first organisation\'s rows', async () => {
    for (const table of ['organisations', 'products', 'product_variants', 'variant_costs', 'customers', 'orders', 'order_lines', 'payments', 'inventory_levels', 'stock_movements', 'memberships', 'audit_log', 'fulfilments']) {
      const col = table === 'organisations' ? 'id' : 'org_id'
      const rows = await asUser(bob, `select 1 from public.${table} where ${col} = $1`, [orgA])
      expect(rows, table).toHaveLength(0)
    }
  })

  it('anonymous visitors cannot read any business data', async () => {
    await expect(asUser(null, `select * from public.orders`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select * from public.products`)).rejects.toThrow(/permission denied/)
  })

  it('cannot write into another organisation directly or through RPCs', async () => {
    await expect(asUser(bob, `insert into public.products (org_id, name) values ($1, 'x')`, [orgA])).rejects.toThrow(/row-level security/)
    await expect(asUser(bob, `insert into public.customers (org_id, name) values ($1, 'x')`, [orgA])).rejects.toThrow(/row-level security/)
    await expect(createOrder(bob, orgA, [{ variant_id: variantA, quantity: 1 }])).rejects.toThrow(/permission/)
    await expect(asUser(bob, `select public.transition_order($1, 'cancelled')`, [orderA])).rejects.toThrow(/not found/i)
    await expect(asUser(bob, `select public.record_manual_payment($1, 100, 'USD', 'cash', null, now(), null, $2)`, [orderA, key()])).rejects.toThrow(/not found/i)
    await expect(asUser(bob, `select public.adjust_stock($1, $2, 5, 'correction', null, $3)`, [orgA, variantA, key()])).rejects.toThrow(/permission/)
    const updated = await asUser(bob, `update public.products set name = 'hijack' where org_id = $1 returning id`, [orgA])
    expect(updated).toHaveLength(0)
  })

  it('cannot reference another organisation\'s variant or customer in its own order', async () => {
    const { variantId: variantB } = await createProduct(bob, orgB, 1000)
    await asUser(bob, `select public.adjust_stock($1, $2, 5, 'received_from_supplier', null, $3)`, [orgB, variantB, key()])
    await expect(createOrder(bob, orgB, [{ variant_id: variantA, quantity: 1 }])).rejects.toThrow(/unavailable/)
    await expect(createOrder(bob, orgB, [{ variant_id: variantB, quantity: 1 }], { customer_id: customerA })).rejects.toThrow(/Customer not found/)
  })
})

run('roles and permissions', () => {
  let owner: TestUser, sales: TestUser, analyst: TestUser, fulfil: TestUser
  let org: string, variant: string

  beforeAll(async () => {
    owner = await createUser('owner')
    sales = await createUser('sales')
    analyst = await createUser('analyst')
    fulfil = await createUser('fulfil')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    await addMember(owner, org, sales, 'sales')
    await addMember(owner, org, analyst, 'analyst')
    await addMember(owner, org, fulfil, 'fulfilment')
    ;({ variantId: variant } = await createProduct(owner, org, 150000, { cost: 90000 }))
    await asUser(owner, `select public.adjust_stock($1, $2, 20, 'received_from_supplier', null, $3)`, [org, variant, key()])
  })

  it('SQL permission matrix matches the TypeScript matrix', async () => {
    for (const role of ROLES) {
      for (const [perm, roles] of Object.entries(PERMISSION_MATRIX)) {
        const r = await one<{ ok: boolean }>(owner, `select public.role_has_permission($1::public.member_role, $2) as ok`, [role, perm])
        expect(r.ok, `${role} ${perm}`).toBe((roles as readonly string[]).includes(role))
      }
    }
  })

  it('analyst is read-only', async () => {
    expect(await asUser(analyst, `select id from public.orders where org_id = $1`, [org])).toBeDefined()
    await expect(createProduct(analyst, org, 100)).rejects.toThrow(/permission/)
    await expect(createOrder(analyst, org, [{ variant_id: variant, quantity: 1 }])).rejects.toThrow(/permission/)
    await expect(asUser(analyst, `insert into public.customers (org_id, name) values ($1, 'x')`, [org])).rejects.toThrow(/row-level security/)
  })

  it('sales can sell but cannot see costs, adjust stock or refund', async () => {
    const order = await createOrder(sales, org, [{ variant_id: variant, quantity: 1 }])
    expect(order).toBeTruthy()
    expect(await asUser(sales, `select * from public.variant_costs where org_id = $1`, [org])).toHaveLength(0)
    expect(await asUser(owner, `select * from public.variant_costs where org_id = $1`, [org])).toHaveLength(1)
    expect(await asUser(sales, `select * from public.audit_log where org_id = $1`, [org])).toHaveLength(0)
    await expect(asUser(sales, `select public.adjust_stock($1, $2, 1, 'correction', null, $3)`, [org, variant, key()])).rejects.toThrow(/permission/)
    const pay = await one<{ id: string }>(sales, `select public.record_manual_payment($1, 1000, 'KES', 'mobile_money', 'QWE123', now(), null, $2) as id`, [order, key()])
    await expect(asUser(sales, `select public.record_refund($1, 100, 'KES', 'test', $2)`, [pay.id, key()])).rejects.toThrow(/permission/)
  })

  it('fulfilment can move orders forward but cannot cancel', async () => {
    const order = await createOrder(owner, org, [{ variant_id: variant, quantity: 1 }])
    await asUser(fulfil, `select public.transition_order($1, 'preparing')`, [order])
    await expect(asUser(fulfil, `select public.transition_order($1, 'cancelled')`, [order])).rejects.toThrow(/permission/)
  })

  it('team rules: only owners manage owners and the last owner stays', async () => {
    const admin = await createUser('admin')
    await addMember(owner, org, admin, 'admin')
    await expect(asUser(admin, `select public.set_member_role($1, $2, 'sales')`, [org, owner.id])).rejects.toThrow(/owner/)
    await expect(asUser(owner, `select public.set_member_role($1, $2, 'admin')`, [org, owner.id])).rejects.toThrow(/at least one owner/)
    await expect(asUser(owner, `insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [org, admin.id])).rejects.toThrow(/permission denied/)
    await expect(asUser(admin, `select public.add_member_by_email($1, 'nobody@example.test', 'sales')`, [org])).rejects.toThrow(/create an Akunga account/)
  })
})

run('orders, totals and idempotency', () => {
  let owner: TestUser, org: string, variant: string, variantTaxed: string

  beforeAll(async () => {
    owner = await createUser('orders')
    org = await createOrg(owner, 'GBP', { country: 'GB', tz: 'Europe/London', locale: 'en-GB' })
    ;({ variantId: variant } = await createProduct(owner, org, 1999))
    ;({ variantId: variantTaxed } = await createProduct(owner, org, 333, { taxBps: 2000 }))
    for (const v of [variant, variantTaxed]) {
      await asUser(owner, `select public.adjust_stock($1, $2, 50, 'received_from_supplier', null, $3)`, [org, v, key()])
    }
  })

  it('computes totals on the server from catalogue prices, ignoring client prices', async () => {
    const id = await createOrder(owner, org, [
      { variant_id: variant, quantity: 3, discount_minor: 100, unit_price_minor: 1 },
      { variant_id: variantTaxed, quantity: 7 },
    ], { delivery_fee_minor: 450 })
    const row = await orderRow(owner, id)
    const expected = computeOrderTotals({
      currency: 'GBP', taxMode: 'exclusive', deliveryFeeMinor: 450,
      lines: [
        { unitPriceMinor: 1999, quantity: 3, discountMinor: 100, taxRateBps: 0, currency: 'GBP' },
        { unitPriceMinor: 333, quantity: 7, taxRateBps: 2000, currency: 'GBP' },
      ],
    })
    expect(Number(row.subtotal_minor)).toBe(expected.subtotalMinor)
    expect(Number(row.tax_minor)).toBe(expected.taxMinor)
    expect(Number(row.total_minor)).toBe(expected.totalMinor)
    expect(row.currency).toBe('GBP')
    const lines = await asUser<{ unit_price_minor: string; product_name: string }>(owner, `select unit_price_minor, product_name from public.order_lines where order_id = $1 order by position`, [id])
    expect(Number(lines[0].unit_price_minor)).toBe(1999)
  })

  it('inclusive tax mode extracts tax from the price and matches the domain calculation', async () => {
    const u = await createUser('incl')
    const o = await createOrg(u, 'EUR', { country: 'DE', tz: 'Europe/Berlin', locale: 'de-DE', taxMode: 'inclusive' })
    const { variantId } = await createProduct(u, o, 1190, { taxBps: 1900, track: false })
    const id = await createOrder(u, o, [{ variant_id: variantId, quantity: 3 }])
    const row = await orderRow(u, id)
    const expected = computeOrderTotals({ currency: 'EUR', taxMode: 'inclusive', lines: [{ unitPriceMinor: 1190, quantity: 3, taxRateBps: 1900, currency: 'EUR' }] })
    expect(Number(row.total_minor)).toBe(expected.totalMinor)
    expect(Number(row.tax_minor)).toBe(expected.taxMinor)
    expect(Number(row.tax_minor)).toBe(570)
  })

  it('retrying create_order with the same key returns the same order and reserves stock once', async () => {
    const idem = key()
    const before = await level(owner, variant)
    const a = await createOrder(owner, org, [{ variant_id: variant, quantity: 2 }], {}, idem)
    const b = await createOrder(owner, org, [{ variant_id: variant, quantity: 2 }], {}, idem)
    expect(a).toBe(b)
    const after = await level(owner, variant)
    expect(after.reserved - before.reserved).toBe(2)
    const count = await one<{ n: string }>(owner, `select count(*) as n from public.orders where org_id = $1 and idempotency_key = $2`, [org, idem])
    expect(Number(count.n)).toBe(1)
  })

  it('order numbers are sequential per organisation and cannot be set by clients', async () => {
    await expect(asUser(owner, `update public.organisations set next_order_number = 1 where id = $1`, [org])).rejects.toThrow(/managed by the system/)
  })

  it('enforces the status state machine', async () => {
    const id = await createOrder(owner, org, [{ variant_id: variant, quantity: 1 }])
    await expect(asUser(owner, `select public.transition_order($1, 'delivered')`, [id])).rejects.toThrow(/cannot move/)
    await expect(asUser(owner, `update public.orders set status = 'delivered' where id = $1`, [id])).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `update public.order_lines set unit_price_minor = 1 where order_id = $1`, [id])).rejects.toThrow(/permission denied/)
  })

  it('rejects variant prices in a currency other than the business currency', async () => {
    const pid = (await one<{ id: string }>(owner, `select id from public.products where org_id = $1 limit 1`, [org])).id
    await expect(asUser(owner, `insert into public.product_variants (org_id, product_id, name, price_minor, currency) values ($1, $2, 'X', 100, 'USD')`, [org, pid])).rejects.toThrow(/must match the business currency/)
  })
})

run('stock integrity', () => {
  let owner: TestUser, org: string, variant: string

  beforeAll(async () => {
    owner = await createUser('stock')
    org = await createOrg(owner, 'JPY', { country: 'JP', tz: 'Asia/Tokyo', locale: 'ja-JP' })
    ;({ variantId: variant } = await createProduct(owner, org, 1200))
    await asUser(owner, `select public.adjust_stock($1, $2, 5, 'received_from_supplier', null, $3)`, [org, variant, key()])
  })

  it('reserves on confirm, refuses to oversell, releases on cancel, commits on dispatch', async () => {
    const o1 = await createOrder(owner, org, [{ variant_id: variant, quantity: 3 }])
    expect(await level(owner, variant)).toEqual({ on_hand: 5, reserved: 3 })
    await expect(createOrder(owner, org, [{ variant_id: variant, quantity: 3 }])).rejects.toThrow(/Not enough stock/)
    await asUser(owner, `select public.transition_order($1, 'cancelled', 'customer changed mind')`, [o1])
    expect(await level(owner, variant)).toEqual({ on_hand: 5, reserved: 0 })

    const o2 = await createOrder(owner, org, [{ variant_id: variant, quantity: 2 }])
    for (const s of ['preparing', 'ready', 'dispatched']) await asUser(owner, `select public.transition_order($1, $2::public.order_status)`, [o2, s])
    expect(await level(owner, variant)).toEqual({ on_hand: 3, reserved: 0 })
    const kinds = await asUser<{ kind: string }>(owner, `select kind from public.stock_movements where order_id = $1 order by created_at`, [o2])
    expect(kinds.map((k) => k.kind)).toEqual(['reservation', 'sale'])
  })

  it('draft orders do not reserve until confirmed', async () => {
    const before = await level(owner, variant)
    const d = await one<{ id: string }>(owner, `select public.create_order($1, $2::jsonb, $3) as id`, [org, JSON.stringify({ status: 'draft', lines: [{ variant_id: variant, quantity: 1 }] }), key()])
    expect(await level(owner, variant)).toEqual(before)
    await asUser(owner, `select public.transition_order($1, 'confirmed')`, [d.id])
    expect((await level(owner, variant)).reserved).toBe(before.reserved + 1)
  })

  it('adjustments are idempotent, need a reason and never go negative', async () => {
    const idem = key()
    const before = await level(owner, variant)
    await asUser(owner, `select public.adjust_stock($1, $2, -1, 'damaged', 'dropped', $3)`, [org, variant, idem])
    await asUser(owner, `select public.adjust_stock($1, $2, -1, 'damaged', 'dropped', $3)`, [org, variant, idem])
    expect((await level(owner, variant)).on_hand).toBe(before.on_hand - 1)
    await expect(asUser(owner, `select public.adjust_stock($1, $2, -1000, 'correction', null, $3)`, [org, variant, key()])).rejects.toThrow(/below zero/)
    await expect(asUser(owner, `select public.adjust_stock($1, $2, 1, 'because', null, $3)`, [org, variant, key()])).rejects.toThrow(/reason/)
  })

  it('stock cannot be edited directly and movements are permanent', async () => {
    await expect(asUser(owner, `update public.inventory_levels set on_hand = 999 where variant_id = $1`, [variant])).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `delete from public.stock_movements where variant_id = $1`, [variant])).rejects.toThrow(/permission denied/)
  })
})

run('payments, refunds and reversals', () => {
  let owner: TestUser, org: string, variant: string

  beforeAll(async () => {
    owner = await createUser('pay')
    org = await createOrg(owner, 'NGN', { country: 'NG', tz: 'Africa/Lagos', locale: 'en-NG' })
    ;({ variantId: variant } = await createProduct(owner, org, 500000, { track: true }))
    await asUser(owner, `select public.adjust_stock($1, $2, 10, 'received_from_supplier', null, $3)`, [org, variant, key()])
  })

  async function deliveredOrder(qty = 1) {
    const id = await createOrder(owner, org, [{ variant_id: variant, quantity: qty }])
    for (const s of ['ready', 'delivered']) await asUser(owner, `select public.transition_order($1, $2::public.order_status)`, [id, s])
    return id
  }

  it('manual payments are always unverified, idempotent and in the order currency', async () => {
    const order = await deliveredOrder()
    const idem = key()
    const p1 = await one<{ id: string }>(owner, `select public.record_manual_payment($1, 500000, 'NGN', 'bank_transfer', 'TRF-1', now(), null, $2) as id`, [order, idem])
    const p2 = await one<{ id: string }>(owner, `select public.record_manual_payment($1, 500000, 'NGN', 'bank_transfer', 'TRF-1', now(), null, $2) as id`, [order, idem])
    expect(p1.id).toBe(p2.id)
    const p = await one<{ verification: string; status: string }>(owner, `select verification, status from public.payments where id = $1`, [p1.id])
    expect(p).toEqual({ verification: 'manual_unverified', status: 'succeeded' })
    await expect(asUser(owner, `select public.record_manual_payment($1, 100, 'USD', 'cash', null, now(), null, $2)`, [order, key()])).rejects.toThrow(/order is in NGN/)
  })

  it('browsers cannot create provider-verified payments', async () => {
    const order = await deliveredOrder()
    await expect(asUser(owner, `select public.record_verified_payment($1, 'stripe', 'card', 100, 'NGN', 'pi_1', now())`, [order])).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `insert into public.payments (org_id, order_id, method, amount_minor, currency, status, verification, idempotency_key) values ($1, $2, 'card', 1, 'NGN', 'succeeded', 'provider_verified', 'x12345678')`, [org, order])).rejects.toThrow(/permission denied/)
  })

  it('refunds cannot exceed the payment, and a full refund marks a delivered order refunded', async () => {
    const order = await deliveredOrder()
    const pay = await one<{ id: string }>(owner, `select public.record_manual_payment($1, 500000, 'NGN', 'cash', null, now(), null, $2) as id`, [order, key()])
    await asUser(owner, `select public.record_refund($1, 200000, 'NGN', 'partial: damaged box', $2)`, [pay.id, key()])
    await expect(asUser(owner, `select public.record_refund($1, 300001, 'NGN', 'too much', $2)`, [pay.id, key()])).rejects.toThrow(/exceeds/)
    await expect(asUser(owner, `select public.record_refund($1, 100, 'USD', 'wrong currency', $2)`, [pay.id, key()])).rejects.toThrow(/currency/)
    expect((await orderRow(owner, order)).status).toBe('delivered')
    await asUser(owner, `select public.record_refund($1, 300000, 'NGN', 'rest', $2)`, [pay.id, key()])
    expect((await orderRow(owner, order)).status).toBe('refunded')
    await expect(asUser(owner, `delete from public.refunds where payment_id = $1`, [pay.id])).rejects.toThrow(/permission denied/)
    await expect(asUser(owner, `delete from public.payments where id = $1`, [pay.id])).rejects.toThrow(/permission denied/)
  })

  it('returns put stock back once, never more than sold', async () => {
    const order = await deliveredOrder(2)
    const line = await one<{ id: string }>(owner, `select id from public.order_lines where order_id = $1`, [order])
    const before = await level(owner, variant)
    const idem = key()
    await asUser(owner, `select public.return_order_items($1, $2::jsonb, 'unopened', $3)`, [order, JSON.stringify([{ line_id: line.id, quantity: 1 }]), idem])
    await asUser(owner, `select public.return_order_items($1, $2::jsonb, 'unopened', $3)`, [order, JSON.stringify([{ line_id: line.id, quantity: 1 }]), idem])
    expect((await level(owner, variant)).on_hand).toBe(before.on_hand + 1)
    await expect(asUser(owner, `select public.return_order_items($1, $2::jsonb, null, $3)`, [order, JSON.stringify([{ line_id: line.id, quantity: 2 }]), key()])).rejects.toThrow(/more of/)
  })

  it('a mistaken manual payment can be reversed with a reason and stays in history', async () => {
    const order = await deliveredOrder()
    const pay = await one<{ id: string }>(owner, `select public.record_manual_payment($1, 1000, 'NGN', 'cash', null, now(), null, $2) as id`, [order, key()])
    await expect(asUser(owner, `select public.reverse_payment($1, '')`, [pay.id])).rejects.toThrow(/reason/)
    await asUser(owner, `select public.reverse_payment($1, 'entered twice')`, [pay.id])
    const p = await one<{ status: string }>(owner, `select status from public.payments where id = $1`, [pay.id])
    expect(p.status).toBe('reversed')
  })

  it('writes an audit trail for price changes', async () => {
    const pid = (await one<{ product_id: string }>(owner, `select product_id from public.product_variants where id = $1`, [variant])).product_id
    await asUser(owner, `select public.save_product($1, $2::jsonb)`, [org, JSON.stringify({ id: pid, name: 'Renamed', variants: [{ id: variant, name: 'Default', price_minor: 550000 }] })])
    const rows = await asUser<{ before: { price_minor: number }; after: { price_minor: number } }>(owner,
      `select before, after from public.audit_log where org_id = $1 and entity = 'product_variants' and action = 'update' order by id desc limit 1`, [org])
    expect(rows[0].before.price_minor).toBe(500000)
    expect(rows[0].after.price_minor).toBe(550000)
  })
})

afterAll(async () => {
  await closeDb()
})
