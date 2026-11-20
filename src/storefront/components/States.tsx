import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, SearchX, Store } from 'lucide-react'
import { FunguaLogo } from '@/brand/FunguaLogo'
import { Button, Skeleton, buttonClass } from '@/app/ui/primitives'

/** Small platform credit. The merchant's brand leads everywhere above it. */
export function PoweredBy() {
  return (
    <footer className="mt-16 border-t border-line px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <a
          href="/"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 opacity-80 transition-opacity hover:opacity-100"
        >
          Powered by <FunguaLogo size={16} tone="mono" />
        </a>
        <nav aria-label="Legal" className="flex gap-1">
          <Link to="/legal/privacy" className="inline-flex min-h-10 items-center rounded-md px-2 hover:text-ink hover:underline hover:underline-offset-2">
            Privacy
          </Link>
          <Link to="/legal/terms" className="inline-flex min-h-10 items-center rounded-md px-2 hover:text-ink hover:underline hover:underline-offset-2">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  )
}

function StateShell({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <span className="mb-1 text-ink-3">{icon}</span>
      <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      <div className="text-sm leading-relaxed text-ink-2">{body}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ShopNotFound() {
  return (
    <>
      <StateShell
        icon={<Store className="size-7" aria-hidden />}
        title="This shop isn't open here"
        body="The link may be mistyped, or the shop hasn't published yet. Ask the seller to send their shop link again."
      />
      <PoweredBy />
    </>
  )
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <StateShell
      icon={<RefreshCw className="size-7" aria-hidden />}
      title="We couldn't load this shop"
      body="Check your connection and try again."
      action={
        <Button variant="primary" size="lg" onClick={onRetry} icon={<RefreshCw className="size-4" aria-hidden />}>
          Try again
        </Button>
      }
    />
  )
}

export function ProductNotFound({ homeHref }: { homeHref: string }) {
  return (
    <StateShell
      icon={<SearchX className="size-7" aria-hidden />}
      title="This product isn't available"
      body="It may have been removed or the link changed. Everything else in the shop is a tap away."
      action={
        <Link to={homeHref} className={buttonClass('primary', 'lg')}>
          Back to the shop
        </Link>
      }
    />
  )
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-square rounded-[var(--radius-card)]" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-4 w-2/5" />
        </div>
      ))}
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading shop">
      <div className="h-14 border-b border-line sm:h-16" />
      <div className="mx-auto max-w-7xl">
        <div className="sm:px-6 sm:pt-5">
          <Skeleton className="h-36 rounded-none sm:h-52 sm:rounded-[var(--radius-card)] lg:h-60" />
        </div>
        <div className="-mt-8 flex flex-col gap-3 px-4 sm:-mt-10 sm:px-8">
          <Skeleton className="size-[76px] rounded-full ring-4 ring-canvas" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="mx-4 mt-8 flex gap-6 overflow-hidden border-b border-line pb-3 sm:mx-6">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-16 shrink-0" />
          ))}
        </div>
        <div className="mt-8 px-4 sm:px-6">
          <GridSkeleton />
        </div>
      </div>
    </div>
  )
}

export function ProductSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="mx-auto max-w-7xl sm:px-6 sm:pt-6 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
      <Skeleton className="aspect-square rounded-none sm:rounded-[var(--radius-card)]" />
      <div className="flex flex-col gap-3 px-4 pt-5 sm:px-0 lg:pt-0">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-7 w-1/3" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-11 w-20" />
          <Skeleton className="h-11 w-20" />
          <Skeleton className="h-11 w-20" />
        </div>
        <Skeleton className="mt-2 h-12 w-full" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    </div>
  )
}

/** Unknown public URL (production). The old template is not served outside development. */
export function PublicNotFound() {
  return (
    <div className="min-h-dvh bg-canvas">
      <StateShell
        icon={<SearchX className="size-7" aria-hidden />}
        title="This page doesn't exist"
        body="The link may be mistyped or out of date. If someone sent you a shop link, ask them for it again."
        action={
          <Link to="/" className={buttonClass('primary', 'lg')}>
            Go to the home page
          </Link>
        }
      />
    </div>
  )
}
