/**
 * Pure helpers for the shopper storefront. Every signal shown to shoppers is
 * computed here from gateway data only (see docs/DESIGN.md honesty rules).
 */
import { formatMoney, money } from '@/domain/money'
import type { PublicProduct, PublicShop, PublicVariant } from '@/gateway/storefront'
import type { CartLine } from '../cart'

export const DAY_MS = 86_400_000
export const NEW_WINDOW_MS = 14 * DAY_MS

export function fmtMoney(amountMinor: number, currency: string, locale?: string): string {
  try {
    return formatMoney(money(amountMinor, currency), locale || 'en')
  } catch {
    return `${currency} ${amountMinor}`
  }
}

export function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

/** null available = stock not tracked, which means always available. */
export function variantInStock(v: PublicVariant): boolean {
  return v.available === null || v.available > 0
}

export function isSoldOut(p: PublicProduct): boolean {
  return p.variants.length === 0 || p.variants.every((v) => v.available === 0)
}

export function dropTime(p: PublicProduct): number | null {
  if (!p.availableFrom) return null
  const t = Date.parse(p.availableFrom)
  return Number.isNaN(t) ? null : t
}

export function isUpcomingDrop(p: PublicProduct, now: number): boolean {
  const t = dropTime(p)
  return t !== null && t > now
}

export function isNew(p: PublicProduct, now: number): boolean {
  const t = Date.parse(p.createdAt)
  return !Number.isNaN(t) && now - t >= 0 && now - t <= NEW_WINDOW_MS
}

export function isPurchasable(p: PublicProduct, now: number): boolean {
  return !isUpcomingDrop(p, now) && !isSoldOut(p)
}

export function hasDeal(p: PublicProduct): boolean {
  return p.variants.some((v) => v.compareAtMinor !== null && v.compareAtMinor > v.priceMinor)
}

export function discountPercent(priceMinor: number, compareAtMinor: number | null): number | null {
  if (compareAtMinor === null || compareAtMinor <= priceMinor || compareAtMinor <= 0) return null
  const pct = Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100)
  return pct > 0 ? pct : null
}

/** The variant whose price a card shows: cheapest in-stock one, else cheapest overall. */
export function displayVariant(p: PublicProduct): PublicVariant | null {
  if (p.variants.length === 0) return null
  const pool = p.variants.some(variantInStock) ? p.variants.filter(variantInStock) : p.variants
  return pool.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a))
}

export function hasPriceRange(p: PublicProduct): boolean {
  return new Set(p.variants.map((v) => v.priceMinor)).size > 1
}

export function minPrice(p: PublicProduct): number {
  return p.variants.length ? Math.min(...p.variants.map((v) => v.priceMinor)) : Number.MAX_SAFE_INTEGER
}

export function swatches(p: PublicProduct): { id: string; color: string; name: string }[] {
  return p.variants.filter((v) => v.swatch).map((v) => ({ id: v.id, color: v.swatch as string, name: v.name }))
}

/** Lowest delivery fee across the merchant's distance bands, or null. */
export function lowestDeliveryFee(shop: PublicShop): number | null {
  if (!shop.deliveryEnabled || shop.deliveryBands.length === 0) return null
  return Math.min(...shop.deliveryBands.map((b) => b.feeMinor))
}

export function formatDropDate(iso: string, shop: Pick<PublicShop, 'locale' | 'timezone'>, withDay = true): string {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = withDay
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', hour: 'numeric', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(shop.locale || 'en', { ...opts, timeZone: shop.timezone || undefined }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en', opts).format(d)
  }
}

export function formatDate(iso: string, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/** "2d 4h", "3h 12m", "4m 05s" — from a real future timestamp. */
export function countdownText(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}

export function shopPath(slug: string): string {
  return `/s/${encodeURIComponent(slug)}`
}

export function productPath(slug: string, productId: string): string {
  return `${shopPath(slug)}/p/${encodeURIComponent(productId)}`
}

export function absoluteUrl(path: string): string {
  try {
    return new URL(path, window.location.origin).toString()
  } catch {
    return path
  }
}

export function cartLineFor(p: PublicProduct, v: PublicVariant): Omit<CartLine, 'quantity'> {
  return {
    variantId: v.id,
    productId: p.id,
    name: p.name,
    variantName: v.name,
    image: p.images[0]?.url ?? null,
    unitPriceMinor: v.priceMinor,
    currency: v.currency,
    maxQuantity: v.available,
  }
}

export function cartWhatsappText(shop: PublicShop, lines: CartLine[], subtotalMinor: number, currency: string, url: string): string {
  const rows = lines.map(
    (l) =>
      `• ${l.quantity} × ${l.name}${l.variantName && l.variantName !== 'Default' ? ` (${l.variantName})` : ''} — ${fmtMoney(
        l.unitPriceMinor * l.quantity,
        l.currency,
        shop.locale,
      )}`,
  )
  return [
    `Hi ${shop.name}, I'd like to order:`,
    ...rows,
    `Subtotal: ${fmtMoney(subtotalMinor, currency, shop.locale)} (before delivery)`,
    '',
    `From your shop: ${url}`,
  ].join('\n')
}

export function productWhatsappText(shop: PublicShop, p: PublicProduct, v: PublicVariant | null, qty: number, url: string): string {
  const variant = v && p.variants.length > 1 ? ` (${v.name})` : ''
  const price = v ? ` — ${fmtMoney(v.priceMinor, v.currency, shop.locale)}` : ''
  return [`Hi ${shop.name}, I'm interested in:`, `${qty} × ${p.name}${variant}${price}`, url].join('\n')
}

export type SortKey = 'featured' | 'newest' | 'price-asc' | 'price-desc'

export function sortProducts(products: PublicProduct[], sort: SortKey): PublicProduct[] {
  const list = products.map((p, i) => ({ p, i }))
  list.sort((a, b) => {
    switch (sort) {
      case 'newest':
        return Date.parse(b.p.createdAt) - Date.parse(a.p.createdAt)
      case 'price-asc':
        return minPrice(a.p) - minPrice(b.p)
      case 'price-desc':
        return minPrice(b.p) - minPrice(a.p)
      default:
        return Number(b.p.featured) - Number(a.p.featured) || a.i - b.i
    }
  })
  return list.map((x) => x.p)
}

export function categoriesOf(products: PublicProduct[]): { name: string; image: string | null; count: number }[] {
  const map = new Map<string, { name: string; image: string | null; count: number }>()
  for (const p of products) {
    if (!p.category) continue
    const c = map.get(p.category)
    if (c) {
      c.count += 1
      if (!c.image && p.images[0]) c.image = p.images[0].url
    } else map.set(p.category, { name: p.category, image: p.images[0]?.url ?? null, count: 1 })
  }
  return [...map.values()]
}

export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === 'not_found' || e.code === 'PGRST116') return true
  return typeof e.message === 'string' && /not found|not published|unpublished/i.test(e.message)
}
