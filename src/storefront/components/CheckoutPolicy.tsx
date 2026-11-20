import { Clock, MapPin, ShieldCheck } from 'lucide-react'
import { policyText, type ShopPolicy } from '@/domain/delivery-policy'
import type { PublicPickupPoint } from '@/gateway/delivery'
import { cn } from '@/lib/utils'
import { fmtMoney } from './storefront-utils'

/** Choose one of the shop's pick-up points (native radios for keyboard and screen readers). */
export function PickupPointPicker({
  points,
  value,
  onChange,
  currency,
  locale,
  error,
}: {
  points: PublicPickupPoint[]
  value: string | null
  onChange(id: string): void
  currency: string
  locale: string
  error: string | null
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">Choose a pick-up point</legend>
      <ul className="flex flex-col gap-2">
        {points.map((p) => {
          const active = p.id === value
          return (
            <li key={p.id}>
              <label
                className={cn(
                  'flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                  active ? 'border-brand bg-brand-soft/60' : 'border-line-strong bg-panel hover:bg-sunken',
                )}
              >
                <input type="radio" name="pickup-point" value={p.id} checked={active} onChange={() => onChange(p.id)} className="sr-only" />
                <MapPin className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand' : 'text-ink-3')} aria-hidden />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-semibold text-ink">{p.name}</span>
                  {p.area && <span className="block text-ink-2">{p.area}</span>}
                  {p.hours && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3">
                      <Clock className="size-3" aria-hidden /> {p.hours}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink tnum">{p.feeMinor === 0 ? 'Free' : fmtMoney(p.feeMinor, currency, locale)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-neg">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-3">The shop sends your order to the point you choose. Collect it with your order number and phone.</p>
    </fieldset>
  )
}

/** The shop's payment and failed-delivery rules, in plain words, shown before the order button. */
export function PolicyNote({ policy, currency, locale, delivers }: { policy: ShopPolicy; currency: string; locale: string; delivers: boolean }) {
  const lines = policyText(policy, { currency, locale, delivers })
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <ShieldCheck className="size-3.5 text-pos" aria-hidden /> Shop policy: payment and delivery
      </p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-2">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}
