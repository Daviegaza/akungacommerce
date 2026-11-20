import { useMutation, useQuery } from '@tanstack/react-query'
import { BellOff, ReceiptText, ShieldCheck } from 'lucide-react'
import { formatDateTime } from '@/domain/locale'
import { getStorefrontGateway } from '@/storefront/gateway'
import { fmtMoney } from './storefront-utils'

interface TrackTrustProps {
  token: string
  /** Re-fetch receipts whenever the amount paid changes. */
  paidMinor: number
  shopName: string
  locale: string
  timezone: string
}

/**
 * Buyer proof on the tracking page: a receipt for each payment confirmed by
 * M-Pesa (never for payments staff typed in), and a way to stop offers.
 */
export function TrackTrust({ token, paidMinor, shopName, locale, timezone }: TrackTrustProps) {
  return (
    <>
      <PaymentReceipts token={token} paidMinor={paidMinor} locale={locale} timezone={timezone} />
      <MarketingOptOut token={token} shopName={shopName} />
    </>
  )
}

function PaymentReceipts({ token, paidMinor, locale, timezone }: Omit<TrackTrustProps, 'shopName'>) {
  const receipts = useQuery({
    queryKey: ['track-receipts', token, paidMinor],
    queryFn: async () => (await getStorefrontGateway()).getPaymentReceipts(token),
    enabled: paidMinor > 0,
    staleTime: 30_000,
  })
  const list = receipts.data ?? []
  if (list.length === 0) return null

  return (
    <section aria-labelledby="rafu-receipts" className="rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] sm:p-5 ak-rise">
      <h2 id="rafu-receipts" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
        <ReceiptText className="size-5 text-ink-2" aria-hidden />
        {list.length === 1 ? 'Payment receipt' : 'Payment receipts'}
      </h2>
      <p className="mt-1 text-xs text-ink-3">Confirmed by M-Pesa, not typed in by the shop.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {list.map((r, i) => (
          <li key={`${r.receiptMasked}-${i}`} className="rounded-xl border border-line p-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-3">Amount</dt>
              <dd className="text-right font-semibold text-ink tnum">{fmtMoney(r.amountMinor, r.currency, locale)}</dd>
              <dt className="text-ink-3">M-Pesa code</dt>
              <dd className="text-right font-medium text-ink tnum" aria-label={`M-Pesa code, partly hidden: ${r.receiptMasked.replace(/•+/g, ' hidden ')}`}>
                {r.receiptMasked}
              </dd>
              <dt className="text-ink-3">Paid</dt>
              <dd className="text-right text-ink">{formatDateTime(r.paidAt, locale, timezone)}</dd>
              {r.paidToName && (
                <>
                  <dt className="text-ink-3">Paid to</dt>
                  <dd className="text-right font-medium text-ink">
                    {r.paidToName}
                    {r.paidToVerified ? (
                      <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-normal text-pos">
                        <ShieldCheck className="size-3.5" aria-hidden /> Name from M-Pesa
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-xs font-normal text-ink-3">Name given by the shop</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Compare the code with the SMS M-Pesa sent you. Part of it is hidden here in case you share this page.</p>
    </section>
  )
}

function MarketingOptOut({ token, shopName }: { token: string; shopName: string }) {
  const optOut = useMutation({ mutationFn: async () => (await getStorefrontGateway()).optOutOfMarketing(token) })

  if (optOut.isSuccess) {
    return (
      <p role="status" className="flex items-start gap-2 px-1 text-sm text-ink-2">
        <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        Done. {shopName} will not send you offers. You will still get updates about your orders.
      </p>
    )
  }
  return (
    <div className="px-1">
      <button
        type="button"
        onClick={() => optOut.mutate()}
        disabled={optOut.isPending}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-ink-3 hover:text-ink disabled:opacity-60"
      >
        <BellOff className="size-4" aria-hidden />
        {optOut.isPending ? 'Saving…' : `Never send me offers from ${shopName}`}
      </button>
      {optOut.isError && (
        <p role="alert" className="text-sm text-neg">
          {optOut.error instanceof Error ? optOut.error.message : 'Could not save. Try again.'}
        </p>
      )}
    </div>
  )
}
