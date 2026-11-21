/**
 * Demo storefront (shopper side). Reads and writes the same browser-local demo
 * state as the staff demo gateway, and enforces the rules of the storefront_*
 * functions in supabase/migrations/20261120000007_storefront.sql: published
 * shops only, server-side prices, stock and drop checks, distance-based delivery
 * fees, rate limits, idempotent guest orders, tracking links and verified
 * reviews. Nothing is ever charged in the demo.
 */
import { computeOrderTotals } from '@/domain/orders'
import { GatewayError } from './gateway'
import { demoInternals, randomToken, type DemoState, type StoredProduct, type StoredReview, type StoredShopSettings } from './demo'
import {
  deliveryFeeFor,
  haversineKm,
  type PaymentChoice,
  type PlaceOrderInput,
  type PlacedOrder,
  type PublicProduct,
  type PublicReview,
  type PublicShop,
  type Quote,
  type QuoteInput,
  type StorefrontData,
  type StorefrontGateway,
  type TrackedOrder,
} from './storefront'
import type { Address } from './types'
import { demoPaymentOptions, demoPromptStatus, demoRequestPrompt, demoTrackPayments, settleDemoPrompts } from './collections-demo'
import type { PickupPointSnapshot } from './delivery'
import {
  demoActivePickupPoints,
  demoCheckoutOptions,
  demoDepositFor,
  demoPolicyFor,
  demoRecordCheckout,
  demoRiderAccept,
  demoRiderAction,
  demoRiderJob,
  demoTrackedDelivery,
} from './delivery-demo'
import { createDemoStorefrontTrust, stampConsent } from './trust-demo'
import { createDemoStorefrontExtras } from './expansion-demo'

const { tx, read, uuid, now, nowIso, level, getOrg, createOrderCore } = demoInternals

function fail(message: string, code?: string): never {
  throw new GatewayError(message, code)
}

const PHONE_RE = /^\+[1-9][0-9]{6,14}$/
const PAYMENTS: readonly PaymentChoice[] = ['mpesa', 'cod', 'card', 'bank_transfer', 'other']
const CHANNELS = ['storefront', 'whatsapp', 'instagram', 'facebook', 'tiktok'] as const
const HOUR = 3_600_000

function shopBySlug(s: DemoState, slug: string): StoredShopSettings | undefined {
  const lower = String(slug ?? '').toLowerCase()
  return s.shopSettings.find((x) => x.slug === lower && x.published)
}

function requireShop(s: DemoState, slug: string): StoredShopSettings {
  return shopBySlug(s, slug) ?? fail('Shop not found', 'not_found')
}

function ratingOf(reviews: StoredReview[]): { average: number; count: number } | null {
  if (reviews.length === 0) return null
  const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
  return { average: Math.round(avg * 10) / 10, count: reviews.length }
}

/** Mirrors public._rate_limit: fixed window per key; a failed call rolls back with the transaction. */
function rateLimit(s: DemoState, key: string, max: number, windowMs: number): void {
  const t = now().getTime()
  const cur = s.rateLimits[key]
  if (!cur || new Date(cur.windowStart).getTime() < t - windowMs) {
    s.rateLimits[key] = { windowStart: new Date(t).toISOString(), hits: 1 }
  } else {
    cur.hits += 1
  }
  if (s.rateLimits[key].hits > max) fail('Too many attempts. Please wait a few minutes and try again.', 'rate_limited')
}

function publicShop(s: DemoState, shop: StoredShopSettings): PublicShop {
  const org = getOrg(s, shop.orgId)
  const { orgId: _o, updatedAt: _u, published: _p, ...settings } = shop
  void _o
  void _u
  void _p
  return {
    ...settings,
    deliveryBands: settings.deliveryBands.map((b) => ({ ...b })),
    name: org.name,
    currency: org.baseCurrency,
    locale: org.locale,
    timezone: org.timezone,
    countryCode: org.countryCode,
    taxMode: org.taxMode,
    rating: ratingOf(s.reviews.filter((r) => r.orgId === org.id)),
  }
}

/** Delivered units net of returns; hidden (null) below 5. */
function soldCount(s: DemoState, productId: string): number | null {
  const delivered = new Set(s.orders.filter((o) => o.status === 'delivered').map((o) => o.id))
  const variantIds = new Set(s.variants.filter((v) => v.productId === productId).map((v) => v.id))
  const total = s.lines
    .filter((l) => delivered.has(l.orderId) && l.variantId !== null && variantIds.has(l.variantId))
    .reduce((a, l) => a + l.quantity - l.returnedQuantity, 0)
  return total >= 5 ? total : null
}

