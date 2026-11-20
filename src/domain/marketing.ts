/**
 * Customer list portability and consent-based re-engagement (pure, no I/O).
 *
 * Kenya's Data Protection Act (and similar laws elsewhere) requires consent
 * for direct marketing and an easy way to opt out, even for small businesses.
 * Rules here:
 *  - Only customers who agreed (marketing_consent = true) can be picked for a
 *    marketing message. Everyone else may only get service messages about
 *    their own orders.
 *  - Every marketing message ends with "Reply STOP to opt out".
 *  - Messages open one at a time as WhatsApp click-to-chat links from the
 *    merchant's own phone. There is no bulk API sending.
 *  - At most one marketing message per customer per MARKETING_COOLDOWN_DAYS.
 *
 * The database enforces consent and the cooldown in `start_marketing_chat`
 * (supabase/migrations/20261120000040_trust_customers_payouts.sql); the demo
 * gateway calls the same functions.
 */
import type { Role } from './permissions'

export const CONSENT_SOURCES = ['checkout', 'staff', 'stop_reply', 'buyer_link', 'system'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

export const CONSENT_SOURCE_LABEL: Record<ConsentSource, string> = {
  checkout: 'Ticked the box at checkout',
  staff: 'Recorded by your team',
  stop_reply: 'Replied STOP',
  buyer_link: 'Opted out from their order link',
  system: 'Recorded automatically',
}

export const MARKETING_COOLDOWN_DAYS = 7
export const STOP_LINE = 'Reply STOP to opt out.'
const DAY_MS = 86_400_000

/**
 * Who may download the customer list. Mirrors `public._can_export_customers`.
 * Kept out of the general permission matrix on purpose: exporting every
 * customer's phone number is a bigger step than editing one customer.
 */
const EXPORT_ROLES: readonly Role[] = ['owner', 'admin', 'manager']
export function canExportCustomers(role: Role | null | undefined): boolean {
  return !!role && EXPORT_ROLES.includes(role)
}

export interface ConsentFields {
  marketingConsent: boolean
  phoneE164: string | null
}

const E164_RE = /^\+[1-9]\d{6,14}$/

/** May this customer be picked for a marketing message at all? */
export function canMarketTo(c: ConsentFields): boolean {
  return c.marketingConsent === true && !!c.phoneE164 && E164_RE.test(c.phoneE164)
}

/** Service messages (about the customer's own orders) never need marketing consent. */
export function canSendServiceMessage(c: Pick<ConsentFields, 'phoneE164'>): boolean {
  return !!c.phoneE164 && E164_RE.test(c.phoneE164)
}

/** Days until another marketing message is allowed (0 = allowed now). */
export function cooldownDaysLeft(lastContactedAt: string | null, nowMs: number): number {
  if (!lastContactedAt) return 0
  const since = nowMs - Date.parse(lastContactedAt)
  if (!Number.isFinite(since)) return 0
  const left = MARKETING_COOLDOWN_DAYS * DAY_MS - since
  return left > 0 ? Math.ceil(left / DAY_MS) : 0
}

/* ───────────── Customer statistics ───────────── */

export interface StatsCustomer extends ConsentFields {
  id: string
  name: string
  email: string | null
  consentUpdatedAt: string | null
  consentSource: ConsentSource | null
}

export interface StatsOrder {
  customerId: string | null
  status: string
  currency: string
  totalMinor: number
  createdAt: string
}

export interface CustomerStats {
  orderCount: number
  /** Spend per currency, largest first. Currencies are never added together. */
  spent: { currency: string; totalMinor: number }[]
  lastOrderAt: string | null
}

/** Orders that count towards history and spend (same rule as the customer pages). */
export function countsTowardsHistory(status: string): boolean {
  return status !== 'draft' && status !== 'cancelled'
}

export function customerStats(orders: readonly StatsOrder[]): Map<string, CustomerStats> {
  const acc = new Map<string, { count: number; spent: Map<string, number>; last: string | null }>()
  for (const o of orders) {
    if (!o.customerId || !countsTowardsHistory(o.status)) continue
    const a = acc.get(o.customerId) ?? { count: 0, spent: new Map<string, number>(), last: null }
    a.count += 1
    a.spent.set(o.currency, (a.spent.get(o.currency) ?? 0) + o.totalMinor)
    if (!a.last || o.createdAt > a.last) a.last = o.createdAt
    acc.set(o.customerId, a)
  }
  const out = new Map<string, CustomerStats>()
  for (const [id, a] of acc) {
    out.set(id, {
      orderCount: a.count,
      spent: [...a.spent].map(([currency, totalMinor]) => ({ currency, totalMinor })).sort((x, y) => y.totalMinor - x.totalMinor),
      lastOrderAt: a.last,
    })
  }
  return out
}

export const EMPTY_STATS: CustomerStats = { orderCount: 0, spent: [], lastOrderAt: null }

/* ───────────── Segments ───────────── */

export const SEGMENTS = ['recent', 'lapsed', 'top'] as const
export type SegmentId = (typeof SEGMENTS)[number]

export const SEGMENT_TEXT: Record<SegmentId, { label: string; rule: string }> = {
  recent: { label: 'Bought recently', rule: 'Ordered in the last 90 days' },
  lapsed: { label: 'Not back in a while', rule: 'Ordered before, but not in the last 60 days' },
  top: { label: 'Top spenders', rule: 'The 10 customers who spent the most in your main currency' },
}

export const RECENT_DAYS = 90
export const LAPSED_DAYS = 60
export const TOP_COUNT = 10

export interface SegmentMember<C extends StatsCustomer = StatsCustomer> {
  customer: C
  stats: CustomerStats
}

export interface SegmentResult<C extends StatsCustomer = StatsCustomer> {
  members: SegmentMember<C>[]
  /** Customers who fit the rule but did not agree to marketing (never selectable). */
  excludedNoConsent: number
}

function spentIn(stats: CustomerStats, currency: string): number {
  return stats.spent.find((x) => x.currency === currency)?.totalMinor ?? 0
}

/**
 * Customers in a segment. Only consenting customers with a valid phone are
 * returned; the rest are counted, never listed.
 */
export function segmentCustomers<C extends StatsCustomer>(
  segment: SegmentId,
  customers: readonly C[],
  stats: Map<string, CustomerStats>,
  opts: { nowMs: number; baseCurrency: string },
): SegmentResult<C> {
  const fits: SegmentMember<C>[] = []
  for (const c of customers) {
    const s = stats.get(c.id) ?? EMPTY_STATS
    if (s.orderCount === 0 || !s.lastOrderAt) continue
    const ageDays = (opts.nowMs - Date.parse(s.lastOrderAt)) / DAY_MS
    if (segment === 'recent' && ageDays <= RECENT_DAYS) fits.push({ customer: c, stats: s })
    else if (segment === 'lapsed' && ageDays > LAPSED_DAYS) fits.push({ customer: c, stats: s })
    else if (segment === 'top' && spentIn(s, opts.baseCurrency) > 0) fits.push({ customer: c, stats: s })
  }
  const ranked =
    segment === 'top'
      ? [...fits]
          .sort((a, b) => spentIn(b.stats, opts.baseCurrency) - spentIn(a.stats, opts.baseCurrency) || a.customer.name.localeCompare(b.customer.name))
          .slice(0, TOP_COUNT)
      : [...fits].sort((a, b) => (b.stats.lastOrderAt ?? '').localeCompare(a.stats.lastOrderAt ?? '') || a.customer.name.localeCompare(b.customer.name))
  const members = ranked.filter((m) => canMarketTo(m.customer))
  return { members, excludedNoConsent: ranked.length - members.length }
}

/* ───────────── Messages ───────────── */

export const DEFAULT_TEMPLATE = 'Hi {name}, thank you for buying from {shop}. We have new stock this week. Would you like to see it?'

/**
 * Fill a marketing template for one customer. {name} = first name, {shop} =
 * business name. The opt-out line is always appended (never optional) and is
 * not duplicated if the merchant typed it already.
 */
export function marketingMessage(template: string, customerName: string, shopName: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? ''
  const body = template.replace(/\{name\}/g, first || 'there').replace(/\{shop\}/g, shopName).trim()
  const hasStop = /reply\s+stop\b/i.test(body)
  return hasStop ? body : `${body}\n\n${STOP_LINE}`
}
