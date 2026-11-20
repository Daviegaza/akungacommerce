/**
 * Seller trust rules (pure, no I/O).
 *
 * The database derives the same facts inside `_shop_trust` and
 * `storefront_trust` (supabase/migrations/20261120000040_trust_customers_payouts.sql);
 * the demo gateway calls these functions directly. Keep both in step.
 *
 * Core rule: a badge is shown only when the server says it was earned. The UI
 * never infers "verified" from what a merchant typed into their settings.
 */

/** Review state of the business documents a merchant uploaded. */
export const DOCUMENT_STATUSES = ['none', 'submitted', 'approved', 'rejected'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_KINDS = ['business_registration', 'business_permit', 'kra_pin', 'national_id'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  business_registration: 'Business registration certificate',
  business_permit: 'County business permit',
  kra_pin: 'KRA PIN certificate',
  national_id: 'Owner national ID',
}

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  none: 'Not submitted',
  submitted: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Not approved',
}

/** Why a buyer reports a shop. Mirrors the check constraint on shop_reports.reason. */
export const REPORT_REASONS = ['not_delivered', 'not_as_described', 'off_platform_payment', 'fake_shop', 'prohibited_items', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  not_delivered: 'I paid and never got my order',
  not_as_described: 'The item was not like the photos',
  off_platform_payment: 'They asked me to pay a different number',
  fake_shop: 'This shop looks fake or copies another business',
  prohibited_items: 'They sell something illegal or dangerous',
  other: 'Something else',
}

export const REPORT_STATUSES = ['open', 'reviewed', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

/** Below this, the exact completed-order count is not shown (same rule as sold counts). */
export const COMPLETED_ORDERS_MIN = 5

/**
 * Normalise a business name for comparison: case, accents, punctuation and
 * spacing are ignored; a leading "123456 - " shortcode prefix (as M-Pesa shows
 * it, e.g. "5123456 - MTO HOME") is dropped; common company suffixes are
 * unified so "Mto Home Ltd." equals "MTO HOME LIMITED".
 */
export function normaliseBusinessName(name: string | null | undefined): string {
  let t = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
  t = t.replace(/^\d{5,8}\s*-\s*/, '')
  t = t.replace(/&/g, ' AND ')
  t = t.replace(/[^A-Z0-9]+/g, ' ').trim()
  t = t.replace(/\b(LTD|LIMITED|CO|COMPANY|ENTERPRISES?|ENT)\b/g, (m) => (m.startsWith('L') ? 'LIMITED' : m.startsWith('E') ? 'ENTERPRISE' : 'COMPANY'))
  return t.replace(/\s+/g, ' ')
}

/** True when an M-Pesa-reported name and the merchant's registered name are the same business name. */
export function businessNamesMatch(reported: string | null | undefined, registered: string | null | undefined): boolean {
  const a = normaliseBusinessName(reported)
  const b = normaliseBusinessName(registered)
  return a.length >= 2 && a === b
}

/**
 * Partially mask an M-Pesa receipt code for display: first 3 and last 2
 * characters stay, e.g. "SJK4H7Q2P1" -> "SJK•••••P1". Matches the SQL masking.
 */
export function maskReceipt(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase()
  if (c.length <= 5) return '•'.repeat(c.length)
  return c.slice(0, 3) + '•'.repeat(c.length - 5) + c.slice(-2)
}

/** Facts the server returns about a published shop. */
export interface ShopTrustFacts {
  phoneVerified: boolean
  /** The M-Pesa business name, present only when it matched the registered name on a verified record. */
  mpesaName: string | null
  documentsApproved: boolean
  /** When the business joined Fungua (ISO). */
  onPlatformSince: string
  /** Delivered orders; null when fewer than COMPLETED_ORDERS_MIN. */
  completedOrders: number | null
}

export type TrustBadgeId = 'phone' | 'mpesa_name' | 'documents'

export interface TrustBadge {
  id: TrustBadgeId
  title: string
  explanation: string
}

/** Earned badges with plain-language explanations, strongest first. Nothing is shown that the server did not confirm. */
export function trustBadges(facts: ShopTrustFacts, shopName: string): TrustBadge[] {
  const out: TrustBadge[] = []
  if (facts.mpesaName) {
    out.push({
      id: 'mpesa_name',
      title: 'M-Pesa name checked',
      explanation: `Payments go to the M-Pesa business name ${facts.mpesaName}. Fungua matched it against a confirmed M-Pesa record.`,
    })
  }
  if (facts.documentsApproved) {
    out.push({
      id: 'documents',
      title: 'Business documents reviewed',
      explanation: `${shopName} sent business documents and a Fungua reviewer approved them.`,
    })
  }
  if (facts.phoneVerified) {
    out.push({
      id: 'phone',
      title: 'Phone number verified',
      explanation: `The WhatsApp number for ${shopName} received and confirmed a one-time code.`,
    })
  }
  return out
}

/** "On Fungua since March 2026" style label in the shop's locale. */
export function onPlatformSinceLabel(iso: string, locale = 'en', timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(d)
  }
}

export function completedOrdersLabel(count: number | null): string {
  if (count === null || count < COMPLETED_ORDERS_MIN) return `Fewer than ${COMPLETED_ORDERS_MIN} completed orders so far`
  return `${count.toLocaleString('en')} completed orders`
}

/** Delivered orders, hidden below the threshold. Mirrors storefront_trust. */
export function publicCompletedOrders(deliveredCount: number): number | null {
  return deliveredCount >= COMPLETED_ORDERS_MIN ? deliveredCount : null
}