function publicProduct(s: DemoState, p: StoredProduct): PublicProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    images: p.images.map((i) => ({ ...i })),
    featured: p.featured,
    availableFrom: p.availableFrom,
    trackStock: p.trackStock,
    taxRateBps: p.taxRateBps,
    createdAt: p.createdAt,
    soldCount: soldCount(s, p.id),
    rating: ratingOf(s.reviews.filter((r) => r.productId === p.id)),
    variants: s.variants
      .filter((v) => v.productId === p.id && v.isActive)
      .sort((a, b) => a.position - b.position)
      .map((v) => {
        const lv = level(s, v.id)
        return {
          id: v.id,
          name: v.name,
          priceMinor: v.priceMinor,
          compareAtMinor: v.compareAtMinor,
          currency: v.currency,
          swatch: v.swatch,
          lowStockThreshold: v.lowStockThreshold,
          available: p.trackStock ? lv.onHand - lv.reserved : null,
        }
      }),
  }
}

/** Mirrors storefront_quote. Prices always come from the catalogue. */
function quoteIn(s: DemoState, shop: StoredShopSettings, input: QuoteInput): Quote {
  const org = getOrg(s, shop.orgId)
  const lines = Array.isArray(input?.lines) ? input.lines : []
  if (lines.length === 0) fail('Your bag is empty', 'invalid')
  if (lines.length > 50) fail('Too many items in one order', 'invalid')

  const resolved = lines.map((l) => {
    const qty = l?.quantity
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) fail('Invalid quantity', 'invalid')
    const variant = s.variants.find((v) => v.id === l.variantId && v.orgId === org.id && v.isActive)
    const product = variant && s.products.find((p) => p.id === variant.productId && p.status === 'active')
    if (!variant || !product) fail('An item in your bag is no longer available', 'not_found')
    if (product.availableFrom && new Date(product.availableFrom).getTime() > now().getTime()) {
      fail(`${product.name} is not available yet`, 'invalid')
    }
    const lv = level(s, variant.id)
    const avail = lv.onHand - lv.reserved
    if (product.trackStock && avail < qty) fail(`Only ${Math.max(avail, 0)} of ${product.name} left`, 'stock')
    return { variant, product, qty }
  })

  const method = input.method ?? 'pickup'
  let km: number | null = null
  let fee = 0
  let pickupPoint: PickupPointSnapshot | null = null
  if (method === 'pickup_point') {
    // Delivered to one of the shop's pick-up points: the point's own fee, no pin needed.
    if (!shop.deliveryEnabled) fail('This shop does not deliver', 'invalid')
    const p = demoActivePickupPoints(s, org.id).find((x) => x.id === input.pickupPointId) ?? fail('Choose a pick-up point', 'invalid')
    pickupPoint = { id: p.id, name: p.name, area: p.area, hours: p.hours, feeMinor: p.feeMinor }
    fee = p.feeMinor
  } else if (method === 'delivery') {
    if (!shop.deliveryEnabled) fail('This shop does not deliver', 'invalid')
    if (typeof input.lat !== 'number' || typeof input.lng !== 'number' || !Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      fail('Drop a pin for your delivery address', 'invalid')
    }
    if (shop.locationLat !== null && shop.locationLng !== null) {
      km = haversineKm(shop.locationLat, shop.locationLng, input.lat, input.lng)
    }
    const feeFor = km === null ? null : deliveryFeeFor(shop.deliveryBands, km)
    if (feeFor === null) {
      fail(`Sorry, this address is outside the delivery area (${km === null ? '?' : km.toFixed(1)} km away)`, 'out_of_area')
    }
    fee = feeFor
  } else if (method === 'pickup') {
    if (!shop.pickupEnabled) fail('This shop does not offer pickup', 'invalid')
  } else {
    fail('Choose delivery or pickup', 'invalid')
  }

  const totals = computeOrderTotals({
    currency: org.baseCurrency,
    taxMode: org.taxMode,
    deliveryFeeMinor: fee,
    lines: resolved.map((r) => ({
      unitPriceMinor: r.variant.priceMinor,
      quantity: r.qty,
      taxRateBps: r.product.taxRateBps,
      discountMinor: 0,
      currency: r.variant.currency,
    })),
  })
  return {
    currency: org.baseCurrency,
    taxMode: org.taxMode,
    lines: resolved.map((r, i) => ({
      variantId: r.variant.id,
      name: r.product.name,
      variant: r.variant.name,
      quantity: r.qty,
      unitPriceMinor: r.variant.priceMinor,
      totalMinor: totals.lines[i].totalMinor,
    })),
    subtotalMinor: totals.subtotalMinor,
    taxMinor: totals.taxMinor,
    deliveryFeeMinor: fee,
    distanceKm: km === null ? null : Math.round(km * 10) / 10,
    totalMinor: totals.totalMinor,
    ...depositFields(s, org.id, totals.totalMinor, fee, org.baseCurrency),
    pickupPoint,
  }
}

