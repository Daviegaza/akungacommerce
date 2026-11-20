/**
 * Supabase implementation of the merchant M-Pesa reconciliation contract.
 * Reads go through RLS (members only); every write is a security-definer RPC
 * from supabase/migrations/20261120000020_mpesa_reconciliation.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { COLLECTIONS_PROVIDERS, PROMPT_STATUSES, RECEIPT_STATUSES, verdictFor, type ReceiptVerification } from '@/domain/reconciliation'
import { GatewayError } from './gateway'
import type { CollectionsAdminGateway, CollectionsSettings, MpesaCredentialsSummary, MpesaPrompt, MpesaReceipt, VirtualAccountRecord } from './collections'

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? null : String(v))
const nOrNull = (v: unknown) => (v == null ? null : Number(v))

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new GatewayError(res.error.message, res.error.code)
  return res.data as T
}

function orderNumberOf(v: unknown): number | null {
  const o = Array.isArray(v) ? v[0] : v
  return o && typeof o === 'object' && (o as Row).number != null ? Number((o as Row).number) : null
}

export function mapPrompt(r: Row): MpesaPrompt {
  return {
    checkoutRequestId: String(r.checkout_request_id),
    orderId: String(r.order_id),
    orderNumber: orderNumberOf(r.orders),
    provider: String(r.provider ?? 'mpesa'),
    amountMinor: Number(r.amount_minor),
    status: PROMPT_STATUSES.find((x) => x === r.status) ?? 'pending',
    resultCode: nOrNull(r.result_code),
    resultDesc: s(r.result_desc),
    receipt: s(r.receipt),
    phoneHint: s(r.phone_hint),
    createdAt: String(r.created_at),
    resolvedAt: s(r.resolved_at),
    simulated: false,
  }
}

export function mapReceipt(r: Row): MpesaReceipt {
  const source = r.source === 'c2b' || r.source === 'aggregator' || r.source === 'bank_transfer' ? r.source : 'stk'
  return {
    id: String(r.id),
    provider: String(r.provider),
    source,
    receipt: String(r.receipt),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    accountRef: s(r.account_ref),
    payerHint: s(r.payer_hint),
    transactedAt: String(r.transacted_at),
    status: RECEIPT_STATUSES.find((x) => x === r.status) ?? 'unmatched',
    reason: s(r.reason),
    orderId: s(r.order_id),
    orderNumber: orderNumberOf(r.orders),
    paymentId: s(r.payment_id),
    createdAt: String(r.created_at),
    resolvedAt: s(r.resolved_at),
    simulated: false,
  }
}

export function mapVirtualAccount(r: Row): VirtualAccountRecord {
  return {
    id: String(r.id),
    provider: r.provider === 'flutterwave_va' ? 'flutterwave_va' : 'paystack_dva',
    bankName: String(r.bank_name),
    accountNumber: String(r.account_number),
    accountName: s(r.account_name),
    orderId: s(r.order_id),
    orderNumber: orderNumberOf(r.orders),
    customerId: s(r.customer_id),
    status: r.status === 'retired' ? 'retired' : 'active',
    createdAt: String(r.created_at),
    simulated: false,
  }
}

export function mapMpesaCredentials(r: Row | null): MpesaCredentialsSummary {
  if (!r || r.configured !== true) return { configured: false }
  return {
    configured: true,
    environment: r.environment === 'production' ? 'production' : 'sandbox',
    shortcode: String(r.shortcode),
    transactionType: r.transaction_type === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    partyB: s(r.party_b),
    keyHint: String(r.key_hint ?? ''),
    updatedAt: String(r.updated_at),
  }
}

/** verify_mpesa_receipt jsonb -> verdict (shared rules in the domain module). */
export function mapVerification(code: string, r: Row | null): ReceiptVerification {
  const provider = COLLECTIONS_PROVIDERS.find((x) => x === r?.provider) ?? 'manual'
  if (!r || r.format_ok !== true) return verdictFor({ code: '', provider, found: null, manualOrderNumbers: [] })
  const manual = Array.isArray(r.manual_order_numbers) ? r.manual_order_numbers.map(Number).filter(Number.isFinite) : []
  const rec = r.receipt && typeof r.receipt === 'object' ? (r.receipt as Row) : null
  return verdictFor({
    code,
    provider,
    manualOrderNumbers: manual,
    found: rec
      ? {
          code: String(rec.code),
          status: RECEIPT_STATUSES.find((x) => x === rec.status) ?? 'unmatched',
          amountMinor: Number(rec.amount_minor),
          currency: String(rec.currency),
          transactedAt: String(rec.transacted_at),
          orderNumber: nOrNull(rec.order_number),
          payerHint: s(rec.payer_hint),
          source: rec.source === 'c2b' || rec.source === 'aggregator' || rec.source === 'bank_transfer' ? rec.source : 'stk',
        }
      : null,
  })
}

