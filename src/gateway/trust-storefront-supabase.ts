/**
 * Buyer-side trust RPCs (anon) from
 * supabase/migrations/20261120000040_trust_customers_payouts.sql. Takes the
 * storefront's plain-fetch rpc() so the public bundle stays free of supabase-js.
 */
import type { PaymentReceipt, StorefrontTrustGateway } from './trust'
import type { ShopTrustFacts } from '@/domain/trust'

type Row = Record<string, unknown>
type Rpc = <T = unknown>(fn: string, args: Row) => Promise<T>

export function mapShopTrust(r: Row | null): ShopTrustFacts {
  const x = r ?? {}
  return {
    phoneVerified: x.phone_verified === true,
    mpesaName: typeof x.mpesa_name === 'string' && x.mpesa_name ? x.mpesa_name : null,
    documentsApproved: x.documents_approved === true,
    onPlatformSince: String(x.on_rafu_since ?? ''),
    completedOrders: typeof x.completed_orders === 'number' ? x.completed_orders : null,
  }
}

export function mapReceipt(r: Row): PaymentReceipt {
  return {
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    receiptMasked: String(r.receipt_masked ?? ''),
    paidAt: String(r.paid_at),
    paidToName: typeof r.paid_to_name === 'string' ? r.paid_to_name : null,
    paidToVerified: r.paid_to_verified === true,
  }
}

export function createSupabaseStorefrontTrust(rpc: Rpc): StorefrontTrustGateway {
  return {
    async getShopTrust(slug) {
      return mapShopTrust(await rpc<Row>('storefront_trust', { p_slug: slug }))
    },
    async reportShop(slug, input) {
      await rpc('storefront_report_shop', { p_slug: slug, p_reason: input.reason, p_details: input.details })
    },
    async getPaymentReceipts(token) {
      const r = await rpc<Row[]>('storefront_payment_receipts', { p_token: token })
      return (Array.isArray(r) ? r : []).map(mapReceipt)
    },
    async optOutOfMarketing(token) {
      await rpc('storefront_marketing_opt_out', { p_token: token })
    },
  }
}
