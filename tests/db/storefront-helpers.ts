import { randomInt, randomUUID } from 'node:crypto'
import { asUser, db, key, one, type TestUser } from './helpers'

/**
 * Storefront DB helpers. Anonymous calls run as the `anon` role with a random
 * x-forwarded-for header, because the storefront rate limiter keys on the client
 * IP and rate_limits rows persist between test runs.
 */
export function randomIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
}

export async function asAnon<T = Record<string, unknown>>(sql: string, params: unknown[] = [], ip = randomIp()): Promise<T[]> {
  const client = await db().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })])
    await client.query('set local role anon')
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

export async function anonOne<T = Record<string, unknown>>(sql: string, params: unknown[] = [], ip?: string): Promise<T> {
  return (await asAnon<T>(sql, params, ip))[0]
}

/** Call a storefront RPC as anon and return its jsonb result. */
export async function sf<T = Record<string, unknown>>(fn: string, args: unknown[], ip?: string): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  const row = await anonOne<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args, ip)
  return row.r
}

export const uniqueSlug = (label = 't') => `${label}-${randomUUID().slice(0, 8)}`

export interface ShopInput {
  slug: string
  published?: boolean
  lat?: number | null
  lng?: number | null
  bands?: { max_km: number; fee_minor: number }[]
  cod?: boolean
  pickup?: boolean
  delivery?: boolean
}

export async function saveShop(user: TestUser, org: string, s: ShopInput) {
  await asUser(user, `select public.save_shop_settings($1, $2::jsonb)`, [
    org,
    JSON.stringify({
      slug: s.slug,
      published: s.published ?? true,
      location_lat: s.lat === undefined ? -1.2676 : s.lat,
      location_lng: s.lng === undefined ? 36.8108 : s.lng,
      delivery_bands: s.bands ?? [
        { max_km: 3, fee_minor: 15000 },
        { max_km: 8, fee_minor: 30000 },
        { max_km: 15, fee_minor: 50000 },
      ],
      cod_enabled: s.cod ?? false,
      pickup_enabled: s.pickup ?? true,
      delivery_enabled: s.delivery ?? true,
      mpesa_till: '5123456',
      registered_name: 'TEST SHOP',
    }),
  ])
}

export async function receiveStock(user: TestUser, org: string, variantId: string, qty: number) {
  await asUser(user, `select public.adjust_stock($1, $2, $3, 'received_from_supplier', null, $4)`, [org, variantId, qty, key()])
}

/** Walk a storefront order (pending_confirmation) through to delivered, as staff. */
export async function deliverOrder(user: TestUser, orderId: string) {
  for (const to of ['confirmed', 'ready', 'delivered']) {
    await asUser(user, `select public.transition_order($1, $2::public.order_status)`, [orderId, to])
  }
}

export const sfKey = () => `sf-test-${randomUUID()}`

export interface GuestOrderInput {
  lines: { variant_id: string; quantity: number; unit_price_minor?: number }[]
  method?: 'pickup' | 'delivery'
  lat?: number
  lng?: number
  name?: string
  phone_e164?: string
  payment?: string
  marketing_opt_in?: boolean
}

export function guestOrder(input: GuestOrderInput) {
  return {
    method: 'pickup',
    name: 'Wairimu Test',
    phone_e164: `+2547${String(randomInt(10_000_000, 99_999_999))}`,
    payment: 'mpesa',
    marketing_opt_in: false,
    ...input,
  }
}

export async function orderStatus(user: TestUser, orderId: string) {
  return one<{ status: string; channel: string; customer_id: string; total_minor: string; delivery_fee_minor: string }>(
    user,
    `select status, channel, customer_id, total_minor, delivery_fee_minor from public.orders where id = $1`,
    [orderId],
  )
}
