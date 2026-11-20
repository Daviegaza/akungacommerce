import { useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

type EventName =
  | 'page_view'
  | 'product_view'
  | 'product_click'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'purchase'
  | 'search'
  | 'sign_in'
  | 'sign_up'
  | 'add_to_wishlist'
  | 'share'
  | 'filter'
  | 'sort'

interface AnalyticsEvent {
  name: EventName
  properties?: Record<string, string | number | boolean>
}

// Analytics queue — in production this would POST to an endpoint
const analyticsQueue: AnalyticsEvent[] = []

function track(event: AnalyticsEvent) {
  analyticsQueue.push({
    ...event,
    properties: {
      ...event.properties,
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.pathname : '',
    },
  })

  // In dev, log to console. In prod, batch-send to analytics endpoint.
  if (import.meta.env.DEV) {
    console.log(`[Analytics] ${event.name}`, event.properties ?? {})
  }
}

// Flush queue periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (analyticsQueue.length === 0) return
    const batch = analyticsQueue.splice(0, analyticsQueue.length)
    if (import.meta.env.DEV) {
      console.log(`[Analytics] Flushing ${batch.length} events`, batch)
    }
    // Production: navigator.sendBeacon('/api/analytics', JSON.stringify(batch))
  }, 10_000)
}

// ─── Page view tracking ───

export function usePageView(pageName?: string) {
  const location = useLocation()

  useEffect(() => {
    track({
      name: 'page_view',
      properties: {
        page: pageName ?? location.pathname,
        path: location.pathname,
        search: location.search,
      },
    })
  }, [location.pathname, location.search, pageName])
}

// ─── Ecommerce events ───

/** Tracks a product view once per product. Pass undefined while the product is unknown (no event). */
export function useProductView(productId: string | undefined, productName: string, price: number) {
  useEffect(() => {
    if (!productId) return
    track({
      name: 'product_view',
      properties: { productId, productName, price },
    })
  }, [productId, productName, price])
}

export function useAddToCart() {
  return useCallback(
    (productId: string, productName: string, price: number, quantity: number) => {
      track({
        name: 'add_to_cart',
        properties: { productId, productName, price, quantity },
      })
    },
    []
  )
}

export function useRemoveFromCart() {
  return useCallback((productId: string, productName: string, price: number) => {
    track({
      name: 'remove_from_cart',
      properties: { productId, productName, price },
    })
  }, [])
}

export function useSearch() {
  return useCallback((query: string, resultCount: number) => {
    track({
      name: 'search',
      properties: { query, resultCount },
    })
  }, [])
}

export function useFilter() {
  return useCallback((filterName: string, filterValue: string) => {
    track({
      name: 'filter',
      properties: { filterName, filterValue },
    })
  }, [])
}

export function useBeginCheckout() {
  return useCallback((total: number, itemCount: number) => {
    track({
      name: 'begin_checkout',
      properties: { total, itemCount },
    })
  }, [])
}

// Re-export raw track for one-off events
export { track }
