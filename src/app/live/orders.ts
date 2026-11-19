import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OrderSummary } from '@/gateway/types'
import { useGateway, useOrg } from '../context'
import { playChime } from './chime'
import { useLocalString } from './storage'

/**
 * Orders list polled every 20 s while the workspace is open. Shares the cache
 * key used by useOrders(), so every page sees the same fresh list.
 */
export function useLiveOrders() {
  const gateway = useGateway()
  const { org } = useOrg()
  return useQuery({
    queryKey: [org.id, 'orders'],
    queryFn: () => gateway.listOrders(org.id),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * Plays the sale chime when an order id appears that was not in the list at the
 * previous fetch. The first load only records ids, so opening the app is silent.
 */
export function useSaleChime(orders: OrderSummary[] | undefined, orgId: string, enabled: boolean) {
  const seen = useRef<{ orgId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!orders) return
    if (!seen.current || seen.current.orgId !== orgId) {
      seen.current = { orgId, ids: new Set(orders.map((o) => o.id)) }
      return
    }
    const ids = seen.current.ids
    const fresh = orders.filter((o) => !ids.has(o.id) && o.status !== 'draft')
    for (const o of orders) ids.add(o.id)
    if (fresh.length > 0 && enabled) playChime()
  }, [orders, orgId, enabled])
}

/** Order-count milestones worth a (one-time) celebration. */
export const MILESTONES = [1, 10, 50, 100, 500, 1000] as const

export function countedOrders(orders: OrderSummary[]): number {
  return orders.filter((o) => o.status !== 'draft' && o.status !== 'cancelled').length
}

/**
 * The highest milestone this business has reached but this device has not yet
 * celebrated. Derived from real order counts only; shown once per milestone per org.
 */
export function useMilestone(orders: OrderSummary[] | undefined, orgId: string): { milestone: number | null; dismiss: () => void } {
  const [raw, setRaw] = useLocalString(`rafu.milestone.${orgId}`)
  const count = orders ? countedOrders(orders) : 0
  const reached = [...MILESTONES].reverse().find((m) => m <= count) ?? 0
  const seen = Number(raw ?? 0) || 0
  const milestone = orders && reached > seen ? reached : null
  const dismiss = useCallback(() => setRaw(String(Math.max(reached, seen))), [reached, seen, setRaw])
  return { milestone, dismiss }
}
