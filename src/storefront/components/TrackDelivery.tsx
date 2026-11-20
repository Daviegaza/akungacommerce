import { Suspense, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Map as MapIcon, MapPin, Package, Store, Truck, Undo2 } from 'lucide-react'
import { FAILED_REASON_BUYER_TEXT, policyText, returnedToShopBuyerText } from '@/domain/delivery-policy'
import { formatDateTime } from '@/domain/locale'
import type { TrackedDelivery } from '@/gateway/delivery'
import type { TrackedOrder } from '@/gateway/storefront'
import { Button } from '@/app/ui/primitives'
import { MapFallback, StaticMap, type LatLng } from '@/maps'

/**
 * Lightweight location summary for the tracking page. Text first; MapLibre
 * (~300 KB gzipped) is only requested when the buyer taps "Show map".
 */
export function LocationPreview({
  shopLoc,
  dropLoc,
  shopLabel,
  dropLabel,
  height,
}: {
  shopLoc: LatLng | null
  dropLoc: LatLng | null
  shopLabel: string
  dropLabel: string | null
  height: number
}) {
  const [open, setOpen] = useState(false)
  if (!shopLoc && !dropLoc) return null
  if (open) {
    return (
      <Suspense fallback={<MapFallback height={height} />}>
        <StaticMap
          markers={[
            ...(shopLoc ? [{ ...shopLoc, kind: 'shop' as const, label: shopLabel }] : []),
            ...(dropLoc ? [{ ...dropLoc, kind: 'drop' as const, label: dropLabel ?? 'Drop-off' }] : []),
          ]}
          height={height}
        />
      </Suspense>
    )
  }
  const km = shopLoc && dropLoc ? haversine(shopLoc, dropLoc) : null
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-sunken p-3 sm:flex-row sm:items-center sm:justify-between">
      <ol className="flex min-w-0 flex-col gap-1.5 text-sm" aria-label="Route">
        {shopLoc && (
          <li className="flex items-start gap-2">
            <Store className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 text-ink">{shopLabel}</span>
          </li>
        )}
        {dropLoc && (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
            <span className="min-w-0 text-ink">
              {dropLabel ?? 'Your drop-off pin'}
              {km != null && <span className="text-ink-3 tnum"> · about {km.toFixed(1)} km away</span>}
            </span>
          </li>
        )}
      </ol>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={<MapIcon className="size-4" aria-hidden />} className="min-h-11 shrink-0">
        Show map
      </Button>
    </div>
  )
}

function haversine(a: LatLng, b: LatLng): number {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h))
}

/** Deposit received, balance due on delivery. */
export function DepositPaidNotice({ delivery, money, pickup }: { delivery: TrackedDelivery; money(minor: number): string; pickup: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-pos-soft px-4 py-3 text-sm ak-rise" role="status">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
      <div>
        <p className="font-semibold text-ink">Deposit of {money(delivery.depositPaidMinor)} received</p>
        <p className="text-ink-2">
          Pay the balance of <span className="font-semibold text-ink tnum">{money(delivery.balanceDueMinor)}</span>{' '}
          {pickup ? 'when you collect.' : 'when your order arrives.'}
        </p>
      </div>
    </div>
  )
}

