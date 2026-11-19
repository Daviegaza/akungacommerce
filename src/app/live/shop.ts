import { useQuery } from '@tanstack/react-query'
import { useGateway, useOrg } from '../context'

/** Merchant shop settings (null until the shop is set up). Shared cache key [orgId, 'shop']. */
export function useShopSettings() {
  const gateway = useGateway()
  const { org } = useOrg()
  return useQuery({ queryKey: [org.id, 'shop'], queryFn: () => gateway.getShopSettings(org.id) })
}

export function shopUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/s/${encodeURIComponent(slug)}`
}
