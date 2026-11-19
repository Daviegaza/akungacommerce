import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, SearchX, Store } from 'lucide-react'
import { RafuLogo } from '@/brand/RafuLogo'
import { BRAND } from '@/brand/brand'
import { Button, Skeleton } from '@/app/ui/primitives'

export function PoweredBy() {
  return (
    <footer className="mt-16 border-t border-line px-4 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-10">
      <a
        href="/"
        className="mx-auto flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
      >
        Powered by <RafuLogo size={20} />
      </a>
      <p className="mt-1 text-center text-[11px] text-ink-3">{BRAND.tagline}</p>
    </footer>
  )
}

function StateShell({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="ak-rise mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand">{icon}</span>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
      <div className="text-sm leading-relaxed text-ink-2">{body}</div>
      {action && <div className="mt-2">{action}</div>}
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
        <Button variant="brand" size="lg" onClick={onRetry} icon={<RefreshCw className="size-4" aria-hidden />}>
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
        <Link
          to={homeHref}
          className="inline-flex h-12 items-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-on-brand hover:bg-brand-strong"
        >
          Back to the shop
        </Link>
      }
    />
  )
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-square rounded-2xl" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-5 w-2/5" />
        </div>
      ))}
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading shop">
      <div className="h-16 border-b border-line" />
      <Skeleton className="h-44 rounded-none sm:mx-6 sm:mt-4 sm:h-64 sm:rounded-[var(--radius-card)]" />
      <div className="-mt-10 flex flex-col gap-3 px-4 sm:px-10">
        <Skeleton className="size-20 rounded-full ring-4 ring-canvas" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
      <div className="mt-8 flex gap-2 overflow-hidden px-4 sm:px-6">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-32 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-7xl px-4 sm:px-6">
        <GridSkeleton />
      </div>
    </div>
  )
}

export function ProductSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="mx-auto max-w-7xl sm:px-6 sm:pt-6 lg:grid lg:grid-cols-2 lg:gap-10">
      <Skeleton className="aspect-square rounded-none sm:rounded-[var(--radius-card)]" />
      <div className="flex flex-col gap-3 px-4 pt-5 sm:px-0">
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-9 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-20 rounded-xl" />
          <Skeleton className="h-11 w-20 rounded-xl" />
          <Skeleton className="h-11 w-20 rounded-xl" />
        </div>
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    </div>
  )
}
