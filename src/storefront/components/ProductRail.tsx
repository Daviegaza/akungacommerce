import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PublicProduct, PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { ProductCard } from './ProductCard'

/** Horizontally scrolling, snap-aligned row of product cards. */
export function ProductRail({
  title,
  subtitle,
  icon,
  products,
  shop,
  slug,
  className,
}: {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  products: PublicProduct[]
  shop: PublicShop
  slug: string
  className?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  if (products.length === 0) return null

  function page(dir: 1 | -1) {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <section className={cn('ak-rise', className)} aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3 px-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
        </div>
        {products.length > 3 && (
          <div className="hidden shrink-0 gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => page(-1)}
              aria-label={`Scroll ${title} back`}
              className="grid size-10 place-items-center rounded-full border border-line-strong bg-panel text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => page(1)}
              aria-label={`Scroll ${title} forward`}
              className="grid size-10 place-items-center rounded-full border border-line-strong bg-panel text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        )}
      </div>
      <div
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:scroll-px-6 sm:gap-4 sm:px-6"
      >
        {products.map((p) => (
          <ProductCard key={p.id} product={p} shop={shop} slug={slug} className="w-[44vw] max-w-[220px] shrink-0 snap-start sm:w-[220px]" />
        ))}
      </div>
    </section>
  )
}
