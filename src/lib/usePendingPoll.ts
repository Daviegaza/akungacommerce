import { useEffect, useRef, useState } from 'react'
import { createBackoffPoller, type BackoffOptions, type BackoffPoller } from './backoff-poller'

const browserEnv = {
  setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clearTimeout: (h: unknown) => window.clearTimeout(h as number),
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
}

/**
 * Poll while `active` (e.g. any M-Pesa prompt is pending): every 5 s, backing off to
 * 30 s, paused while the tab is hidden, faster again whenever `changeKey` changes.
 * Returns whether polling is live (active and the tab visible), for a "live" indicator.
 */
export function usePendingPoll(active: boolean, poll: () => unknown, changeKey: unknown, opts?: BackoffOptions): boolean {
  const pollRef = useRef(poll)
  useEffect(() => {
    pollRef.current = poll
  }, [poll])
  const pollerRef = useRef<BackoffPoller | null>(null)
  const [visible, setVisible] = useState(browserEnv.isVisible)

  useEffect(() => {
    if (!active) return
    const poller = createBackoffPoller(() => void pollRef.current(), browserEnv, opts)
    pollerRef.current = poller
    poller.start()
    const onVis = () => {
      const v = browserEnv.isVisible()
      setVisible(v)
      if (v) poller.onVisible()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      poller.stop()
      pollerRef.current = null
    }
    // opts is a static config object at call sites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    pollerRef.current?.reset()
  }, [changeKey])

  return active && visible
}
