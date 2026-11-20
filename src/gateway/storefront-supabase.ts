/**
 * Supabase storefront (shopper side). Calls only the anon-callable
 * security-definer RPCs from supabase/migrations/20261120000007_storefront.sql
 * over PostgREST, so no auth session or table access is involved. Uses plain
 * fetch to keep the public storefront bundle small.
 */
import { GatewayError } from './gateway'
import type {
  DeliveryBand,
  PaymentChoice,
  PlacedOrder,
  ProductImage,
  PublicProduct,
  PublicReview,
  PublicShop,
  Quote,
  QuoteInput,
  StkResult,
  StorefrontData,
  StorefrontGateway,
  TrackedOrder,
} from './storefront'
import type { PaymentMode } from '@/domain/delivery-policy'
import { mapCheckoutOptions, mapPickupSnapshot, mapRiderJob, mapTrackedDelivery } from './delivery-supabase'

type Row = Record<string, unknown>
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const s = (v: unknown) => (v == null ? null : String(v))
const n = (v: unknown) => Number(v ?? 0)
const nOrNull = (v: unknown) => (v == null ? null : Number(v))
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])

/** jsonb [{url, alt?}] -> ProductImage[]; drops anything malformed. */
export function mapImages(v: unknown): ProductImage[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((i): ProductImage[] => {
    if (!i || typeof i !== 'object' || typeof (i as Row).url !== 'string') return []
    const alt = (i as Row).alt
    return [typeof alt === 'string' && alt ? { url: String((i as Row).url), alt } : { url: String((i as Row).url) }]
  })
}

/** jsonb [{max_km, fee_minor}] -> DeliveryBand[] */
export function mapBands(v: unknown): DeliveryBand[] {
  if (!Array.isArray(v)) return []
  return v.map((b: Row) => ({ maxKm: Number(b.max_km), feeMinor: Number(b.fee_minor) }))
}

function rating(v: unknown): { average: number; count: number } | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  return { average: n(r.average), count: n(r.count) }
}

export function mapPublicShop(r: Row): PublicShop {
  return {
    slug: String(r.slug),
    name: String(r.name),
    tagline: s(r.tagline),
    about: s(r.about),
    coverUrl: s(r.cover_url),
    logoUrl: s(r.logo_url),
    whatsappE164: s(r.whatsapp_e164),
    registeredName: s(r.registered_name),
    locationLat: nOrNull(r.location_lat),
    locationLng: nOrNull(r.location_lng),
    locationLabel: s(r.location_label),
    pickupEnabled: Boolean(r.pickup_enabled),
    deliveryEnabled: Boolean(r.delivery_enabled),
    deliveryBands: mapBands(r.delivery_bands),
    deliveryPromise: s(r.delivery_promise),
    codEnabled: Boolean(r.cod_enabled),
    mpesaTill: s(r.mpesa_till),
    mpesaPaybill: s(r.mpesa_paybill),
    returnPolicy: s(r.return_policy),
    currency: String(r.currency),
    locale: String(r.locale),
    timezone: String(r.timezone),
    countryCode: String(r.country_code),
    taxMode: r.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    rating: rating(r.rating),
  }
}

export function mapPublicProduct(r: Row): PublicProduct {
  return {
    id: String(r.id),
    name: String(r.name),
    description: s(r.description),
    category: s(r.category),
    images: mapImages(r.images),
    featured: Boolean(r.featured),
    availableFrom: s(r.available_from),
    trackStock: Boolean(r.track_stock),
    taxRateBps: n(r.tax_rate_bps),
    createdAt: String(r.created_at),
    soldCount: nOrNull(r.sold_count),
    rating: rating(r.rating),
    variants: rows(r.variants).map((v) => ({
      id: String(v.id),
      name: String(v.name),
      priceMinor: n(v.price_minor),
      compareAtMinor: nOrNull(v.compare_at_minor),
      currency: String(v.currency),
      swatch: s(v.swatch),
      lowStockThreshold: n(v.low_stock_threshold),
      available: nOrNull(v.available),
    })),
  }
}

