import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PublicProduct, PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { ProductCard } from './ProductCard'

const PAGE_BTN =
  'grid size-10 place-items-center rounded-lg border border-line-strong bg-panel text-ink-2 transition-colors hover:bg-sunken hover:text-ink'

/** Horizontally scrolling, snap-aligned row of product cards under a hairline. `quiet` = smaller title and cards. */
export function ProductRail({
  title,
  subtitle,
  icon,
  products,
  shop,
  slug,
  className,
  quiet,
}: {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  products: PublicProduct[]
  shop: PublicShop
  slug: string
  className?: string
  quiet?: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  if (products.length === 0) return null

  function page(dir: 1 | -1) {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <section className={className} aria-label={title}>
      <div className="mx-4 flex items-end justify-between gap-3 border-t border-line pt-6 sm:mx-6">
        <div className="min-w-0">
          <h2 className={cn('flex items-center gap-2 font-semibold tracking-tight text-ink', quiet ? 'text-[15px]' : 'text-base sm:text-lg')}>
            {icon}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        </div>
        {products.length > 3 && (
          <div className="hidden shrink-0 gap-1.5 sm:flex">
            <button type="button" onClick={() => page(-1)} aria-label={`Scroll ${title} back`} className={PAGE_BTN}>
              <ChevronLeft className="size-[18px]" aria-hidden />
            </button>
            <button type="button" onClick={() => page(1)} aria-label={`Scroll ${title} forward`} className={PAGE_BTN}>
              <ChevronRight className="size-[18px]" aria-hidden />
            </button>
          </div>
        )}
      </div>
      <div
        ref={scroller}
        className="no-scrollbar mt-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:scroll-px-6 sm:gap-4 sm:px-6"
      >
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            shop={shop}
            slug={slug}
            className={cn(
              'shrink-0 snap-start',
              quiet ? 'w-[36vw] max-w-[168px] sm:w-[168px]' : 'w-[42vw] max-w-[216px] sm:w-[216px]',
            )}
          />
        ))}
      </div>
    </section>
  )
}
