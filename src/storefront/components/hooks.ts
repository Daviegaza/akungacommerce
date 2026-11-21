import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getStorefrontGateway } from '@/storefront/gateway'
import { safeLocalStorage } from '../cart'

/* ───────────── Clock: one shared interval per period, read via useSyncExternalStore ───────────── */
interface Ticker {
  now: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
}
const tickers = new Map<number, Ticker>()

function tickerFor(intervalMs: number): Ticker {
  let t = tickers.get(intervalMs)
  if (!t) {
    t = { now: Date.now(), listeners: new Set(), timer: null }
    tickers.set(intervalMs, t)
  }
  return t
}

function subscribeTicker(intervalMs: number, cb: () => void): () => void {
  const t = tickerFor(intervalMs)
  t.listeners.add(cb)
  if (!t.timer) {
    t.now = Date.now()
    t.timer = setInterval(() => {
      t.now = Date.now()
      t.listeners.forEach((l) => l())
    }, intervalMs)
    // The cached value may be stale after an idle period: notify once with the fresh one.
    queueMicrotask(cb)
  }
  return () => {
    t.listeners.delete(cb)
    if (t.listeners.size === 0 && t.timer) {
      clearInterval(t.timer)
      t.timer = null
    }
  }
}

function readTicker(intervalMs: number): number {
  return tickerFor(intervalMs).now
}

/** Current time in ms, refreshed every `intervalMs`. Safe to use during render. */
export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback((cb: () => void) => subscribeTicker(intervalMs, cb), [intervalMs])
  const read = useCallback(() => readTicker(intervalMs), [intervalMs])
  return useSyncExternalStore(subscribe, read, read)
}

/* ───────────── Media query ───────────── */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(
    () => (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/* ───────────── Data ───────────── */
export function useStorefront(slug: string) {
  return useQuery({
    queryKey: ['storefront', slug],
    queryFn: async () => (await getStorefrontGateway()).getStorefront(slug),
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function useReviews(slug: string, productId: string | undefined) {
  return useQuery({
    queryKey: ['storefront', slug, 'reviews', productId],
    queryFn: async () => (await getStorefrontGateway()).listReviews(slug, productId as string),
    enabled: Boolean(slug && productId),
    staleTime: 5 * 60_000,
  })
}

/* ───────────── Recent searches (device only) ───────────── */
interface RecentState {
  bySlug: Record<string, string[]>
  push(slug: string, q: string): void
  clear(slug: string): void
}
const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      bySlug: {},
      push(slug, q) {
        const term = q.trim()
        if (!term) return
        set((s) => {
          const prev = (s.bySlug[slug] ?? []).filter((x) => x.toLowerCase() !== term.toLowerCase())
          return { bySlug: { ...s.bySlug, [slug]: [term, ...prev].slice(0, 6) } }
        })
      },
      clear(slug) {
        set((s) => ({ bySlug: { ...s.bySlug, [slug]: [] } }))
      },
    }),
    { name: 'rafu-recent-searches', version: 1, storage: createJSONStorage(() => safeLocalStorage) },
  ),
)
const NO_RECENT: string[] = []

export function useRecentSearches(slug: string) {
  const items = useRecentStore((s) => s.bySlug[slug] ?? NO_RECENT)
  return useMemo(
    () => ({
      items,
      push: (q: string) => useRecentStore.getState().push(slug, q),
      clear: () => useRecentStore.getState().clear(slug),
    }),
    [items, slug],
  )
}