export function mapQuote(r: Row): Quote {
  return {
    currency: String(r.currency),
    taxMode: r.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    lines: rows(r.lines).map((l) => ({
      variantId: String(l.variant_id),
      name: String(l.name),
      variant: String(l.variant),
      quantity: n(l.quantity),
      unitPriceMinor: n(l.unit_price_minor),
      totalMinor: n(l.total_minor),
    })),
    subtotalMinor: n(r.subtotal_minor),
    taxMinor: n(r.tax_minor),
    deliveryFeeMinor: n(r.delivery_fee_minor),
    distanceKm: nOrNull(r.distance_km),
    totalMinor: n(r.total_minor),
    ...(r.deposit_due_minor !== undefined
      ? {
          depositDueMinor: n(r.deposit_due_minor),
          balanceOnDeliveryMinor: n(r.balance_on_delivery_minor),
          paymentMode: (s(r.payment_mode) ?? 'pay_on_delivery') as PaymentMode,
          pickupPoint: mapPickupSnapshot(r.pickup_point),
        }
      : {}),
  }
}

export function mapTrackedOrder(r: Row): TrackedOrder {
  const f = (r.fulfilment ?? {}) as Row
  const shop = (r.shop ?? {}) as Row
  return {
    number: n(r.number),
    status: String(r.status),
    createdAt: String(r.created_at),
    currency: String(r.currency),
    subtotalMinor: n(r.subtotal_minor),
    taxMinor: n(r.tax_minor),
    deliveryFeeMinor: n(r.delivery_fee_minor),
    totalMinor: n(r.total_minor),
    paidMinor: n(r.paid_minor),
    paymentPreference: (s(r.payment_preference) as PaymentChoice | null) ?? null,
    customerFirstName: String(r.customer_first_name ?? ''),
    lines: rows(r.lines).map((l) => ({
      productId: s(l.product_id),
      name: String(l.name),
      variant: String(l.variant),
      quantity: n(l.quantity),
      unitPriceMinor: n(l.unit_price_minor),
      totalMinor: n(l.total_minor),
    })),
    history: rows(r.history).map((h) => ({ status: String(h.status), at: String(h.at) })),
    fulfilment: {
      method: f.method === 'delivery' ? 'delivery' : 'pickup',
      rider: s(f.rider),
      trackingRef: s(f.tracking_ref),
      deliveredAt: s(f.delivered_at),
      dropLat: nOrNull(f.drop_lat),
      dropLng: nOrNull(f.drop_lng),
      landmark: s(f.landmark) || null,
    },
    shop: {
      name: String(shop.name ?? ''),
      slug: s(shop.slug),
      whatsappE164: s(shop.whatsapp_e164),
      locationLat: nOrNull(shop.location_lat),
      locationLng: nOrNull(shop.location_lng),
      locationLabel: s(shop.location_label),
      mpesaTill: s(shop.mpesa_till),
      mpesaPaybill: s(shop.mpesa_paybill),
      registeredName: s(shop.registered_name),
      locale: String(shop.locale ?? 'en'),
      timezone: String(shop.timezone ?? 'UTC'),
    },
    reviewedProductIds: Array.isArray(r.reviewed_product_ids) ? r.reviewed_product_ids.map(String) : [],
  }
}

function quotePayload(input: QuoteInput): Row {
  return {
    lines: input.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
    method: input.method,
    ...(input.lat !== undefined ? { lat: input.lat } : {}),
    ...(input.lng !== undefined ? { lng: input.lng } : {}),
    ...(input.pickupPointId !== undefined ? { pickup_point_id: input.pickupPointId } : {}),
  }
}

