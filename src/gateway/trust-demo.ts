/**
 * Demo trust, verification and customer-consent rules on the browser-local demo
 * state. Mirrors supabase/migrations/20261120000040_trust_customers_payouts.sql.
 *
 * Simulated (and labelled so in the UI): the phone code is shown on screen
 * instead of being sent by SMS, the M-Pesa name check is typed in, document
 * files are not stored (only their names), and the demo user acts as the Rafu
 * reviewer. Every rule (who may export, consent, the 7-day cooldown, rate
 * limits, which badges are earned) is the same as on the server.
 */
import {
  canExportCustomers,
  customerStats,
  EMPTY_STATS,
  MARKETING_COOLDOWN_DAYS,
  SEGMENTS,
  type ConsentSource,
  type SegmentId,
} from '@/domain/marketing'
import {
  businessNamesMatch,
  DOCUMENT_KINDS,
  maskReceipt,
  publicCompletedOrders,
  REPORT_REASONS,
  type DocumentKind,
  type DocumentStatus,
  type ReportReason,
  type ReportStatus,
  type ShopTrustFacts,
} from '@/domain/trust'
import type { demoInternals as DemoInternalsValue, DemoState, StoredCustomer, StoredShopSettings } from './demo'
import type {
  CustomerExportRow,
  PaymentReceipt,
  ShopReportItem,
  ShopVerification,
  StorefrontTrustGateway,
  TrustAdminGateway,
  VerificationQueueItem,
} from './trust'

type Internals = typeof DemoInternalsValue

interface DemoOrgTrust {
  /** The phone a code was confirmed for (the badge holds only while it equals the shop's WhatsApp number). */
  verifiedPhone: string | null
  pendingCode: { phone: string; code: string; expiresAt: string } | null
  mpesaNames: { shortcode: string; name: string; observedAt: string }[]
  documents: {
    status: DocumentStatus
    kind: DocumentKind | null
    fileNames: string[]
    submittedAt: string | null
    reviewedAt: string | null
    rejectionReason: string | null
  }
}

interface StoredShopReport {
  id: string
  orgId: string
  reason: ReportReason
  details: string | null
  status: ReportStatus
  createdAt: string
}

interface StoredMarketingContact {
  orgId: string
  customerId: string
  segment: SegmentId
  contactedAt: string
}

/** Optional so older saved demo states stay valid. */
export interface DemoTrustState {
  trust?: Record<string, DemoOrgTrust>
  shopReports?: StoredShopReport[]
  marketingContacts?: StoredMarketingContact[]
}

const DAY = 86_400_000
const HOUR = 3_600_000
const E164_RE = /^\+[1-9]\d{6,14}$/
const DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_DOC_BYTES = 10 * 1024 * 1024

function trustOf(s: DemoState, orgId: string): DemoOrgTrust {
  s.trust ??= {}
  s.trust[orgId] ??= {
    verifiedPhone: null,
    pendingCode: null,
    mpesaNames: [],
    documents: { status: 'none', kind: null, fileNames: [], submittedAt: null, reviewedAt: null, rejectionReason: null },
  }
  return s.trust[orgId]
}

function shopOf(s: DemoState, orgId: string): StoredShopSettings | undefined {
  return s.shopSettings.find((x) => x.orgId === orgId)
}

/** Mirrors public._rate_limit. */
function rateLimit(I: Internals, s: DemoState, key: string, max: number, windowMs: number): void {
  const t = I.now().getTime()
  const cur = s.rateLimits[key]
  if (!cur || new Date(cur.windowStart).getTime() < t - windowMs) s.rateLimits[key] = { windowStart: new Date(t).toISOString(), hits: 1 }
  else cur.hits += 1
  if (s.rateLimits[key].hits > max) I.fail('Too many attempts. Please wait a few minutes and try again.', 'rate_limited')
}

/** Mirrors the customers_consent_stamp trigger: stamp only when consent really changes. */
export function stampConsent(c: StoredCustomer, consent: boolean, source: ConsentSource, at: string): void {
  if (c.marketingConsent === consent) return
  c.marketingConsent = consent
  c.consentUpdatedAt = at
  c.consentSource = source
  c.updatedAt = at
}

