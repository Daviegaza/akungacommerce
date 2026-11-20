/**
 * Public storefront contract (shopper side) and merchant-side shop settings.
 * Mirrors supabase/migrations/20261120000007_storefront.sql. Two implementations:
 * Supabase (anon RPCs) and demo (localStorage, same rules).
 */
import type { ImageUploadOptions } from '@/media/upload'
import type { PromptStatus } from '@/domain/reconciliation'
import type { StorefrontTrustGateway } from './trust'

export interface DeliveryBand {
  maxKm: number
  feeMinor: number
}

export interface ShopSettings {
  slug: string
  published: boolean
  tagline: string | null
  about: string | null
  coverUrl: string | null
  logoUrl: string | null
  whatsappE164: string | null
  /** Name the buyer sees on the M-Pesa prompt / Till — main trust signal. */
  registeredName: string | null
  locationLat: number | null
  locationLng: number | null
  locationLabel: string | null
  pickupEnabled: boolean
  deliveryEnabled: boolean
  deliveryBands: DeliveryBand[]
  deliveryPromise: string | null
  codEnabled: boolean
  mpesaTill: string | null
  mpesaPaybill: string | null
  returnPolicy: string | null
}

export interface ProductImage {
  url: string
  alt?: string
}

export interface ProductMerchandising {
  images: ProductImage[]
  featured: boolean
  /** Honest scheduled drop: not purchasable before this ISO instant. */
  availableFrom: string | null
}

export interface VariantMerchandising {
  compareAtMinor: number | null
  swatch: string | null
}

/* ───────────── Shopper-facing shapes ───────────── */

export interface PublicShop extends Omit<ShopSettings, 'published'> {
  name: string
  currency: string
  locale: string
  timezone: string
  countryCode: string
  taxMode: 'exclusive' | 'inclusive'
  rating: { average: number; count: number } | null
}

export interface PublicVariant {
  id: string
  name: string
  priceMinor: number
  compareAtMinor: number | null
  currency: string
  swatch: string | null
  lowStockThreshold: number
  /** null = stock not tracked (always available). */
  available: number | null
}

export interface PublicProduct {
  id: string
  name: string
  description: string | null
  category: string | null
  images: ProductImage[]
  featured: boolean
  availableFrom: string | null
  trackStock: boolean
  taxRateBps: number
  createdAt: string
  /** Delivered units; null when fewer than 5 (never shown below that). */
  soldCount: number | null
  rating: { average: number; count: number } | null
  variants: PublicVariant[]
}

export interface StorefrontData {
  shop: PublicShop
  products: PublicProduct[]
}

export interface PublicReview {
  rating: number
  body: string | null
  author: string
  createdAt: string
}

export interface CartLineInput {
  variantId: string
  quantity: number
}

export interface QuoteInput {
  lines: CartLineInput[]
  method: 'pickup' | 'delivery'
  lat?: number
  lng?: number
}

export interface Quote {
  currency: string
  taxMode: 'exclusive' | 'inclusive'
  lines: { variantId: string; name: string; variant: string; quantity: number; unitPriceMinor: number; totalMinor: number }[]
  subtotalMinor: number
  taxMinor: number
  deliveryFeeMinor: number
  distanceKm: number | null
  totalMinor: number
}

export type PaymentChoice = 'mpesa' | 'cod' | 'card' | 'bank_transfer' | 'other'

export interface PlaceOrderInput extends QuoteInput {
  name: string
  phoneE164: string
  payment: PaymentChoice
  addressLine?: string
  landmark?: string
  building?: string
  instructions?: string
  note?: string
  marketingOptIn: boolean
  channel?: 'storefront' | 'whatsapp' | 'instagram' | 'facebook' | 'tiktok'
}

export interface PlacedOrder {
  orderId: string
  number: number
  trackingToken: string
  totalMinor: number
  currency: string
}

