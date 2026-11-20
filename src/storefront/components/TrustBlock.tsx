import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BadgeCheck, Banknote, CalendarDays, ChevronDown, Flag, MapPin, PackageCheck, RotateCcw, ShieldCheck, Smartphone, Truck } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { completedOrdersLabel, onRafuSinceLabel, REPORT_REASON_LABEL, REPORT_REASONS, trustBadges, type ReportReason } from '@/domain/trust'
import { isE164, whatsappChatLink } from '@/integrations/whatsapp-link'
import { getStorefrontGateway } from '@/storefront/gateway'
import { cn } from '@/lib/utils'
import { WhatsAppGlyph } from './WhatsAppGlyph'

function Row({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-sm text-ink-2">{children}</div>}
      </div>
    </li>
  )
}

function useShopTrust(slug: string) {
  return useQuery({
    queryKey: ['shop-trust', slug],
    queryFn: async () => (await getStorefrontGateway()).getShopTrust(slug),
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Seller trust signals. Badges come only from the server (storefront_trust);
 * settings the merchant typed in are shown as plain facts, never as "verified".
 */
export function TrustBlock({ shop, className, contextText }: { shop: PublicShop; className?: string; contextText?: string }) {
  const wa = shop.whatsappE164 && isE164(shop.whatsappE164) ? shop.whatsappE164 : null
  const trust = useShopTrust(shop.slug)
  const facts = trust.data ?? null
  const badges = facts ? trustBadges(facts, shop.name) : []
  const nameChecked = !!facts?.mpesaName

  return (
    <section aria-label="About this seller" className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:p-5', className)}>
      <h2 className="text-lg font-extrabold tracking-tight text-ink">Buying from {shop.name}</h2>

      {badges.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Checks this shop passed">
          {badges.map((b) => (
            <li key={b.id} className="flex gap-3 rounded-xl bg-pos-soft px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{b.title}</p>
                <p className="mt-0.5 text-sm text-ink-2">{b.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-1 divide-y divide-line">
        {facts && (
          <Row icon={<CalendarDays className="size-4" aria-hidden />} title={`On Rafu since ${onRafuSinceLabel(facts.onRafuSince, shop.locale, shop.timezone)}`}>
            <span className="inline-flex items-center gap-1.5">
              <PackageCheck className="size-3.5 text-ink-3" aria-hidden />
              {completedOrdersLabel(facts.completedOrders)}
            </span>
          </Row>
        )}
        {shop.registeredName && !nameChecked && (
          <Row icon={<Smartphone className="size-4" aria-hidden />} title={`M-Pesa should show: ${shop.registeredName}`}>
            This is the name the shop gave us. Check it on your M-Pesa prompt before you enter your PIN, and stop if it is different.
          </Row>
        )}
        {shop.registeredName && nameChecked && (
          <Row icon={<BadgeCheck className="size-4 text-pos" aria-hidden />} title={`M-Pesa shows: ${facts?.mpesaName}`}>
            Check this name on your M-Pesa prompt before you enter your PIN.
          </Row>
        )}
        {(shop.mpesaTill || shop.mpesaPaybill) && (
          <Row icon={<Smartphone className="size-4" aria-hidden />} title="Pay with M-Pesa">
            {shop.mpesaTill && (
              <span className="block">
                Till <span className="font-semibold text-ink tnum">{shop.mpesaTill}</span>
              </span>
            )}
            {shop.mpesaPaybill && (
              <span className="block">
                Paybill <span className="font-semibold text-ink tnum">{shop.mpesaPaybill}</span>
              </span>
            )}
          </Row>
        )}
        {shop.codEnabled && <Row icon={<Banknote className="size-4" aria-hidden />} title="Pay on delivery available" />}
        {shop.deliveryEnabled && shop.deliveryPromise && (
          <Row icon={<Truck className="size-4" aria-hidden />} title="Delivery">
            {shop.deliveryPromise}
          </Row>
        )}
        {shop.pickupEnabled && shop.locationLabel && (
          <Row icon={<MapPin className="size-4" aria-hidden />} title="Pickup">
            {shop.locationLabel}
          </Row>
        )}
        {shop.returnPolicy && (
          <li className="py-3">
            <details className="group">
              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">
                  <RotateCcw className="size-4" aria-hidden />
                </span>
                <span className="flex-1 text-sm font-semibold text-ink">Returns</span>
                <ChevronDown className="size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 pl-11 text-sm leading-relaxed whitespace-pre-line text-ink-2">{shop.returnPolicy}</p>
            </details>
          </li>
        )}
      </ul>
      {wa && (
        <a
          href={whatsappChatLink(wa, contextText ?? `Hi ${shop.name}, I have a question.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-panel text-sm font-semibold text-ink transition-colors hover:bg-sunken"
        >
          <WhatsAppGlyph className="size-[18px] text-[#25D366]" />
          Chat with the seller
        </a>
      )}
      <ReportShop slug={shop.slug} shopName={shop.name} />
    </section>
  )
}

/* ───────────── Report this shop (anonymous) ───────────── */

function ReportShop({ slug, shopName }: { slug: string; shopName: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [tried, setTried] = useState(false)
  const formId = useId()
  const report = useMutation({
    mutationFn: async () => (await getStorefrontGateway()).reportShop(slug, { reason: reason as ReportReason, details: details.trim() || null }),
  })

  const missingReason = tried && !reason
  const missingDetails = tried && reason === 'other' && !details.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!reason || (reason === 'other' && !details.trim())) return
    report.mutate()
  }

  if (report.isSuccess) {
    return (
      <p role="status" className="mt-4 rounded-xl bg-sunken px-3 py-3 text-sm text-ink-2">
        Thank you. A Rafu reviewer will look at this report. {shopName} is not told who sent it.
      </p>
    )
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${formId}-form`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-ink-3 hover:text-ink focus-visible:outline-2"
      >
        <Flag className="size-3.5" aria-hidden />
        Report this shop
      </button>
      {open && (
        <form id={`${formId}-form`} onSubmit={submit} className="mt-2 flex flex-col gap-3 rounded-xl border border-line p-3" noValidate>
          <fieldset aria-describedby={missingReason ? `${formId}-reason-err` : undefined}>
            <legend className="text-sm font-semibold text-ink">What went wrong?</legend>
            <p className="mt-0.5 text-xs text-ink-3">Your report is anonymous. Only Rafu reviewers see it.</p>
            <div className="mt-2 flex flex-col gap-1">
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 text-sm text-ink-2 hover:bg-sunken">
                  <input
                    type="radio"
                    name={`${formId}-reason`}
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--ak-brand)]"
                  />
                  {REPORT_REASON_LABEL[r]}
                </label>
              ))}
            </div>
            {missingReason && (
              <p id={`${formId}-reason-err`} className="mt-1 text-xs font-medium text-neg">
                Choose what went wrong.
              </p>
            )}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">
              Details <span className="font-normal text-ink-3">{reason === 'other' ? '(needed)' : '(optional)'}</span>
            </span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
              aria-invalid={missingDetails || undefined}
              placeholder="What happened, and when? Don't include your phone number or PIN."
              className="rounded-xl border border-line-strong bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2"
            />
            {missingDetails && <span className="text-xs font-medium text-neg">Tell us briefly what happened.</span>}
          </label>
          {report.isError && (
            <p role="alert" className="text-sm text-neg">
              {report.error instanceof Error ? report.error.message : 'Could not send the report. Try again.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={report.isPending}
              className="inline-flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-panel hover:opacity-90 disabled:opacity-60"
            >
              {report.isPending ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-2 hover:bg-sunken">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
