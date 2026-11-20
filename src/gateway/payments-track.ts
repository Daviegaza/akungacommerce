/**
 * Mappers for the tracking page's payment additions (migrations 20261120000060/61):
 * storefront_track_payments (every succeeded payment) and storefront_bank_transfer
 * (dedicated account details for NGN bank-transfer orders).
 */
import type { TrackedBankTransfer, TrackedPaymentEvent } from './storefront'

type Row = Record<string, unknown>

export function mapTrackPayments(v: unknown): TrackedPaymentEvent[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((r): r is Row => Boolean(r) && typeof r === 'object')
    .map((r) => ({
      amountMinor: Number(r.amount_minor),
      currency: String(r.currency ?? ''),
      method: String(r.method ?? 'other'),
      verified: r.verified === true,
      receivedAt: String(r.received_at ?? ''),
    }))
    .filter((p) => Number.isFinite(p.amountMinor) && p.amountMinor > 0 && p.receivedAt !== '')
}

/** null = not an NGN bank-transfer order (nothing to show). */
export function mapTrackBankTransfer(v: unknown): TrackedBankTransfer | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  const a = r.account && typeof r.account === 'object' ? (r.account as Row) : null
  const accountNumber = a ? String(a.account_number ?? '') : ''
  return {
    provider: typeof r.provider === 'string' && r.provider !== 'none' ? r.provider : null,
    account:
      a && /^[0-9]{10}$/.test(accountNumber)
        ? { bankName: String(a.bank_name ?? ''), accountNumber, accountName: a.account_name == null ? null : String(a.account_name) }
        : null,
    dueNowMinor: Number(r.due_now_minor ?? 0) || 0,
    reference: Number(r.reference ?? 0) || 0,
    simulated: false,
  }
}
