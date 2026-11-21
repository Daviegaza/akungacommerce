/* eslint-disable react-refresh/only-export-components -- context module: provider + hooks belong together */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommerceGateway } from '@/gateway/gateway'
import type { OrganisationWithRole, SessionUser } from '@/gateway/types'
import { can, type Permission } from '@/domain/permissions'

/* ───────────── Gateway selection ───────────── */

export type DataMode = 'supabase' | 'demo'

export function resolveDataMode(): DataMode {
  const forced = import.meta.env.VITE_DATA_MODE as string | undefined
  if (forced === 'demo') return 'demo'
  const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  if (forced === 'supabase' && !hasSupabase) {
    console.error('VITE_DATA_MODE=supabase but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing; falling back to demo.')
  }
  return hasSupabase ? 'supabase' : 'demo'
}

let gatewayPromise: Promise<CommerceGateway> | null = null

/** One gateway (and one auth client) per page load, even under StrictMode double effects. */
function loadGateway(mode: DataMode): Promise<CommerceGateway> {
  gatewayPromise ??= createGateway(mode)
  return gatewayPromise
}

async function createGateway(mode: DataMode): Promise<CommerceGateway> {
  if (mode === 'supabase') {
    const { createSupabaseGateway } = await import('@/gateway/supabase')
    return createSupabaseGateway(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string)
  }
  const { createDemoGateway } = await import('@/gateway/demo')
  return createDemoGateway()
}

const GatewayContext = createContext<CommerceGateway | null>(null)

export function useGateway(): CommerceGateway {
  const g = useContext(GatewayContext)
  if (!g) throw new Error('useGateway outside provider')
  return g
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

export function AppProviders({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [gateway, setGateway] = useState<CommerceGateway | null>(null)
  useEffect(() => {
    let alive = true
    loadGateway(resolveDataMode()).then((g) => alive && setGateway(g))
    return () => {
      alive = false
    }
  }, [])
  if (!gateway) return <>{fallback}</>
  return (
    <QueryClientProvider client={queryClient}>
      <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>
    </QueryClientProvider>
  )
}

/* ───────────── Session ───────────── */

export function useSessionUser() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['session'], queryFn: () => gateway.getUser(), staleTime: Infinity })
  useEffect(
    () =>
      gateway.onAuthChange((u: SessionUser | null) => {
        qc.setQueryData(['session'], u)
        qc.invalidateQueries({ queryKey: ['orgs'] })
      }),
    [gateway, qc],
  )
  return query
}

export function useOrganisations(enabled = true) {
  const gateway = useGateway()
  return useQuery({ queryKey: ['orgs'], queryFn: () => gateway.listOrganisations(), enabled })
}

/* ───────────── Current organisation ───────────── */

interface OrgContextValue {
  org: OrganisationWithRole
  orgs: OrganisationWithRole[]
  switchOrg: (id: string) => void
  can: (p: Permission) => boolean
}

const OrgContext = createContext<OrgContextValue | null>(null)
const ORG_KEY = 'akunga.currentOrg'

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY)
  } catch {
    return null
  }
}

export function OrgProvider({ orgs, children }: { orgs: OrganisationWithRole[]; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(readStoredOrg)
  const org = orgs.find((o) => o.id === selected) ?? orgs[0]
  const value = useMemo<OrgContextValue>(
    () => ({
      org,
      orgs,
      switchOrg: (id) => {
        setSelected(id)
        try {
          localStorage.setItem(ORG_KEY, id)
        } catch {
          /* storage unavailable: selection lasts for this tab only */
        }
      },
      can: (p) => can(org.role, p),
    }),
    [org, orgs],
  )
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const v = useContext(OrgContext)
  if (!v) throw new Error('useOrg outside OrgProvider')
  return v
}

/* ───────────── Data hooks ───────────── */

export function useOrgQuery<T>(key: string, fn: (g: CommerceGateway, orgId: string) => Promise<T>, extraKey: unknown[] = []) {
  const gateway = useGateway()
  const { org } = useOrg()
  return useQuery({ queryKey: [org.id, key, ...extraKey], queryFn: () => fn(gateway, org.id) })
}

export const useProducts = () => useOrgQuery('products', (g, o) => g.listProducts(o))
export const useOrders = () => useOrgQuery('orders', (g, o) => g.listOrders(o))
export const useOrder = (id: string) => useOrgQuery('order', (g, o) => g.getOrder(o, id), [id])
export const useCustomers = () => useOrgQuery('customers', (g, o) => g.listCustomers(o))
export const usePayments = () => useOrgQuery('payments', (g, o) => g.listPayments(o))
export const useRefunds = () => useOrgQuery('refunds', (g, o) => g.listRefunds(o))
export const useMovements = (variantId?: string) =>
  useOrgQuery('movements', (g, o) => g.listStockMovements(o, { variantId }), [variantId ?? 'all'])
export const useMembers = () => useOrgQuery('members', (g, o) => g.listMembers(o))
export const useAudit = () => useOrgQuery('audit', (g, o) => g.listAudit(o))
export const useIntegrations = () => useOrgQuery('integrations', (g, o) => g.listIntegrations(o))

/**
 * Run a gateway mutation, then refresh everything for this organisation
 * (orders, stock and payments are interlinked, so partial invalidation is error-prone).
 */
export function useAction<TInput, TResult = unknown>(fn: (g: CommerceGateway, orgId: string, input: TInput) => Promise<TResult>) {
  const gateway = useGateway()
  const { org } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TInput) => fn(gateway, org.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [org.id] }),
  })
}