/** Mirrors public._shop_trust. */
function factsFor(I: Internals, s: DemoState, orgId: string) {
  const t = trustOf(s, orgId)
  const shop = shopOf(s, orgId)
  const shortcodes = [shop?.mpesaTill, shop?.mpesaPaybill].filter((x): x is string => !!x)
  const reported = t.mpesaNames.filter((n) => shortcodes.includes(n.shortcode)).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null
  const phoneVerified = !!shop?.whatsappE164 && t.verifiedPhone === shop.whatsappE164
  const delivered = s.orders.filter((o) => o.orgId === orgId && o.status === 'delivered').length
  return {
    phoneVerified,
    shopPhone: shop?.whatsappE164 ?? null,
    reported,
    registeredName: shop?.registeredName ?? null,
    nameMatched: !!reported && businessNamesMatch(reported.name, shop?.registeredName),
    documents: t.documents,
    onRafuSince: I.getOrg(s, orgId).createdAt,
    delivered,
  }
}

function orderByToken(I: Internals, s: DemoState, token: string) {
  if (typeof token !== 'string' || token.length < 20) I.fail('Order not found', 'not_found')
  return s.orders.find((o) => o.trackingToken === token) ?? I.fail('Order not found', 'not_found')
}

function publishedShop(I: Internals, s: DemoState, slug: string): StoredShopSettings {
  const lower = String(slug ?? '').toLowerCase()
  return s.shopSettings.find((x) => x.slug === lower && x.published) ?? I.fail('Shop not found', 'not_found')
}

function randomCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(100000 + (buf[0] % 900000))
}

