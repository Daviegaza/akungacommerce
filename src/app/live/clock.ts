import { useSyncExternalStore } from 'react'

/**
 * One shared wall clock for relative times ("3 min ago"). A single interval
 * ticks while anything is subscribed, so many timestamps re-render together
 * and no component reads Date.now() during render.
 */
const TICK_MS = 30_000
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function emit() {
  now = Date.now()
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    // Catch up immediately in case the module value is stale.
    queueMicrotask(emit)
    timer = setInterval(emit, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getSnapshot = () => now

/** Current time in ms, refreshed every 30 s. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a short date. */
export function formatRelative(iso: string, nowMs: number, locale = 'en'): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffSec = Math.round((nowMs - t) / 1000)
  const future = diffSec < 0
  const s = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (s < 45) return future ? rtf.format(0, 'second') : 'just now'
  const sign = future ? 1 : -1
  if (s < 3600) return rtf.format(sign * Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86_400) return rtf.format(sign * Math.round(s / 3600), 'hour')
  if (s < 7 * 86_400) return rtf.format(sign * Math.round(s / 86_400), 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(t))
}