export interface TrackedOrder {
  number: number
  status: string
  createdAt: string
  currency: string
  subtotalMinor: number
  taxMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  paidMinor: number
  paymentPreference: PaymentChoice | null
  customerFirstName: string
  /** totalMinor is the pre-tax line amount (adds up to subtotalMinor). */
  lines: { productId: string | null; name: string; variant: string; quantity: number; unitPriceMinor: number; totalMinor: number }[]
  history: { status: string; at: string }[]
  fulfilment: {
    method: 'pickup' | 'delivery'
    rider: string | null
    trackingRef: string | null
    deliveredAt: string | null
    dropLat: number | null
    dropLng: number | null
    landmark: string | null
  }
  shop: {
    name: string
    slug: string | null
    whatsappE164: string | null
    locationLat: number | null
    locationLng: number | null
    locationLabel: string | null
    mpesaTill: string | null
    mpesaPaybill: string | null
    registeredName: string | null
    locale: string
    timezone: string
  }
  reviewedProductIds: string[]
}

/** Result of asking the payment adapter to push an M-Pesa prompt. Never "paid" here. */
export type StkResult =
  | { status: 'prompt_sent'; checkoutRequestId: string }
  | { status: 'not_configured' }
  | { status: 'failed'; error: string }

/** How the shop collects M-Pesa. `stk` = an automatic prompt can be attempted. */
export interface PaymentOptions {
  provider: 'manual' | 'daraja' | 'aggregator'
  stk: boolean
  /** Demo workspace: prompts are simulated, nothing is charged. */
  simulated: boolean
}

/** Demo-only outcome for a simulated STK prompt. Ignored by the real gateway. */
export type SimulatedOutcome = 'success' | 'cancelled' | 'timeout' | 'wrong_amount'

export interface PromptStatusResult {
  status: PromptStatus
  resultCode: number | null
}

export interface StorefrontGateway extends StorefrontTrustGateway {
  readonly mode: 'supabase' | 'demo'
  getStorefront(slug: string): Promise<StorefrontData>
  listReviews(slug: string, productId: string): Promise<PublicReview[]>
  quote(slug: string, input: QuoteInput): Promise<Quote>
  placeOrder(slug: string, input: PlaceOrderInput, idempotencyKey: string): Promise<PlacedOrder>
  track(token: string): Promise<TrackedOrder>
  submitReview(token: string, productId: string, rating: number, body: string | null): Promise<void>
  /** Ask the configured provider to send an STK push. Returns not_configured until Daraja is set up. */
  requestMpesaPrompt(trackingToken: string, phoneE164: string, opts?: { simulate?: SimulatedOutcome }): Promise<StkResult>
  /** Whether this shop can send automatic prompts. */
  getPaymentOptions(slug: string): Promise<PaymentOptions>
  /** Status of a prompt, as reported by verified provider callbacks only. */
  getMpesaPromptStatus(trackingToken: string, checkoutRequestId: string): Promise<PromptStatusResult>
}

/** Merchant-side additions (implemented on CommerceGateway). */
export interface ShopAdminGateway {
  getShopSettings(orgId: string): Promise<ShopSettings | null>
  saveShopSettings(orgId: string, settings: ShopSettings): Promise<void>
  setProductMerchandising(orgId: string, productId: string, m: ProductMerchandising): Promise<void>
  setVariantMerchandising(orgId: string, variantId: string, m: VariantMerchandising): Promise<void>
  /**
   * Store an already-compressed product photo and return the URL to put in the
   * product's images. Supabase: public 'product-images' bucket under "<org_id>/".
   * Demo: a data URL (persisted only when the product is saved).
   */
  uploadProductImage(orgId: string, image: Blob, opts?: ImageUploadOptions): Promise<string>
}

/** Pure helper mirrored by SQL delivery_fee_for + haversine_km (tested for parity). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a))
}

export function deliveryFeeFor(bands: DeliveryBand[], km: number): number | null {
  const band = [...bands].sort((a, b) => a.maxKm - b.maxKm).find((b) => b.maxKm >= km)
  return band ? band.feeMinor : null
}
