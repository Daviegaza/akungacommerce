import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isPlatformHost } from '@/domain/custom-domain'

function platformHostsFromEnv(): string[] {
  const raw = import.meta.env.VITE_PLATFORM_HOSTS as string | undefined
  return (raw ?? '').split(',').map((h) => h.trim()).filter(Boolean)
}

/**
 * "/" on the platform host shows the Fungua landing page. On a merchant's own
 * domain, the hostname is looked up (verified domains of published shops only)
 * and the visitor is sent to that shop; anything else falls back to the landing
 * page, and /s/:slug links keep working everywhere.
 */
export function HostHome({ landing }: { landing: ReactNode }) {
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname
  const custom = !isPlatformHost(host, platformHostsFromEnv())
  const [state, setState] = useState<{ status: 'loading' | 'done'; slug: string | null }>({ status: custom ? 'loading' : 'done', slug: null })

  useEffect(() => {
    if (!custom) return
    let alive = true
    import('./gateway')
      .then(({ getStorefrontGateway }) => getStorefrontGateway())
      .then((g) => g.resolveShopHost(host))
      .then(
        (slug) => alive && setState({ status: 'done', slug }),
        () => alive && setState({ status: 'done', slug: null }),
      )
    return () => {
      alive = false
    }
  }, [custom, host])

  if (state.status === 'loading') {
    return (
      <div className="ak-root flex min-h-dvh items-center justify-center" role="status" aria-label="Loading shop">
        <span className="size-8 animate-pulse rounded-xl bg-brand" aria-hidden />
      </div>
    )
  }
  if (state.slug) return <Navigate to={`/s/${encodeURIComponent(state.slug)}`} replace />
  return <>{landing}</>
}