export function createSupabaseCollections(sb: SupabaseClient): CollectionsAdminGateway {
  return {
    async getCollectionsSettings(orgId): Promise<CollectionsSettings> {
      const row = check(
        await sb.from('shop_settings').select('collections_provider, collections_aggregator').eq('org_id', orgId).maybeSingle(),
      ) as Row | null
      const provider = COLLECTIONS_PROVIDERS.find((x) => x === row?.collections_provider) ?? 'manual'
      return { provider, aggregator: s(row?.collections_aggregator) }
    },
    async setCollectionsProvider(orgId, settings) {
      check(
        await sb.rpc('set_collections_provider', {
          p_org: orgId,
          p_provider: settings.provider,
          p_aggregator: settings.provider === 'aggregator' ? settings.aggregator : null,
        }),
      )
    },
    async getMpesaCredentials(orgId) {
      return mapMpesaCredentials(check(await sb.rpc('mpesa_credentials_summary', { p_org: orgId })) as Row | null)
    },
    async saveMpesaCredentials(orgId, input) {
      const r = check(
        await sb.rpc('set_mpesa_credentials', {
          p_org: orgId,
          p_environment: input.environment,
          p_shortcode: input.shortcode,
          p_transaction_type: input.transactionType,
          p_party_b: input.partyB,
          p_consumer_key: input.consumerKey,
          p_consumer_secret: input.consumerSecret,
          p_passkey: input.passkey,
        }),
      ) as Row | null
      return mapMpesaCredentials(r)
    },
    async clearMpesaCredentials(orgId) {
      check(await sb.rpc('clear_mpesa_credentials', { p_org: orgId }))
    },
    async markMpesaVerified(orgId) {
      check(await sb.rpc('mark_mpesa_verified', { p_org: orgId }))
    },
    async listMpesaPrompts(orgId) {
      const rows = check(
        await sb.from('mpesa_requests').select('*, orders(number)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
      ) as Row[]
      return (rows ?? []).map(mapPrompt)
    },
    async listMpesaReceipts(orgId) {
      const rows = check(
        await sb.from('mpesa_receipts').select('*, orders(number)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
      ) as Row[]
      return (rows ?? []).map(mapReceipt)
    },
    async attachMpesaReceipt(orgId, receiptId, orderId) {
      return String(check(await sb.rpc('attach_mpesa_receipt', { p_org: orgId, p_receipt_id: receiptId, p_order: orderId })))
    },
    async dismissMpesaReceipt(orgId, receiptId, reason) {
      check(await sb.rpc('dismiss_mpesa_receipt', { p_org: orgId, p_receipt_id: receiptId, p_reason: reason }))
    },
    async verifyMpesaReceipt(orgId, code) {
      const r = check(await sb.rpc('verify_mpesa_receipt', { p_org: orgId, p_code: code })) as Row | null
      return mapVerification(code, r)
    },
    async listVirtualAccounts(orgId) {
      const rows = check(
        await sb.from('virtual_accounts').select('*, orders(number)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
      ) as Row[]
      return (rows ?? []).map(mapVirtualAccount)
    },
    async assignVirtualAccount() {
      // adapter_only: assignment needs the provider's API (Paystack DVA), which is not implemented.
      // Nothing is called and nothing is stored; accounts appear only once a real adapter writes them.
      return {
        status: 'not_configured',
        reason: 'Dedicated accounts are not connected yet (adapter only). Share your bank details with the buyer directly for now.',
      }
    },
  }
}
