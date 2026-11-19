import { useSyncExternalStore } from 'react'
import type { StorefrontGateway } from '@/gateway/storefront'

/**
 * One storefront gateway per page load. Mode is chosen exactly like
 * resolveDataMode() in src/app/context.tsx (re-implemented here so the public
 * storefront does not pull in the staff app shell): VITE_DATA_MODE=demo forces
 * the demo; otherwise Supabase when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * are both set, else demo. Implementations are lazy-loaded.
 */
type StorefrontMode = 'supabase' | 'demo'

function resolveStorefrontMode(): StorefrontMode {
  const forced = import.meta.env.VITE_DATA_MODE as string | undefined
  if (forced === 'demo') return 'demo'
  const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  if (forced === 'supabase' && !hasSupabase) {
    console.error('VITE_DATA_MODE=supabase but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing; falling back to demo.')
  }
  return hasSupabase ? 'supabase' : 'demo'
}

async function createStorefrontGateway(mode: StorefrontMode): Promise<StorefrontGateway> {
  if (mode === 'supabase') {
    const { createSupabaseStorefront } = await import('@/gateway/storefront-supabase')
    return createSupabaseStorefront(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string)
  }
  const { createDemoStorefront } = await import('@/gateway/storefront-demo')
  return createDemoStorefront()
}

let gatewayPromise: Promise<StorefrontGateway> | null = null
let resolved: StorefrontGateway | null = null
const listeners = new Set<() => void>()

/** Memoised: every caller shares one promise (and one gateway). A failed lazy import can be retried. */
export function getStorefrontGateway(): Promise<StorefrontGateway> {
  if (!gatewayPromise) {
    gatewayPromise = createStorefrontGateway(resolveStorefrontMode()).then(
      (g) => {
        resolved = g
        for (const l of listeners) l()
        return g
      },
      (e: unknown) => {
        gatewayPromise = null
        throw e
      },
    )
  }
  return gatewayPromise
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!resolved) {
    getStorefrontGateway().catch((e: unknown) => console.error('Could not load the storefront', e))
  }
  return () => {
    listeners.delete(onChange)
  }
}

const getSnapshot = () => resolved
const getServerSnapshot = () => null

/** The storefront gateway, or null while it is still loading. */
export function useStorefrontGateway(): StorefrontGateway | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