/** Failed attempts, handoff and the agreed policy, in plain words. */
export function DeliveryUpdates({ order, money }: { order: TrackedOrder; money(minor: number): string }) {
  const d = order.delivery
  if (!d) return null
  const { locale, timezone } = order.shop
  const failed = d.events.filter((e) => e.kind === 'failed')
  const policyLines = d.agreedPolicy ? policyText(d.agreedPolicy, { currency: order.currency, locale: locale || 'en', delivers: order.fulfilment.method === 'delivery' }) : []
  const outOfAttempts = d.attempts >= d.maxAttempts && order.status === 'dispatched'
  const items: ReactNode[] = []

  if (d.handoff.kind === 'pickup_point' && d.handoff.pickupPoint) {
    const p = d.handoff.pickupPoint
    items.push(
      <li key="pp" className="flex items-start gap-2.5">
        <Package className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div>
          <p className="font-semibold text-ink">Collect from {p.name}</p>
          {p.area && <p className="text-ink-2">{p.area}</p>}
          {p.hours && (
            <p className="inline-flex items-center gap-1 text-xs text-ink-3">
              <Clock className="size-3" aria-hidden /> {p.hours}
            </p>
          )}
          <p className="text-xs text-ink-3">Bring your order number #{order.number} and the phone you ordered with.</p>
        </div>
      </li>,
    )
  }
  if (d.handoff.kind === 'courier' && d.handoff.carrier) {
    items.push(
      <li key="courier" className="flex items-start gap-2.5">
        <Truck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-ink">
          Sent with <span className="font-semibold">{d.handoff.carrier}</span>
          {order.fulfilment.trackingRef ? `, tracking number ${order.fulfilment.trackingRef}` : ''}.
        </p>
      </li>,
    )
  }
  for (const e of failed) {
    items.push(
      <li key={`f-${e.attempt}-${e.createdAt}`} className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="text-ink">
            <span className="font-semibold">
              Delivery attempt {e.attempt} of {d.maxAttempts} didn’t go through
            </span>{' '}
            because {e.reason ? FAILED_REASON_BUYER_TEXT[e.reason] : FAILED_REASON_BUYER_TEXT.other}.
            {e.forfeitedMinor > 0 && <> The {money(e.forfeitedMinor)} delivery fee for that trip was kept from your deposit, as the shop’s policy says.</>}
          </p>
          <p className="text-xs text-ink-3 tnum">
            <time dateTime={e.createdAt}>{formatDateTime(e.createdAt, locale || 'en', timezone)}</time>
          </p>
        </div>
      </li>,
    )
  }
  if (d.returnedAt) {
    const text = returnedToShopBuyerText({ attempts: d.attempts, forfeitedMinor: d.forfeitedMinor, refund: d.refund ?? null }, money)
    items.push(
      <li key="returned" className="flex items-start gap-2.5 rounded-xl bg-sunken p-3">
        <Undo2 className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
        <div>
          <p className="font-semibold text-ink">{text.title}</p>
          {text.lines.map((l) => (
            <p key={l} className="text-ink-2">
              {l}
            </p>
          ))}
          <p className="text-xs text-ink-3 tnum">
            <time dateTime={d.returnedAt}>{formatDateTime(d.returnedAt, locale || 'en', timezone)}</time>
          </p>
        </div>
      </li>,
    )
  }
  if (failed.length > 0 && order.status === 'dispatched') {
    items.push(
      <li key="next" className="rounded-xl bg-sunken p-3 text-ink-2">
        {outOfAttempts
          ? 'No more delivery attempts will be made. Message the shop to collect your order or to sort out the rest of your payment.'
          : 'The shop will contact you to arrange another try. Keep your phone close.'}
      </li>,
    )
  }

  if (items.length === 0 && policyLines.length === 0) return null
  return (
    <section className="rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] sm:p-5 ak-rise" aria-labelledby="delivery-updates">
      <h2 id="delivery-updates" className="mb-3 text-lg font-extrabold tracking-tight">
        {failed.length > 0 || d.returnedAt ? 'Delivery updates' : 'How your order reaches you'}
      </h2>
      {items.length > 0 && <ul className="flex flex-col gap-3 text-sm">{items}</ul>}
      {policyLines.length > 0 && (
        <details className="mt-3 rounded-xl border border-line p-3 text-sm">
          <summary className="min-h-6 cursor-pointer font-semibold text-ink">The shop policy you agreed to</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-2">
            {policyLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {d.forfeitedMinor > 0 && <p className="mt-2 text-xs text-ink-3">Kept for failed trips so far: {money(d.forfeitedMinor)}.</p>}
        </details>
      )}
    </section>
  )
}