/** Mirrors the deposit part of storefront_quote (public._deposit_due). */
function depositFields(s: DemoState, orgId: string, totalMinor: number, feeMinor: number, currency: string) {
  const policy = demoPolicyFor(s, orgId)
  const d = demoDepositFor(policy, totalMinor, feeMinor, currency)
  return { depositDueMinor: d.depositDueMinor, balanceOnDeliveryMinor: d.balanceOnDeliveryMinor, paymentMode: policy.paymentMode }
}

function placed(s: DemoState, order: DemoState['orders'][number]): PlacedOrder {
  return {
    orderId: order.id,
    number: order.number,
    trackingToken: order.trackingToken as string,
    totalMinor: order.totalMinor,
    currency: order.currency,
    depositDueMinor: demoTrackedDelivery(s, order).depositDueMinor,
  }
}

const clip = (v: string | undefined, max: number) => String(v ?? '').trim().slice(0, max)

/** Mirrors storefront_place_order. */
function placeOrderIn(s: DemoState, slug: string, input: PlaceOrderInput, idempotencyKey: string): PlacedOrder {
  const shop = requireShop(s, slug)
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16) fail('Missing idempotency key', 'invalid')
  const key = `sf:${idempotencyKey}`
  const existing = s.orders.find((o) => o.orgId === shop.orgId && o.idempotencyKey === key)
  if (existing) return placed(s, existing)

  const phone = String(input?.phoneE164 ?? '')
  const name = String(input?.name ?? '').trim()
  const payment = input?.payment ?? 'mpesa'
  if (!PHONE_RE.test(phone)) fail('Enter a valid phone number', 'invalid')
  if (name.length < 2 || name.length > 80) fail('Enter your name', 'invalid')
  if (!PAYMENTS.includes(payment)) fail('Choose a payment method', 'invalid')
  if (payment === 'cod' && !shop.codEnabled) fail('Cash on delivery is not available here', 'invalid')

  // Mirrors storefront_place_order (20261121000090): at most 3 open unpaid orders per phone per shop.
  const openUnpaid = s.orders.filter((o) => {
    if (o.orgId !== shop.orgId || o.status !== 'pending_confirmation' || !o.trackingToken) return false
    const c = s.customers.find((x) => x.id === o.customerId)
    if (c?.phoneE164 !== phone) return false
    return !s.payments.some((p) => p.orderId === o.id && p.status === 'succeeded')
  }).length
  if (openUnpaid >= 3) {
    fail('You already have 3 orders waiting for this shop. Pay for one, or wait for the shop to confirm it, before ordering again.', 'rate_limited')
  }

  rateLimit(s, `sf:phone:${shop.orgId}:${phone}`, 6, HOUR)
  rateLimit(s, `sf:shop:${shop.orgId}`, 500, HOUR)

  const quote = quoteIn(s, shop, input)
  if (input.expectedTotalMinor !== undefined && input.expectedTotalMinor !== quote.totalMinor) {
    fail(`The total changed to ${quote.totalMinor} while you were checking out. Review your order and try again.`, 'invalid')
  }
  const org = getOrg(s, shop.orgId)
  // Payment policy (mirrors storefront_place_order): the deposit is due now, so it needs a way to pay now.
  const policy = demoPolicyFor(s, org.id)
  const depositDue = quote.depositDueMinor ?? 0
  if (payment === 'cod' && policy.paymentMode === 'full_prepay') {
    fail('This shop needs full payment before delivery, so cash on delivery is not available', 'invalid')
  }
  if (payment === 'cod' && depositDue > 0 && !shop.mpesaTill && !shop.mpesaPaybill) {
    fail('This shop needs a deposit before delivery, so cash on delivery is not available', 'invalid')
  }
  const optIn = input.marketingOptIn === true

  // Guest customer, matched by phone (oldest first). Consent is only ever switched on, never off, here.
  let customer = s.customers
    .filter((c) => c.orgId === org.id && c.phoneE164 === phone)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!customer) {
    const ts = nowIso()
    customer = {
      id: uuid(),
      orgId: org.id,
      name,
      phoneE164: phone,
      email: null,
      countryCode: org.countryCode,
      marketingConsent: optIn,
      consentUpdatedAt: optIn ? ts : null,
      consentSource: optIn ? 'checkout' : null,
      tags: ['storefront'],
      notes: null,
      createdAt: ts,
      updatedAt: ts,
    }
    s.customers.push(customer)
  } else if (optIn) {
    // An anonymous checkout cannot undo an explicit opt-out (STOP, staff or the buyer link).
    const explicitOptOut = !customer.marketingConsent && ['stop_reply', 'staff', 'buyer_link'].includes(customer.consentSource ?? '')
    if (!explicitOptOut) stampConsent(customer, true, 'checkout', nowIso())
  }

  const method = input.method === 'pickup' ? 'pickup' : 'delivery'
  const channel = (CHANNELS as readonly string[]).includes(input.channel ?? '') ? (input.channel as (typeof CHANNELS)[number]) : 'storefront'
  const orderId = createOrderCore(
    s,
    org.id,
    {
      status: 'pending_confirmation',
      channel,
      customerId: customer.id,
      note: clip(input.note, 500) || null,
      deliveryFeeMinor: quote.deliveryFeeMinor,
      fulfilment: { method, recipientName: name, recipientPhone: phone, address: {} },
      lines: input.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, discountMinor: 0 })),
    },
    key,
  )
  const order = s.orders.find((o) => o.id === orderId) ?? fail('Order not found', 'not_found')

  if (input.method === 'pickup_point' && quote.pickupPoint) {
    const f = s.fulfilments.find((x) => x.orderId === orderId)
    const p = quote.pickupPoint
    if (f) {
      f.address = {
        line1: p.name,
        landmark: [p.name, p.area].filter(Boolean).join(', '),
        instructions: clip(input.instructions, 300),
        pickupPointId: p.id,
      } as Address
    }
  } else if (method === 'delivery') {
    const f = s.fulfilments.find((x) => x.orderId === orderId)
    if (f) {
      // Same keys as the SQL fulfilment address jsonb (lat/lng/landmark are read back by tracking).
      f.address = {
        line1: clip(input.addressLine, 160),
        instructions: clip(input.instructions, 300),
        lat: input.lat,
        lng: input.lng,
        landmark: clip(input.landmark, 160),
        building: clip(input.building, 120),
        distanceKm: quote.distanceKm,
      } as Address
    }
  }
  order.trackingToken = randomToken()
  order.paymentPreference = payment
  demoRecordCheckout(s, orderId, { depositDueMinor: depositDue, agreedPolicy: policy, pickupPoint: quote.pickupPoint ?? null })
  return placed(s, order)
}

