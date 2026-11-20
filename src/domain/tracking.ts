/**
 * Marketing measurement IDs and storefront event mapping (pure, no I/O).
 *
 * Privacy rules:
 * - Nothing loads until the shopper actively accepts (no consent = no pixel).
 * - Only commerce facts are sent: product IDs, quantities, values, currency and
 *   the order number. Never names, phone numbers, addresses or tracking tokens.
 * - IDs are strictly validated (digits for Meta, G-XXXX for GA4) because they
 *   end up in a script URL / call; the database enforces the same patterns.
 */
import { money, toMajorString } from './money'

export const META_PIXEL_RE = /^[0-9]{8,20}$/
export const GA4_RE = /^G-[A-Z0-9]{4,15}$/

export type IdResult = { ok: true; value: string | null } | { ok: false; error: string }

/** Blank = not set. Spaces are ignored; anything other than digits is rejected. */
export function normaliseMetaPixelId(input: string | null | undefined): IdResult {
  const v = String(input ?? '').replace(/\s/g, '')
  if (!v) return { ok: true, value: null }
  return META_PIXEL_RE.test(v) ? { ok: true, value: v } : { ok: false, error: 'A Meta Pixel ID is 8 to 20 digits, numbers only' }
}

export function normaliseGa4Id(input: string | null | undefined): IdResult {
  const v = String(input ?? '').trim().toUpperCase()
  if (!v) return { ok: true, value: null }
  return GA4_RE.test(v) ? { ok: true, value: v } : { ok: false, error: 'A Google Analytics 4 ID looks like G-XXXXXXX' }
}

export type ConsentState = 'unknown' | 'granted' | 'denied'

/** One consent choice per shop and device. */
export const consentKey = (slug: string) => `rafu.consent.${slug}`

export function parseConsent(raw: string | null | undefined): ConsentState {
  return raw === 'granted' || raw === 'denied' ? raw : 'unknown'
}

/** Only ever true after an explicit "Allow". */
export function mayTrack(consent: ConsentState, ids: { metaPixelId: string | null; ga4Id: string | null }): boolean {
  return consent === 'granted' && Boolean(ids.metaPixelId || ids.ga4Id)
}

export type StorefrontEvent =
  | { type: 'page_view' }
  | { type: 'view_content'; productId: string; valueMinor: number; currency: string }
  | { type: 'add_to_cart'; productId: string; variantId: string; quantity: number; unitPriceMinor: number; currency: string }
  | { type: 'initiate_checkout'; productIds: string[]; numItems: number; valueMinor: number; currency: string }
  | { type: 'purchase'; orderNumber: number; productIds: string[]; numItems: number; valueMinor: number; currency: string }

function major(amountMinor: number, currency: string): number {
  return Number(toMajorString(money(amountMinor, currency)))
}

export interface MappedEvent {
  name: string
  params: Record<string, unknown>
  /** Meta deduplication id (purchase only). */
  eventId?: string
}

/** Meta standard events: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase. */
export function toMetaEvent(ev: StorefrontEvent): MappedEvent {
  switch (ev.type) {
    case 'page_view':
      return { name: 'PageView', params: {} }
    case 'view_content':
      return { name: 'ViewContent', params: { content_ids: [ev.productId], content_type: 'product', value: major(ev.valueMinor, ev.currency), currency: ev.currency } }
    case 'add_to_cart':
      return {
        name: 'AddToCart',
        params: {
          content_ids: [ev.productId],
          content_type: 'product',
          contents: [{ id: ev.productId, quantity: ev.quantity }],
          value: major(ev.unitPriceMinor * ev.quantity, ev.currency),
          currency: ev.currency,
        },
      }
    case 'initiate_checkout':
      return {
        name: 'InitiateCheckout',
        params: { content_ids: ev.productIds, content_type: 'product', num_items: ev.numItems, value: major(ev.valueMinor, ev.currency), currency: ev.currency },
      }
    case 'purchase':
      return {
        name: 'Purchase',
        params: { content_ids: ev.productIds, content_type: 'product', num_items: ev.numItems, value: major(ev.valueMinor, ev.currency), currency: ev.currency },
        eventId: `order-${ev.orderNumber}`,
      }
  }
}

/** GA4 recommended e-commerce events. */
export function toGa4Event(ev: StorefrontEvent): MappedEvent {
  switch (ev.type) {
    case 'page_view':
      return { name: 'page_view', params: {} }
    case 'view_content':
      return { name: 'view_item', params: { currency: ev.currency, value: major(ev.valueMinor, ev.currency), items: [{ item_id: ev.productId }] } }
    case 'add_to_cart':
      return {
        name: 'add_to_cart',
        params: {
          currency: ev.currency,
          value: major(ev.unitPriceMinor * ev.quantity, ev.currency),
          items: [{ item_id: ev.productId, item_variant: ev.variantId, quantity: ev.quantity, price: major(ev.unitPriceMinor, ev.currency) }],
        },
      }
    case 'initiate_checkout':
      return { name: 'begin_checkout', params: { currency: ev.currency, value: major(ev.valueMinor, ev.currency), items: ev.productIds.map((id) => ({ item_id: id })) } }
    case 'purchase':
      return {
        name: 'purchase',
        params: {
          transaction_id: String(ev.orderNumber),
          currency: ev.currency,
          value: major(ev.valueMinor, ev.currency),
          items: ev.productIds.map((id) => ({ item_id: id })),
        },
      }
  }
}

/** Script URLs. IDs are validated again here; an invalid ID yields null and nothing loads. */
export function metaPixelScriptUrl(id: string): string | null {
  return META_PIXEL_RE.test(id) ? 'https://connect.facebook.net/en_US/fbevents.js' : null
}

export function ga4ScriptUrl(id: string): string | null {
  return GA4_RE.test(id) ? `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}` : null
}