export function createDemoTrust(I: Internals): Required<TrustAdminGateway> {
  return {
    getShopVerification: (orgId) =>
      I.read((s): ShopVerification => {
        I.requireMember(s, orgId)
        const f = factsFor(I, s, orgId)
        return {
          phone: { verified: f.phoneVerified, shopPhoneE164: f.shopPhone },
          mpesaName: { matched: f.nameMatched, reportedName: f.reported?.name ?? null, reportedAt: f.reported?.observedAt ?? null, registeredName: f.registeredName },
          documents: {
            status: f.documents.status,
            kind: f.documents.kind,
            fileCount: f.documents.fileNames.length,
            submittedAt: f.documents.submittedAt,
            reviewedAt: f.documents.reviewedAt,
            rejectionReason: f.documents.rejectionReason,
          },
          simulated: true,
        }
      }),

    requestPhoneCode: (orgId, phoneE164) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        if (!E164_RE.test(phoneE164)) I.fail('Enter the number in international format, e.g. +254712345678', 'invalid')
        rateLimit(I, s, `demo:phonecode:${orgId}`, 5, HOUR)
        const code = randomCode()
        trustOf(s, orgId).pendingCode = { phone: phoneE164, code, expiresAt: new Date(I.now().getTime() + 10 * 60_000).toISOString() }
        return { simulatedCode: code }
      }),
    confirmPhoneCode: (orgId, phoneE164, code) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        const t = trustOf(s, orgId)
        const p = t.pendingCode
        if (!p || p.phone !== phoneE164 || Date.parse(p.expiresAt) < I.now().getTime()) return I.fail('This code has expired. Ask for a new one.', 'phone_code_invalid')
        if (p.code !== code.trim()) I.fail('That code is not right. Check it and try again.', 'phone_code_invalid')
        t.verifiedPhone = phoneE164
        t.pendingCode = null
      }),

    submitVerificationDocuments: (orgId, upload) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        if (!DOCUMENT_KINDS.includes(upload.kind)) I.fail('Choose which document this is', 'invalid')
        if (upload.files.length === 0 || upload.files.length > 5) I.fail('Upload between 1 and 5 files', 'invalid')
        for (const f of upload.files) {
          if (!DOC_TYPES.has(f.type)) I.fail(`${f.name}: upload a PDF, JPG, PNG or WebP file`, 'invalid')
          if (f.size > MAX_DOC_BYTES) I.fail(`${f.name} is larger than 10 MB`, 'invalid')
        }
        const t = trustOf(s, orgId)
        t.documents = {
          status: 'submitted',
          kind: upload.kind,
          fileNames: upload.files.map((f) => f.name.slice(0, 120)),
          submittedAt: I.nowIso(),
          reviewedAt: null,
          rejectionReason: null,
        }
        I.writeAudit(s, orgId, 'shop_verifications', orgId, 'update', null, { documentsStatus: 'submitted', kind: upload.kind })
      }),

    // SIMULATED: on the server only service-role code records this, from a verified M-Pesa response.
    simulateMpesaNameReport: (orgId, name) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'integrations.manage')
        const shop = shopOf(s, orgId)
        const shortcode = shop?.mpesaTill ?? shop?.mpesaPaybill
        if (!shortcode) return I.fail('Add your Till or Paybill number in My shop first', 'invalid')
        const clean = name.replace(/^\d{5,8}\s*-\s*/, '').trim()
        if (clean.length < 2 || clean.length > 120) I.fail('Enter the name M-Pesa shows', 'invalid')
        const t = trustOf(s, orgId)
        t.mpesaNames = t.mpesaNames.filter((n) => n.shortcode !== shortcode)
        t.mpesaNames.push({ shortcode, name: clean, observedAt: I.nowIso() })
      }),

    exportCustomers: (orgId) =>
      I.tx((s): CustomerExportRow[] => {
        const role = I.requireMember(s, orgId)
        if (!canExportCustomers(role)) I.fail('Only owners, admins and managers can export the customer list', 'forbidden')
        const stats = customerStats(s.orders.filter((o) => o.orgId === orgId))
        const rows = s.customers
          .filter((c) => c.orgId === orgId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c): CustomerExportRow => {
            const st = stats.get(c.id) ?? EMPTY_STATS
            return {
              id: c.id,
              name: c.name,
              phoneE164: c.phoneE164,
              email: c.email,
              orderCount: st.orderCount,
              spent: st.spent,
              lastOrderAt: st.lastOrderAt,
              marketingConsent: c.marketingConsent,
              consentUpdatedAt: c.consentUpdatedAt ?? null,
              consentSource: c.consentSource ?? null,
              createdAt: c.createdAt,
            }
          })
        I.writeAudit(s, orgId, 'customers', 'export', 'export', null, { rows: rows.length })
        return rows
      }),

    optOutCustomer: (orgId, customerId, how) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'customers.write')
        if (how !== 'stop_reply' && how !== 'staff') I.fail('Say how the customer opted out', 'invalid')
        const c = s.customers.find((x) => x.id === customerId && x.orgId === orgId) ?? I.fail('Customer not found', 'not_found')
        stampConsent(c, false, how, I.nowIso())
      }),

    startMarketingChat: (orgId, customerId, segment) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'customers.write')
        if (!SEGMENTS.includes(segment)) I.fail('Unknown customer group', 'invalid')
        const c = s.customers.find((x) => x.id === customerId && x.orgId === orgId) ?? I.fail('Customer not found', 'not_found')
        if (!c.marketingConsent) I.fail('This customer has not agreed to offers. You can still message them about their own orders.', 'forbidden')
        if (!c.phoneE164) return I.fail('This customer has no phone number', 'invalid')
        s.marketingContacts ??= []
        const last = s.marketingContacts
          .filter((m) => m.orgId === orgId && m.customerId === customerId)
          .reduce<string | null>((acc, m) => (!acc || m.contactedAt > acc ? m.contactedAt : acc), null)
        if (last && I.now().getTime() - Date.parse(last) < MARKETING_COOLDOWN_DAYS * DAY) {
          I.fail('You sent this customer an offer in the last 7 days. Wait a week between offers.', 'rate_limited')
        }
        s.marketingContacts.push({ orgId, customerId, segment, contactedAt: I.nowIso() })
        return { phoneE164: c.phoneE164 }
      }),
    listMarketingContacts: (orgId) =>
      I.read((s) => {
        I.requireMember(s, orgId)
        const since = I.now().getTime() - 30 * DAY
        return (s.marketingContacts ?? [])
          .filter((m) => m.orgId === orgId && Date.parse(m.contactedAt) >= since)
          .sort((a, b) => b.contactedAt.localeCompare(a.contactedAt))
          .map(({ customerId, segment, contactedAt }) => ({ customerId, segment, contactedAt }))
      }),

    // SIMULATED: in the demo the signed-in user acts as the Rafu reviewer, so the review flow can be tried.
    isPlatformAdmin: () => I.read((s) => s.signedIn),
    listVerificationQueue: () =>
      I.read((s) => {
        if (!s.signedIn) I.fail('Not signed in', 'auth')
        return Object.entries(s.trust ?? {})
          .filter(([, t]) => t.documents.status === 'submitted')
          .map(
            ([orgId, t]): VerificationQueueItem => ({
              orgId,
              businessName: I.getOrg(s, orgId).name,
              slug: shopOf(s, orgId)?.slug ?? null,
              kind: t.documents.kind,
              submittedAt: t.documents.submittedAt,
              files: t.documents.fileNames.map((n) => ({ name: n, path: n })),
            }),
          )
      }),
    verificationFileUrl: () => Promise.resolve(null),
    reviewVerificationDocuments: (orgId, decision, reason) =>
      I.tx((s) => {
        if (!s.signedIn) I.fail('Not signed in', 'auth')
        if (decision !== 'approved' && decision !== 'rejected') I.fail('Approve or reject', 'invalid')
        const why = (reason ?? '').trim()
        if (decision === 'rejected' && !why) I.fail('Say why, so the business can fix it', 'invalid')
        const t = trustOf(s, orgId)
        if (t.documents.status !== 'submitted') I.fail('Nothing is waiting for review for this business', 'invalid')
        t.documents.status = decision
        t.documents.reviewedAt = I.nowIso()
        t.documents.rejectionReason = decision === 'rejected' ? why.slice(0, 500) : null
      }),
    listShopReports: () =>
      I.read((s) => {
        if (!s.signedIn) I.fail('Not signed in', 'auth')
        return (s.shopReports ?? [])
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(
            (r): ShopReportItem => ({
              id: r.id,
              orgId: r.orgId,
              businessName: s.orgs.find((o) => o.id === r.orgId)?.name ?? 'Unknown business',
              slug: shopOf(s, r.orgId)?.slug ?? null,
              reason: r.reason,
              details: r.details,
              status: r.status,
              createdAt: r.createdAt,
            }),
          )
      }),
    resolveShopReport: (reportId, status) =>
      I.tx((s) => {
        if (!s.signedIn) I.fail('Not signed in', 'auth')
        if (status !== 'reviewed' && status !== 'dismissed') I.fail('Mark it reviewed or dismissed', 'invalid')
        const r = (s.shopReports ?? []).find((x) => x.id === reportId && x.status === 'open') ?? I.fail('Report not found or already handled', 'not_found')
        r.status = status
      }),
  }
}

