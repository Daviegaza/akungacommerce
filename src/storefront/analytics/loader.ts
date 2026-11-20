/**
 * CSP-friendly loaders for the Meta Pixel and Google Analytics 4.
 *
 * No inline <script>, no eval, no string-built code: the standard command-queue
 * stubs are created as plain functions here, and the vendor library is added as
 * an external <script src>. IDs are validated again before use, so a bad value
 * in the database can never reach a URL or a call. Required CSP additions on the
 * storefront: script-src https://connect.facebook.net https://www.googletagmanager.com;
 * connect-src / img-src https://www.facebook.com https://*.google-analytics.com.
 *
 * Only ever called after the shopper accepted the cookie banner.
 */
import { GA4_RE, META_PIXEL_RE, ga4ScriptUrl, metaPixelScriptUrl, toGa4Event, toMetaEvent, type StorefrontEvent } from '@/domain/tracking'

type Queue = { (...args: unknown[]): void; queue: unknown[][]; callMethod?: (...args: unknown[]) => void; push: unknown; loaded: boolean; version: string }

interface TrackerWindow extends Window {
  fbq?: Queue
  _fbq?: Queue
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}

const w = () => window as TrackerWindow

function addScript(src: string, id: string): void {
  if (document.getElementById(id)) return
  const s = document.createElement('script')
  s.id = id
  s.async = true
  s.src = src
  s.referrerPolicy = 'strict-origin-when-cross-origin'
  document.head.appendChild(s)
}

export function loadMetaPixel(id: string): boolean {
  const src = metaPixelScriptUrl(id)
  if (!src || typeof document === 'undefined') return false
  const win = w()
  if (!win.fbq) {
    const q = function (...args: unknown[]) {
      if (q.callMethod) q.callMethod(...args)
      else q.queue.push(args)
    } as Queue
    q.queue = []
    q.push = q
    q.loaded = true
    q.version = '2.0'
    win.fbq = q
    win._fbq = q
  }
  win.fbq('init', id)
  addScript(src, 'rafu-meta-pixel')
  return true
}

export function loadGa4(id: string): boolean {
  const src = ga4ScriptUrl(id)
  if (!src || typeof document === 'undefined') return false
  const win = w()
  win.dataLayer = win.dataLayer ?? []
  if (!win.gtag) {
    // gtag.js reads the `arguments` object pushed onto dataLayer.
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments)
    }
  }
  win.gtag('js', new Date())
  // Page views are sent by the router hook so SPA navigation is counted once.
  win.gtag('config', id, { send_page_view: false })
  addScript(src, 'rafu-ga4')
  return true
}

export interface ActiveTrackers {
  meta: boolean
  ga4: string | null
}

export function sendEvent(active: ActiveTrackers, ev: StorefrontEvent): void {
  const win = w()
  if (active.meta && win.fbq) {
    const m = toMetaEvent(ev)
    if (m.eventId) win.fbq('track', m.name, m.params, { eventID: m.eventId })
    else win.fbq('track', m.name, m.params)
  }
  if (active.ga4 && win.gtag) {
    const g = toGa4Event(ev)
    win.gtag('event', g.name, { ...g.params, send_to: active.ga4 })
  }
}

/** The shopper withdrew consent: tell the libraries to stop (they are already loaded for this page). */
export function revokeTrackers(): void {
  const win = w()
  win.fbq?.('consent', 'revoke')
  win.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
}

export function startTrackers(ids: { metaPixelId: string | null; ga4Id: string | null }): ActiveTrackers {
  const meta = ids.metaPixelId && META_PIXEL_RE.test(ids.metaPixelId) ? loadMetaPixel(ids.metaPixelId) : false
  const ga4 = ids.ga4Id && GA4_RE.test(ids.ga4Id) && loadGa4(ids.ga4Id) ? ids.ga4Id : null
  if (meta) w().fbq?.('consent', 'grant')
  return { meta, ga4 }
}
