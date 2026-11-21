/**
 * Supabase implementation of the merchant trust / customer contract.
 * Reads of verification and exports go through security-definer RPCs from
 * supabase/migrations/20261120000040_trust_customers_payouts.sql; uploads go to
 * the private 'verification-docs' bucket under "<org_id>/".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONSENT_SOURCES, SEGMENTS } from '@/domain/marketing'
import { DOCUMENT_KINDS, DOCUMENT_STATUSES, REPORT_REASONS, REPORT_STATUSES } from '@/domain/trust'
import { GatewayError } from './gateway'
import type { CustomerExportRow, ShopReportItem, ShopVerification, TrustAdminGateway, VerificationQueueItem } from './trust'

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? null : String(v))

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new GatewayError(res.error.message, res.error.code)
  return res.data as T
}

const pick = <T extends string>(list: readonly T[], v: unknown): T | null => list.find((x) => x === v) ?? null

export const VERIFICATION_BUCKET = 'verification-docs'
const ALLOWED_DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const MAX_DOC_BYTES = 10 * 1024 * 1024

export function mapVerification(r: Row | null): ShopVerification {
  const x = r ?? {}
  return {
    phone: { verified: x.phone_verified === true, shopPhoneE164: s(x.shop_phone) },
    mpesaName: {
      matched: x.name_matched === true,
      reportedName: s(x.reported_name),
      reportedAt: s(x.reported_at),
      registeredName: s(x.registered_name),
    },
    documents: {
      status: pick(DOCUMENT_STATUSES, x.documents_status) ?? 'none',
      kind: pick(DOCUMENT_KINDS, x.document_kind),
      fileCount: Number(x.document_count ?? 0),
      submittedAt: s(x.submitted_at),
      reviewedAt: s(x.reviewed_at),
      rejectionReason: s(x.rejection_reason),
    },
    simulated: false,
  }
}

export function mapExportRow(r: Row): CustomerExportRow {
  const spent = Array.isArray(r.spent) ? (r.spent as Row[]) : []
  return {
    id: String(r.id),
    name: String(r.name),
    phoneE164: s(r.phone_e164),
    email: s(r.email),
    orderCount: Number(r.order_count ?? 0),
    spent: spent.map((x) => ({ currency: String(x.currency), totalMinor: Number(x.total_minor) })),
    lastOrderAt: s(r.last_order_at),
    marketingConsent: r.marketing_consent === true,
    consentUpdatedAt: s(r.consent_updated_at),
    consentSource: pick(CONSENT_SOURCES, r.consent_source),
    createdAt: String(r.created_at),
  }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function createSupabaseTrust(sb: SupabaseClient): TrustAdminGateway {
  return {
    async getShopVerification(orgId) {
      return mapVerification(check(await sb.rpc('get_shop_verification', { p_org: orgId })) as Row | null)
    },

    // Supabase Auth phone change: sends an SMS code through the SMS provider configured for the project.
    async requestPhoneCode(_orgId, phoneE164) {
      const { error } = await sb.auth.updateUser({ phone: phoneE164 })
      if (error) {
        throw new GatewayError(
          /provider|sms|phone.*(disabled|not enabled)/i.test(error.message)
            ? 'Phone codes are not set up yet: an SMS provider must be configured in Supabase Auth.'
            : error.message,
          'phone_code_failed',
        )
      }
      return { simulatedCode: null }
    },
    async confirmPhoneCode(_orgId, phoneE164, code) {
      const { error } = await sb.auth.verifyOtp({ phone: phoneE164, token: code.trim(), type: 'phone_change' })
      if (error) throw new GatewayError(error.message, 'phone_code_invalid')
    },

    async submitVerificationDocuments(orgId, upload) {
      if (upload.files.length === 0 || upload.files.length > 5) throw new GatewayError('Upload between 1 and 5 files', 'invalid')
      const paths: string[] = []
      for (const f of upload.files) {
        const ext = ALLOWED_DOC_TYPES[f.type]
        if (!ext) throw new GatewayError(`${f.name}: upload a PDF, JPG, PNG or WebP file`, 'invalid')
        if (f.size > MAX_DOC_BYTES) throw new GatewayError(`${f.name} is larger than 10 MB`, 'invalid')
        const path = `${orgId}/${crypto.randomUUID()}.${ext}`
        const { error } = await sb.storage.from(VERIFICATION_BUCKET).upload(path, f, { contentType: f.type, upsert: false })
        if (error) throw new GatewayError(`Could not upload ${f.name}: ${error.message}`, 'upload_failed')
        paths.push(path)
      }
      check(await sb.rpc('submit_verification_documents', { p_org: orgId, p_kind: upload.kind, p_paths: paths }))
    },

    async exportCustomers(orgId) {
      const rows = check(await sb.rpc('export_customers', { p_org: orgId })) as Row[] | null
      return (rows ?? []).map(mapExportRow)
    },
    async optOutCustomer(orgId, customerId, how) {
      check(await sb.rpc('opt_out_customer', { p_org: orgId, p_customer: customerId, p_how: how }))
    },
    async startMarketingChat(orgId, customerId, segment) {
      const phone = check(await sb.rpc('start_marketing_chat', { p_org: orgId, p_customer: customerId, p_segment: segment }))
      return { phoneE164: String(phone) }
    },
    async listMarketingContacts(orgId) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const rows = check(
        await sb
          .from('marketing_contacts')
          .select('customer_id, segment, contacted_at')
          .eq('org_id', orgId)
          .gte('contacted_at', since)
          .order('contacted_at', { ascending: false }),
      ) as Row[]
      return rows.map((r) => ({ customerId: String(r.customer_id), segment: pick(SEGMENTS, r.segment) ?? 'recent', contactedAt: String(r.contacted_at) }))
    },

    async isPlatformAdmin() {
      const { data, error } = await sb.rpc('is_platform_admin')
      if (error) return false
      return data === true
    },
    async listVerificationQueue() {
      const rows = (check(await sb.rpc('admin_verification_queue')) as Row[] | null) ?? []
      return rows.map(
        (r): VerificationQueueItem => ({
          orgId: String(r.org_id),
          businessName: String(r.business_name),
          slug: s(r.slug),
          kind: pick(DOCUMENT_KINDS, r.kind),
          submittedAt: s(r.submitted_at),
          files: (Array.isArray(r.paths) ? (r.paths as string[]) : []).map((p) => ({ name: fileName(p), path: p })),
        }),
      )
    },
    async verificationFileUrl(path) {
      const { data, error } = await sb.storage.from(VERIFICATION_BUCKET).createSignedUrl(path, 300)
      if (error) throw new GatewayError(error.message, 'not_found')
      return data.signedUrl
    },
    async reviewVerificationDocuments(orgId, decision, reason) {
      check(await sb.rpc('review_verification_documents', { p_org: orgId, p_decision: decision, p_reason: reason }))
    },
    async listShopReports() {
      const rows = (check(await sb.rpc('admin_shop_reports', { p_status: null })) as Row[] | null) ?? []
      return rows.map(
        (r): ShopReportItem => ({
          id: String(r.id),
          orgId: String(r.org_id),
          businessName: String(r.business_name),
          slug: s(r.slug),
          reason: pick(REPORT_REASONS, r.reason) ?? 'other',
          details: s(r.details),
          status: pick(REPORT_STATUSES, r.status) ?? 'open',
          createdAt: String(r.created_at),
        }),
      )
    },
    async resolveShopReport(reportId, status) {
      check(await sb.rpc('resolve_shop_report', { p_report: reportId, p_status: status }))
    },
  }
}
