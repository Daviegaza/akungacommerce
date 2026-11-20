import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { consentKey, mayTrack, parseConsent, type ConsentState } from '@/domain/tracking'
import type { StorefrontData } from '@/gateway/storefront'
import { getStorefrontGateway } from '../gateway'
import { safeLocalStorage, useCart } from '../cart'
import { emitStorefrontEvent, onStorefrontEvent } from './events'
import { revokeTrackers, sendEvent, startTrackers, type ActiveTrackers } from './loader'

function readConsent(slug: string): ConsentState {
  return parseConsent(safeLocalStorage.getItem(consentKey(slug)) as string | null)
}

/**
 * Consent banner + measurement for one shop. Renders nothing and loads nothing
 * unless the merchant set a Meta Pixel or GA4 ID. Third-party scripts load only
 * after the shopper taps "Allow"; declining (or ignoring the banner) means none.
 */
export function StorefrontAnalytics({ slug, data }: { slug: string; data: StorefrontData }) {
  const { pathname } = useLocation()
  const cart = useCart(slug)
  const [consent, setConsent] = useState<ConsentState>(() => readConsent(slug))
  const [reopen, setReopen] = useState(false)
  const active = useRef<ActiveTrackers | null>(null)

  const extras = useQuery({
    queryKey: ['storefront', slug, 'extras'],
    queryFn: async () => (await getStorefrontGateway()).getStorefrontExtras(slug),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const ids = { metaPixelId: extras.data?.metaPixelId ?? null, ga4Id: extras.data?.ga4Id ?? null }
  const configured = Boolean(ids.metaPixelId || ids.ga4Id)
  const tracking = mayTrack(consent, ids)

  // Start trackers once allowed; forward bus events while allowed.
  useEffect(() => {
    if (!tracking) return
    active.current ??= startTrackers(ids)
    const a = active.current
    return onStorefrontEvent((ev) => sendEvent(a, ev))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids are derived from extras.data
  }, [tracking, extras.data])

  // Route-driven events: PageView everywhere, ViewContent on product pages, InitiateCheckout on checkout.
  const cartRef = useRef(cart)
  useEffect(() => {
    cartRef.current = cart
  })
  useEffect(() => {
    if (!tracking) return
    emitStorefrontEvent({ type: 'page_view' })
    const product = /\/p\/([^/]+)\/?$/.exec(pathname)?.[1]
    if (product) {
      const p = data.products.find((x) => x.id === decodeURIComponent(product))
      const v = p?.variants[0]
      if (p && v) emitStorefrontEvent({ type: 'view_content', productId: p.id, valueMinor: v.priceMinor, currency: v.currency })
    }
    if (/\/checkout\/?$/.test(pathname)) {
      const c = cartRef.current
      if (c.lines.length > 0 && c.currency) {
        emitStorefrontEvent({
          type: 'initiate_checkout',
          productIds: [...new Set(c.lines.map((l) => l.productId))],
          numItems: c.count,
          valueMinor: c.subtotalMinor,
          currency: c.currency,
        })
      }
    }
  }, [pathname, tracking, data.products])

  function choose(next: 'granted' | 'denied') {
    safeLocalStorage.setItem(consentKey(slug), next)
    if (next === 'denied' && consent === 'granted') revokeTrackers()
    setConsent(next)
    setReopen(false)
  }

  if (!configured) return null

  const showBanner = consent === 'unknown' || reopen
  return (
    <>
      {showBanner && (
        <section
          role="region"
          aria-label="Cookie choice"
          className="fixed inset-x-3 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] z-50 mx-auto max-w-md rounded-2xl bg-panel p-4 text-ink shadow-[0_12px_40px_-12px_rgb(22_15_30/0.45)] ring-1 ring-line sm:bottom-6"
        >
          <p className="text-sm leading-relaxed text-ink-2">
            {data.shop.name} would like to use cookies from {[ids.metaPixelId && 'Meta', ids.ga4Id && 'Google'].filter(Boolean).join(' and ')} to measure its ads.
            Nothing personal like your name or phone number is shared. Nothing loads unless you allow it.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => choose('denied')} className="h-11 rounded-xl border border-line-strong bg-panel text-sm font-semibold text-ink hover:bg-sunken">
              No thanks
            </button>
            <button type="button" onClick={() => choose('granted')} className="h-11 rounded-xl bg-primary text-sm font-semibold text-on-primary hover:opacity-90">
              Allow
            </button>
          </div>
        </section>
      )}
      {!showBanner && (
        <div className="px-4 pt-2 pb-24 text-center sm:pb-6">
          <button type="button" onClick={() => setReopen(true)} className="min-h-11 text-xs text-ink-3 underline underline-offset-2 hover:text-ink">
            Cookie choices
          </button>
        </div>
      )}
    </>
  )
}