export function createSupabaseStorefront(url: string, anonKey: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)): StorefrontGateway {
  const base = url.replace(/\/+$/, '')
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }

  async function rpc<T = unknown>(fn: string, args: Row): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
    } catch {
      throw new GatewayError('Could not reach the shop. Check your connection and try again.', 'network')
    }
    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const err = (body ?? {}) as Row
      throw new GatewayError(typeof err.message === 'string' ? err.message : 'Something went wrong', s(err.code) ?? String(res.status))
    }
    return body as T
  }

  return {
    mode: 'supabase',

    async getStorefront(slug) {
      const r = await rpc<Row>('storefront_get', { p_slug: slug })
      const data: StorefrontData = { shop: mapPublicShop((r.shop ?? {}) as Row), products: rows(r.products).map(mapPublicProduct) }
      return data
    },
    async listReviews(slug, productId) {
      const r = await rpc('storefront_reviews', { p_slug: slug, p_product: productId })
      return rows(r).map(
        (x): PublicReview => ({ rating: n(x.rating), body: s(x.body), author: String(x.author), createdAt: String(x.created_at) }),
      )
    },
    async quote(slug, input) {
      return mapQuote(await rpc<Row>('storefront_quote', { p_slug: slug, p_input: quotePayload(input) }))
    },
    async placeOrder(slug, input, idempotencyKey) {
      const r = await rpc<Row>('storefront_place_order', {
        p_slug: slug,
        p_idempotency_key: idempotencyKey,
        p_input: {
          ...quotePayload(input),
          name: input.name,
          phone_e164: input.phoneE164,
          payment: input.payment,
          address_line: input.addressLine ?? '',
          landmark: input.landmark ?? '',
          building: input.building ?? '',
          instructions: input.instructions ?? '',
          note: input.note ?? '',
          marketing_opt_in: input.marketingOptIn === true,
          channel: input.channel ?? 'storefront',
        },
      })
      const placed: PlacedOrder = {
        orderId: String(r.order_id),
        number: n(r.number),
        trackingToken: String(r.tracking_token),
        totalMinor: n(r.total_minor),
        currency: String(r.currency),
        ...(r.deposit_due_minor !== undefined ? { depositDueMinor: n(r.deposit_due_minor) } : {}),
      }
      return placed
    },
    async track(token) {
      // Deposit/handoff details come from a separate RPC; a server without that migration still tracks.
      const [order, delivery] = await Promise.all([
        rpc<Row>('storefront_track', { p_token: token }),
        rpc<Row>('storefront_track_delivery', { p_token: token }).catch(() => null),
      ])
      const tracked = mapTrackedOrder(order)
      return delivery ? { ...tracked, delivery: mapTrackedDelivery(delivery) } : tracked
    },
    async submitReview(token, productId, ratingValue, body) {
      await rpc('storefront_review', { p_token: token, p_product: productId, p_rating: ratingValue, p_body: body })
    },

    /** Never reports "paid": at most that a prompt was sent. Missing function/config/network => not_configured. */
    async requestMpesaPrompt(trackingToken, phoneE164): Promise<StkResult> {
      let res: Response
      try {
        res = await fetchImpl(`${base}/functions/v1/mpesa-stk`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tracking_token: trackingToken, phone_e164: phoneE164 }),
        })
      } catch {
        return { status: 'not_configured' }
      }
      let body: Row
      try {
        body = ((await res.json()) ?? {}) as Row
      } catch {
        body = {}
      }
      if (res.status === 404 || res.status === 503 || body.status === 'not_configured') return { status: 'not_configured' }
      if (res.ok && body.status === 'prompt_sent' && typeof body.checkout_request_id === 'string') {
        return { status: 'prompt_sent', checkoutRequestId: body.checkout_request_id }
      }
      return { status: 'failed', error: typeof body.error === 'string' ? body.error : 'Could not send the M-Pesa prompt' }
    },

    async getCheckoutOptions(slug) {
      return mapCheckoutOptions(await rpc<Row>('storefront_checkout_options', { p_slug: slug }))
    },
    async riderJob(token) {
      return mapRiderJob(await rpc<Row>('rider_job', { p_token: token }))
    },
    async riderAccept(token, name) {
      return mapRiderJob(await rpc<Row>('rider_accept', { p_token: token, p_name: name }))
    },
    async riderAction(token, action, reason) {
      return mapRiderJob(await rpc<Row>('rider_update', { p_token: token, p_action: action, p_reason: reason ?? null }))
    },
  }
}