function orderByToken(s: DemoState, token: string) {
  if (typeof token !== 'string' || token.length < 20) fail('Order not found', 'not_found')
  return s.orders.find((o) => o.trackingToken === token) ?? fail('Order not found', 'not_found')
}

/** Mirrors storefront_track: only what the link holder needs, no staff data. */
function trackIn(s: DemoState, token: string): TrackedOrder {
  const o = orderByToken(s, token)
  const org = getOrg(s, o.orgId)
  const shop = s.shopSettings.find((x) => x.orgId === o.orgId)
  const f = s.fulfilments.find((x) => x.orderId === o.id)
  const addr = (f?.address ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const paid = s.payments.filter((p) => p.orderId === o.id && p.status === 'succeeded').reduce((a, p) => a + p.amountMinor, 0)
  const refunded = s.refunds.filter((r) => r.orderId === o.id && r.status === 'succeeded').reduce((a, r) => a + r.amountMinor, 0)
  return {
    number: o.number,
    status: o.status,
    createdAt: o.createdAt,
    currency: o.currency,
    subtotalMinor: o.subtotalMinor,
    taxMinor: o.taxMinor,
    deliveryFeeMinor: o.deliveryFeeMinor,
    totalMinor: o.totalMinor,
    paidMinor: paid - refunded,
    paymentPreference: o.paymentPreference,
    customerFirstName: (o.customerName ?? '').split(' ')[0],
    lines: s.lines
      .filter((l) => l.orderId === o.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        productId: s.variants.find((v) => v.id === l.variantId)?.productId ?? null,
        name: l.productName,
        variant: l.variantName,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        totalMinor: l.subtotalMinor,
      })),
    history: s.history.filter((h) => h.orderId === o.id).map((h) => ({ status: h.toStatus, at: h.createdAt })),
    fulfilment: {
      method: f?.method ?? 'pickup',
      rider: f?.assignee ?? null,
      trackingRef: f?.trackingRef ?? null,
      deliveredAt: f?.deliveredAt ?? null,
      dropLat: num(addr.lat),
      dropLng: num(addr.lng),
      landmark: typeof addr.landmark === 'string' ? addr.landmark : null,
    },
    shop: {
      name: org.name,
      slug: shop?.slug ?? null,
      whatsappE164: shop?.whatsappE164 ?? null,
      locationLat: shop?.locationLat ?? null,
      locationLng: shop?.locationLng ?? null,
      locationLabel: shop?.locationLabel ?? null,
      mpesaTill: shop?.mpesaTill ?? null,
      mpesaPaybill: shop?.mpesaPaybill ?? null,
      registeredName: shop?.registeredName ?? null,
      locale: org.locale,
      timezone: org.timezone,
    },
    reviewedProductIds: s.reviews.filter((r) => r.orderId === o.id).map((r) => r.productId),
    delivery: demoTrackedDelivery(s, o),
    ...demoTrackPayments(s, o),
  }
}

