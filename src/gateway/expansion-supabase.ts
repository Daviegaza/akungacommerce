/**
 * Supabase implementation of the parity/expansion contract. Reads go through
 * RLS (members only); every write is a security-definer RPC from
 * supabase/migrations/20261120000050_parity_and_expansion.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ROLES, type Role } from '@/domain/permissions'
import { BANK_TRANSFER_PROVIDERS } from '@/domain/bank-transfer'
import { DOMAIN_STATUSES } from '@/domain/custom-domain'
import { INVITE_STATUSES } from '@/domain/team-invites'
import type { InvoiceLine, TaxInvoiceRecord } from '@/domain/etims'
import { GatewayError } from './gateway'
import type {
  CustomDomain,
  DomainCheckResult,
  ExpansionAdminGateway,
  ImportResult,
  InvitePreview,
  StorefrontExtras,
  StorefrontExtrasGateway,
  TeamInvite,
} from './expansion'

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? null : String(v))
const n = (v: unknown) => Number(v ?? 0)

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new GatewayError(res.error.message, res.error.code)
  return res.data as T
}

const role = (v: unknown): Role => ROLES.find((r) => r === v) ?? 'analyst'

export function mapInvite(r: Row): TeamInvite {
  return {
    id: String(r.id),
    email: s(r.email),
    phoneE164: s(r.phone_e164),
    role: role(r.role),
    status: INVITE_STATUSES.find((x) => x === r.status) ?? 'pending',
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    acceptedAt: s(r.accepted_at),
  }
}

export function mapDomain(r: Row): CustomDomain {
  return {
    hostname: String(r.hostname),
    status: DOMAIN_STATUSES.find((x) => x === r.status) ?? 'pending_dns',
    verificationToken: String(r.verification_token),
    failureReason: s(r.failure_reason),
    lastCheckedAt: s(r.last_checked_at),
    verifiedAt: s(r.verified_at),
    createdAt: String(r.created_at),
  }
}

const ROUTING = ['ok', 'missing', 'wrong', 'not_configured', 'unknown'] as const
const OWNERSHIP = ['ok', 'missing', 'wrong', 'unknown'] as const

export function mapDomainCheck(r: Row): DomainCheckResult {
  const status = r.status === 'error' ? 'error' : (DOMAIN_STATUSES.find((x) => x === r.status) ?? 'error')
  return {
    status,
    routing: ROUTING.find((x) => x === r.routing) ?? 'unknown',
    ownership: OWNERSHIP.find((x) => x === r.ownership) ?? 'unknown',
    reason: s(r.reason),
    checkedAt: typeof r.checkedAt === 'string' ? r.checkedAt : new Date().toISOString(),
    simulated: false,
  }
}

export function mapImportResult(r: Row): ImportResult {
  const errors = Array.isArray(r.errors) ? (r.errors as Row[]).map((e) => ({ line: n(e.line), message: String(e.message) })) : []
  return {
    ok: r.ok === true,
    dryRun: r.dry_run === true,
    createdProducts: n(r.created_products),
    createdVariants: n(r.created_variants),
    updatedVariants: n(r.updated_variants),
    skipped: n(r.skipped),
    errors,
  }
}

function mapInvoiceLine(r: Row): InvoiceLine {
  return {
    description: String(r.description),
    sku: s(r.sku),
    quantity: n(r.quantity),
    unitPriceMinor: n(r.unit_price_minor),
    discountMinor: n(r.discount_minor),
    taxRateBps: n(r.tax_rate_bps),
    netMinor: n(r.net_minor),
    taxMinor: n(r.tax_minor),
    grossMinor: n(r.gross_minor),
  }
}

export function mapInvoice(r: Row): TaxInvoiceRecord {
  const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as Row | null
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: order?.number != null ? n(order.number) : null,
    invoiceNumber: n(r.invoice_number),
    sellerName: String(r.seller_name),
    sellerPin: String(r.seller_pin),
    buyerPin: s(r.buyer_pin),
    buyerName: s(r.buyer_name),
    currency: String(r.currency),
    taxMode: r.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    lines: Array.isArray(r.lines) ? (r.lines as Row[]).map(mapInvoiceLine) : [],
    netMinor: n(r.net_minor),
    taxMinor: n(r.tax_minor),
    deliveryMinor: n(r.delivery_minor),
    totalMinor: n(r.total_minor),
    issuedAt: String(r.issued_at),
    kraStatus: 'not_submitted',
  }
}

export function createSupabaseExpansion(sb: SupabaseClient): ExpansionAdminGateway {
  const invoiceById = async (orgId: string, column: 'id' | 'order_id', value: string) => {
    const row = check(await sb.from('tax_invoices').select('*, orders(number)').eq('org_id', orgId).eq(column, value).maybeSingle()) as Row | null
    return row ? mapInvoice(row) : null
  }
  return {
    async importProducts(orgId, rows, opts) {
      const r = check(
        await sb.rpc('import_products', { p_org: orgId, p_rows: rows, p_on_duplicate: opts.onDuplicate, p_dry_run: opts.dryRun }),
      ) as Row
      return mapImportResult(r)
    },

    async getShopExtras(orgId) {
      const r = check(await sb.from('shop_extras').select('*').eq('org_id', orgId).maybeSingle()) as Row | null
      return {
        metaPixelId: s(r?.meta_pixel_id),
        ga4Id: s(r?.ga4_id),
        kraPin: s(r?.kra_pin),
        bankTransferProvider: BANK_TRANSFER_PROVIDERS.find((p) => p === r?.bank_transfer_provider) ?? 'none',
        nextInvoiceNumber: r ? n(r.next_invoice_number) : 1,
      }
    },
    async saveTrackingIds(orgId, ids) {
      check(await sb.rpc('save_shop_tracking', { p_org: orgId, p_meta_pixel_id: ids.metaPixelId, p_ga4_id: ids.ga4Id }))
    },
    async saveKraPin(orgId, pin) {
      check(await sb.rpc('save_kra_pin', { p_org: orgId, p_pin: pin }))
    },
    async setBankTransferProvider(orgId, provider) {
      check(await sb.rpc('set_bank_transfer_provider', { p_org: orgId, p_provider: provider }))
    },

    async getCustomDomain(orgId) {
      const r = check(await sb.from('custom_domains').select('*').eq('org_id', orgId).maybeSingle()) as Row | null
      return r ? mapDomain(r) : null
    },
    async setCustomDomain(orgId, hostname) {
      return mapDomain(check(await sb.rpc('set_custom_domain', { p_org: orgId, p_hostname: hostname })) as Row)
    },
    async removeCustomDomain(orgId) {
      check(await sb.rpc('remove_custom_domain', { p_org: orgId }))
    },
    async checkCustomDomain(orgId) {
      const { data, error } = await sb.functions.invoke('verify-custom-domain', { body: { org_id: orgId } })
      if (error) {
        // Non-2xx: the function answers { error } (429 = rate limited, 403 = not allowed, 503 = not deployed/configured).
        let message = 'The DNS check is not available right now.'
        let code: string | undefined
        const ctx = (error as { context?: unknown }).context
        if (ctx instanceof Response) {
          code = ctx.status === 429 ? 'rate_limited' : ctx.status === 403 ? 'forbidden' : ctx.status === 503 ? 'not_configured' : undefined
          try {
            const body = (await ctx.json()) as Row
            if (typeof body.error === 'string') message = body.error
          } catch {
            /* keep the generic message */
          }
        }
        throw new GatewayError(message, code)
      }
      return mapDomainCheck((data ?? {}) as Row)
    },

    async listInvites(orgId) {
      const rows = check(await sb.rpc('list_team_invites', { p_org: orgId })) as Row[] | null
      return (rows ?? []).map(mapInvite)
    },
    async createInvite(orgId, input) {
      const r = check(
        await sb.rpc('create_team_invite', { p_org: orgId, p_email: input.email, p_phone: input.phoneE164, p_role: input.role }),
      ) as Row
      return { invite: mapInvite(r.invite as Row), token: String(r.token) }
    },
    async revokeInvite(orgId, inviteId) {
      check(await sb.rpc('revoke_team_invite', { p_org: orgId, p_invite: inviteId }))
    },
    async previewInvite(token): Promise<InvitePreview> {
      const r = check(await sb.rpc('preview_team_invite', { p_token: token })) as Row
      return {
        orgName: String(r.org_name),
        role: role(r.role),
        status: INVITE_STATUSES.find((x) => x === r.status) ?? 'pending',
        expiresAt: String(r.expires_at),
        contactKind: r.contact_kind === 'phone' ? 'phone' : 'email',
        contactHint: String(r.contact_hint),
      }
    },
    async acceptInvite(token) {
      return String(check(await sb.rpc('accept_team_invite', { p_token: token })))
    },

    async issueTaxInvoice(orgId, orderId, buyer) {
      const id = String(check(await sb.rpc('issue_tax_invoice', { p_org: orgId, p_order: orderId, p_buyer_pin: buyer.pin, p_buyer_name: buyer.name })))
      const inv = await invoiceById(orgId, 'id', id)
      if (!inv) throw new GatewayError('Invoice not found', 'P0002')
      return inv
    },
    getTaxInvoice: (orgId, orderId) => invoiceById(orgId, 'order_id', orderId),
    async listTaxInvoices(orgId) {
      const rows = check(
        await sb.from('tax_invoices').select('*, orders(number)').eq('org_id', orgId).order('invoice_number', { ascending: false }).limit(2000),
      ) as Row[]
      return (rows ?? []).map(mapInvoice)
    },
  }
}

/** Uses the storefront's anon fetch-based RPC caller (storefront-supabase.ts). */
export type AnonRpc = <T = unknown>(fn: string, args: Row) => Promise<T>

export function createSupabaseStorefrontExtras(rpc: AnonRpc): StorefrontExtrasGateway {
  return {
    async getStorefrontExtras(slug): Promise<StorefrontExtras> {
      const r = (await rpc<Row>('storefront_extras', { p_slug: slug })) ?? {}
      return {
        metaPixelId: s(r.meta_pixel_id),
        ga4Id: s(r.ga4_id),
        bankTransfer: {
          available: r.bank_transfer === true,
          provider: BANK_TRANSFER_PROVIDERS.find((p) => p === r.bank_transfer_provider) ?? 'none',
          simulated: false,
        },
      }
    },
    async resolveShopHost(hostname) {
      const r = await rpc<unknown>('storefront_resolve_host', { p_hostname: hostname })
      return typeof r === 'string' && r ? r : null
    },
  }
}
