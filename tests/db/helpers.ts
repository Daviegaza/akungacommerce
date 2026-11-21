import pg from 'pg'
import { randomUUID } from 'node:crypto'

/**
 * Database integration helpers. Tests connect as the postgres superuser only to
 * create auth users; every business call runs as the `authenticated` role with a
 * real JWT `sub` claim, so RLS and function permission checks apply exactly as
 * they do for browser requests through PostgREST.
 */
export const DB_URL = process.env.SUPABASE_DB_URL ?? ''

let pool: pg.Pool | null = null
export function db(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: DB_URL, max: 4 })
  return pool
}
export async function closeDb() {
  await pool?.end()
  pool = null
}

export interface TestUser {
  id: string
  email: string
}

export async function createUser(label: string): Promise<TestUser> {
  const id = randomUUID()
  const email = `${label}-${id.slice(0, 8)}@example.test`
  await db().query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, email],
  )
  return { id, email }
}

/** Run SQL as a signed-in user (role authenticated + jwt claims) inside one transaction. */
export async function asUser<T = Record<string, unknown>>(
  user: TestUser | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await db().connect()
  try {
    await client.query('begin')
    if (user) {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email }),
      ])
      await client.query('set local role authenticated')
    } else {
      await client.query('set local role anon')
    }
    const res = await client.query(sql, params)
    await client.query('commit')
    return res.rows as T[]
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

export async function one<T = Record<string, unknown>>(user: TestUser | null, sql: string, params: unknown[] = []) {
  const rows = await asUser<T>(user, sql, params)
  return rows[0]
}

export const key = () => `test-${randomUUID()}`

export async function createOrg(user: TestUser, currency = 'USD', opts: { country?: string; tz?: string; locale?: string; taxMode?: string } = {}) {
  const row = await one<{ id: string }>(
    user,
    `select public.create_organisation($1, $2, $3, $4, $5, 'retail', $6::public.tax_mode) as id`,
    [`Org ${user.email}`, opts.country ?? 'US', opts.tz ?? 'America/New_York', opts.locale ?? 'en-US', currency, opts.taxMode ?? 'exclusive'],
  )
  return row.id
}

export async function createProduct(user: TestUser, org: string, priceMinor: number, opts: { taxBps?: number; track?: boolean; cost?: number } = {}) {
  const productId = (
    await one<{ id: string }>(user, `select public.save_product($1, $2::jsonb) as id`, [
      org,
      JSON.stringify({
        name: `Product ${randomUUID().slice(0, 6)}`,
        tax_rate_bps: opts.taxBps ?? 0,
        track_stock: opts.track ?? true,
        variants: [{ name: 'Default', sku: `SKU-${randomUUID().slice(0, 8)}`, price_minor: priceMinor, ...(opts.cost != null ? { cost_minor: opts.cost } : {}) }],
      }),
    ])
  ).id
  const variant = await one<{ id: string }>(user, `select id from public.product_variants where product_id = $1`, [productId])
  return { productId, variantId: variant.id }
}

export async function addMember(owner: TestUser, org: string, member: TestUser, role: string) {
  await asUser(owner, `select public.add_member_by_email($1, $2, $3::public.member_role)`, [org, member.email, role])
}

export async function level(user: TestUser, variantId: string) {
  return one<{ on_hand: number; reserved: number }>(
    user,
    `select on_hand, reserved from public.inventory_levels where variant_id = $1`,
    [variantId],
  )
}
