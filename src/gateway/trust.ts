/**
 * Seller verification, buyer-visible proof, customer portability and consent.
 * Mirrors supabase/migrations/20261120000040_trust_customers_payouts.sql.
 * Implemented by the Supabase gateway (trust-supabase.ts) and the demo gateway
 * (trust-demo.ts, simulated where a real provider would be needed, and labelled).
 */
import type { DocumentKind, DocumentStatus, ReportReason, ReportStatus, ShopTrustFacts } from '@/domain/trust'
import type { ConsentSource, SegmentId } from '@/domain/marketing'

export type { ShopTrustFacts }

/** What the server knows about one business's verification. Merchant side. */
export interface ShopVerification {
  phone: {
    verified: boolean
    /** The shop's WhatsApp number that verification applies to (from shop settings). */
    shopPhoneE164: string | null
  }
  mpesaName: {
    matched: boolean
    /** Name M-Pesa reported for the shop's Till/Paybill on a verified record, if any. */
    reportedName: string | null
    reportedAt: string | null
    registeredName: string | null
  }
  documents: {
    status: DocumentStatus
    kind: DocumentKind | null
    fileCount: number
    submittedAt: string | null
    reviewedAt: string | null
    rejectionReason: string | null
  }
  /** True only in the demo workspace (codes and M-Pesa checks are simulated). */
  simulated: boolean
}

export interface PhoneCodeRequest {
  /** Demo only: the code to type, since no SMS is sent. Always null in Supabase mode. */
  simulatedCode: string | null
}

export interface DocumentUpload {
  kind: DocumentKind
  files: File[]
}

/** One row of the customer CSV, computed on the server. */
export interface CustomerExportRow {
  id: string
  name: string
  phoneE164: string | null
  email: string | null
  orderCount: number
  spent: { currency: string; totalMinor: number }[]
  lastOrderAt: string | null
  marketingConsent: boolean
  consentUpdatedAt: string | null
  consentSource: ConsentSource | null
  createdAt: string
}

export type OptOutHow = Extract<ConsentSource, 'stop_reply' | 'staff'>

export interface MarketingContact {
  customerId: string
  segment: SegmentId
  contactedAt: string
}

/* ───────────── Platform review (Rafu staff only) ───────────── */

export interface VerificationQueueItem {
  orgId: string
  businessName: string
  slug: string | null
  kind: DocumentKind | null
  submittedAt: string | null
  /** Storage paths (Supabase) or file names (demo). */
  files: { name: string; path: string }[]
}

export interface ShopReportItem {
  id: string
  orgId: string
  businessName: string
  slug: string | null
  reason: ReportReason
  details: string | null
  status: ReportStatus
  createdAt: string
}

export interface TrustAdminGateway {
  getShopVerification(orgId: string): Promise<ShopVerification>
  /** Sends a one-time code to the shop's WhatsApp number (Supabase Auth SMS; simulated in the demo). */
  requestPhoneCode(orgId: string, phoneE164: string): Promise<PhoneCodeRequest>
  confirmPhoneCode(orgId: string, phoneE164: string, code: string): Promise<void>
  submitVerificationDocuments(orgId: string, upload: DocumentUpload): Promise<void>
  /** Demo workspace only: pretend a verified M-Pesa record reported this business name. */
  simulateMpesaNameReport?(orgId: string, name: string): Promise<void>

  /** Server-computed customer list for CSV export. Owner, admin and manager only; audited. */
  exportCustomers(orgId: string): Promise<CustomerExportRow[]>
  /** Withdraw a customer's marketing consent (e.g. they replied STOP). */
  optOutCustomer(orgId: string, customerId: string, how: OptOutHow): Promise<void>
  /**
   * Record that a marketing chat is being opened. Refused unless the customer
   * agreed to marketing and was not messaged in the cooldown window. Returns
   * the phone number to open the chat with.
   */
  startMarketingChat(orgId: string, customerId: string, segment: SegmentId): Promise<{ phoneE164: string }>
  listMarketingContacts(orgId: string): Promise<MarketingContact[]>

  /** Whether the signed-in user is a Rafu platform reviewer. */
  isPlatformAdmin(): Promise<boolean>
  listVerificationQueue(): Promise<VerificationQueueItem[]>
  /** A short-lived link to view one uploaded document (reviewers only). Null when files are not stored (demo). */
  verificationFileUrl(path: string): Promise<string | null>
  reviewVerificationDocuments(orgId: string, decision: 'approved' | 'rejected', reason: string | null): Promise<void>
  listShopReports(): Promise<ShopReportItem[]>
  resolveShopReport(reportId: string, status: Exclude<ReportStatus, 'open'>): Promise<void>
}

/* ───────────── Buyer side ───────────── */

export interface PaymentReceipt {
  amountMinor: number
  currency: string
  /** Partially masked by the server, e.g. "SJK•••••P1". */
  receiptMasked: string
  paidAt: string
  /** Name the money went to. */
  paidToName: string | null
  /** True when paidToName came from a verified M-Pesa record (not just what the shop typed). */
  paidToVerified: boolean
}

export interface ReportShopInput {
  reason: ReportReason
  details: string | null
}

export interface StorefrontTrustGateway {
  /** Server-derived trust facts for a published shop. */
  getShopTrust(slug: string): Promise<ShopTrustFacts>
  /** Anonymous, rate-limited. Stored for a Rafu reviewer, not shown to the shop. */
  reportShop(slug: string, input: ReportShopInput): Promise<void>
  /** Verified (provider-confirmed) payments on the order behind a tracking link. */
  getPaymentReceipts(trackingToken: string): Promise<PaymentReceipt[]>
  /** The buyer stops marketing messages from this shop. Order updates continue. */
  optOutOfMarketing(trackingToken: string): Promise<void>
}