/** Buyer side (anonymous) in the demo storefront. */
export function createDemoStorefrontTrust(I: Internals): StorefrontTrustGateway {
  return {
    getShopTrust: (slug) =>
      I.read((s): ShopTrustFacts => {
        const shop = publishedShop(I, s, slug)
        const f = factsFor(I, s, shop.orgId)
        return {
          phoneVerified: f.phoneVerified,
          mpesaName: f.nameMatched ? (f.reported?.name ?? null) : null,
          documentsApproved: f.documents.status === 'approved',
          onRafuSince: f.onRafuSince,
          completedOrders: publicCompletedOrders(f.delivered),
        }
      }),

    reportShop: (slug, input) =>
      I.tx((s) => {
        const shop = publishedShop(I, s, slug)
        if (!REPORT_REASONS.includes(input.reason)) I.fail('Choose what went wrong', 'invalid')
        const details = (input.details ?? '').trim().slice(0, 1000) || null
        if (input.reason === 'other' && !details) I.fail('Tell us briefly what happened', 'invalid')
        // The demo has one "client", so the per-IP limits apply to this browser.
        rateLimit(I, s, 'sf:report:ip:demo', 5, HOUR)
        rateLimit(I, s, `sf:report:${shop.orgId}:demo`, 2, DAY)
        rateLimit(I, s, `sf:report:shop:${shop.orgId}`, 100, DAY)
        s.shopReports ??= []
        s.shopReports.push({ id: I.uuid(), orgId: shop.orgId, reason: input.reason, details, status: 'open', createdAt: I.nowIso() })
      }),

    getPaymentReceipts: (token) =>
      I.read((s): PaymentReceipt[] => {
        const o = orderByToken(I, s, token)
        const f = factsFor(I, s, o.orgId)
        const paidToName = f.reported?.name ?? f.registeredName
        return s.payments
          // M-Pesa only: the card says "Confirmed by M-Pesa" (mirrors storefront_payment_receipts, 20261120000061).
          .filter((p) => p.orderId === o.id && p.status === 'succeeded' && p.verification === 'provider_verified' && p.externalRef && p.method === 'mobile_money')
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          .slice(0, 5)
          .reverse()
          .map((p) => ({
            amountMinor: p.amountMinor,
            currency: p.currency,
            receiptMasked: maskReceipt(p.externalRef),
            paidAt: p.receivedAt,
            paidToName,
            paidToVerified: !!f.reported,
          }))
      }),

    optOutOfMarketing: (token) =>
      I.tx((s) => {
        if (typeof token !== 'string' || token.length < 20) I.fail('Order not found', 'not_found')
        rateLimit(I, s, `sf:optout:${token}`, 10, HOUR)
        const o = orderByToken(I, s, token)
        const phone = s.customers.find((c) => c.id === o.customerId)?.phoneE164 ?? null
        const at = I.nowIso()
        for (const c of s.customers) {
          if (c.orgId !== o.orgId || !c.marketingConsent) continue
          if (c.id === o.customerId || (phone !== null && c.phoneE164 === phone)) stampConsent(c, false, 'buyer_link', at)
        }
      }),
  }
}
