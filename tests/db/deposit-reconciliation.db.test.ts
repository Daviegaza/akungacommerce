import { randomInt } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { DB_URL, asUser, closeDb, createOrg, createProduct, createUser, db, one } from './helpers'
import { guestOrder, receiveStock, saveShop, sf, sfKey, uniqueSlug } from './storefront-helpers'
import { DEFAULT_SHOP_POLICY, type ShopPolicy } from '../../src/domain/delivery-policy'
import { policyPayload } from '../../src/gateway/delivery-supabase'

/**
 * Joins M-Pesa reconciliation (20261120000020) with deposits (20261120000030):
 * migration 20261120000031 lets a verified deposit payment confirm the order and
 * lets a direct Till payment of the deposit match automatically.
 */
const run = describe.skipIf(!DB_URL)

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
const receipt = () => 'T' + Array.from({ length: 9 }, () => ALPHA[randomInt(ALPHA.length)]).join('')

const DEPOSIT_POLICY: ShopPolicy = {
  ...DEFAULT_SHOP_POLICY,
  paymentMode: 'deposit',
  depositKind: 'percent',
  depositPercentBps: 3000,
  depositMinOrderMinor: 0,
  depositCoversDelivery: true,
}
// ~5 km north of the default shop location used by saveShop (same point as delivery.db.test.ts).
const NEAR = { lat: -1.2676 + 5 / ((2 * Math.PI * 6371.0088) / 360), lng: 36.8108 }

type Placed = { order_id: string; number: number; total_minor: number; deposit_due_minor: number }

async function depositShop() {
  const owner = await createUser('depmp')
  const org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
  const slug = uniqueSlug('dm')
  await saveShop(owner, org, { slug, cod: true })
  const { variantId } = await createProduct(owner, org, 150_000, { taxBps: 1600 })
  await receiveStock(owner, org, variantId, 50)
  await asUser(owner, `select public.save_shop_policy($1, $2::jsonb)`, [org, JSON.stringify(policyPayload(DEPOSIT_POLICY))])
  const till = String(randomInt(1_000_000, 9_999_999))
  await db().query(`update public.shop_settings set mpesa_till = $2 where org_id = $1`, [org, till])
  await db().query(
    `insert into public.integration_connections (org_id, provider, kind, state) values ($1, 'mpesa', 'payment', 'connected_verified')`,
    [org],
  )
  await asUser(owner, `select public.set_collections_provider($1, 'daraja', null)`, [org])
  return { owner, org, slug, till, variantId }
}

async function c2b(till: string, rcpt: string, amount: number, ref: string) {
  const { rows } = await db().query<{ r: Record<string, unknown> }>(
    `select public.reconcile_mpesa_c2b($1, $2, $3, $4, 'Jane ···149', now()) as r`,
    [till, rcpt, amount, ref],
  )
  return rows[0].r
}

afterAll(async () => {
  await closeDb()
})

run('deposit-aware M-Pesa reconciliation', () => {
  it('a Till payment of exactly the deposit is matched and confirms the order with a deposit note', async () => {
    const shop = await depositShop()
    const placed = await sf<Placed>('storefront_place_order', [
      shop.slug,
      guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }], method: 'delivery', ...NEAR }),
      sfKey(),
    ])
    const deposit = Number(placed.deposit_due_minor)
    expect(deposit).toBeGreaterThan(0)
    expect(deposit).toBeLessThan(Number(placed.total_minor))

    expect(await c2b(shop.till, receipt(), deposit, `#${placed.number}`)).toMatchObject({ outcome: 'recorded', confirmed: true })

    const o = await one<{ status: string }>(shop.owner, `select status from public.orders where id = $1`, [placed.order_id])
    expect(o.status).toBe('confirmed')
    const h = await one<{ note: string }>(
      shop.owner,
      `select note from public.order_status_history where order_id = $1 and to_status = 'confirmed'`,
      [placed.order_id],
    )
    expect(h.note).toMatch(/^Deposit paid by M-Pesa/)
  })

  it('an amount that is neither the deposit nor the balance is still queued', async () => {
    const shop = await depositShop()
    const placed = await sf<Placed>('storefront_place_order', [
      shop.slug,
      guestOrder({ lines: [{ variant_id: shop.variantId, quantity: 1 }], method: 'delivery', ...NEAR }),
      sfKey(),
    ])
    expect(await c2b(shop.till, receipt(), Number(placed.deposit_due_minor) + 100, `#${placed.number}`)).toMatchObject({
      outcome: 'unmatched',
    })
    const o = await one<{ status: string }>(shop.owner, `select status from public.orders where id = $1`, [placed.order_id])
    expect(o.status).toBe('pending_confirmation')
  })
})