/** Mirrors storefront_review: delivered orders only, once per product (repeats are ignored). */
function reviewIn(s: DemoState, token: string, productId: string, rating: number, body: string | null): void {
  const o = orderByToken(s, token)
  if (o.status !== 'delivered') fail('You can review once your order is delivered', 'invalid')
  const inOrder = s.lines.some((l) => l.orderId === o.id && s.variants.some((v) => v.id === l.variantId && v.productId === productId))
  if (!inOrder) fail('That product is not in this order', 'invalid')
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail('Rating must be 1 to 5', 'invalid')
  if (s.reviews.some((r) => r.orderId === o.id && r.productId === productId)) return
  s.reviews.push({
    id: uuid(),
    orgId: o.orgId,
    productId,
    orderId: o.id,
    rating,
    body: String(body ?? '').trim().slice(0, 1000) || null,
    authorDisplay: (o.customerName ?? '').split(' ')[0] || 'Customer',
    hidden: false,
    createdAt: nowIso(),
  })
}

export function createDemoStorefront(): StorefrontGateway {
  return {
    mode: 'demo',

    getStorefront: (slug) =>
      read((s): StorefrontData => {
        const shop = requireShop(s, slug)
        const products = s.products
          .filter((p) => p.orgId === shop.orgId && p.status === 'active' && s.variants.some((v) => v.productId === p.id && v.isActive))
          .map((p, i) => ({ p, i }))
          .sort((a, b) => Number(b.p.featured) - Number(a.p.featured) || b.p.createdAt.localeCompare(a.p.createdAt) || a.i - b.i)
          .map(({ p }) => publicProduct(s, p))
        return { shop: publicShop(s, shop), products }
      }),

    listReviews: (slug, productId) =>
      read((s): PublicReview[] => {
        const shop = shopBySlug(s, slug)
        if (!shop) return []
        return s.reviews
          .filter((r) => r.orgId === shop.orgId && r.productId === productId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => ({ rating: r.rating, body: r.hidden ? null : r.body, author: r.authorDisplay, createdAt: r.createdAt }))
      }),

    quote: (slug, input) => read((s) => quoteIn(s, requireShop(s, slug), input)),
    placeOrder: (slug, input, idempotencyKey) => tx((s) => placeOrderIn(s, slug, input, idempotencyKey)),
    track: (token) =>
      tx((s) => {
        settleDemoPrompts(demoInternals, s)
        return trackIn(s, token)
      }),
    submitReview: (token, productId, rating, body) => tx((s) => reviewIn(s, token, productId, rating, body)),

    // SIMULATED: the demo never contacts M-Pesa and nothing is charged (collections-demo.ts).
    requestMpesaPrompt: (token, phoneE164, opts) => tx((s) => demoRequestPrompt(demoInternals, s, orderByToken(s, token), phoneE164, opts?.simulate)),
    getPaymentOptions: (slug) => read((s) => demoPaymentOptions(s, requireShop(s, slug).orgId)),
    getMpesaPromptStatus: (token, checkoutRequestId) => tx((s) => demoPromptStatus(demoInternals, s, orderByToken(s, token), checkoutRequestId)),

    getCheckoutOptions: (slug) => read((s) => demoCheckoutOptions(s, requireShop(s, slug).orgId)),
    riderJob: (token) => read((s) => demoRiderJob(s, token)),
    riderAccept: (token, name) => tx((s) => demoRiderAccept(s, token, name)),
    riderAction: (token, action, reason) => tx((s) => demoRiderAction(s, token, action, reason)),
    ...createDemoStorefrontTrust(demoInternals),
    ...createDemoStorefrontExtras(demoInternals),
  }
}
