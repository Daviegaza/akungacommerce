import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Heart, Plus, Truck } from 'lucide-react'
import type { PublicProduct, PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { useCart } from '../cart'
import { useWishlist } from '../wishlist'
import { DropBadge } from './DropBadge'
import { useNow } from './hooks'
import { PriceTag } from './PriceTag'
import { ProductImg } from './ProductImg'
import { RatingStars } from './RatingStars'
import { SoldCount } from './SoldCount'
import { SoldOutOverlay, StockLine } from './StockLine'
import {
  cartLineFor,
  displayVariant,
  hasPriceRange,
  isNew,
  isSoldOut,
  isUpcomingDrop,
  productPath,
  swatches,
} from './storefront-utils'

export function ProductCard({
  product,
  shop,
  slug,
  className,
  eager,
}: {
  product: PublicProduct
  shop: PublicShop
  slug: string
  className?: string
  eager?: boolean
}) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const cart = useCart(slug)
  const wishlist = useWishlist(slug)
  const now = useNow(60_000)
  const [added, setAdded] = useState(false)
  const [heartPop, setHeartPop] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const href = productPath(slug, product.id)
  const v = displayVariant(product)
  const soldOut = isSoldOut(product)
  const upcoming = isUpcomingDrop(product, now)
  const fresh = !upcoming && isNew(product, now)
  const saved = wishlist.has(product.id)
  const dots = swatches(product)
  const single = product.variants.length === 1 ? product.variants[0] : null
  const [first, second] = product.images

  function quickAdd() {
    if (!single) {
      navigate(href)
      return
    }
    const ok = cart.add(cartLineFor(product, single), 1)
    if (!ok) {
      navigate(href)
      return
    }
    setAdded(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAdded(false), 1400)
  }

  return (
    <article className={cn('group relative flex min-w-0 flex-col', className)}>
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-sunken shadow-[var(--shadow-card)] transition-shadow duration-300 group-hover:shadow-[var(--shadow-lift)]">
        <Link to={href} className="block size-full" tabIndex={-1} aria-hidden>
          <ProductImg
            src={first?.url}
            name={product.name}
            eager={eager}
            className="size-full transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:scale-[1.03]"
          />
          {second && (
            <img
              src={second.url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              className="absolute inset-0 hidden size-full object-cover opacity-0 transition-opacity duration-300 sm:block sm:group-hover:opacity-100"
            />
          )}
        </Link>

        <div className="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1">
          {upcoming && <DropBadge availableFrom={product.availableFrom} shop={shop} />}
          {fresh && (
            <span className="inline-flex h-6 items-center rounded-full bg-mango px-2 text-[11px] font-bold text-on-mango shadow-sm">
              New
            </span>
          )}
        </div>

        {soldOut && !upcoming && (
          <div className="pointer-events-none">
            <SoldOutOverlay />
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            wishlist.toggle(product.id)
            setHeartPop((n) => n + 1)
          }}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${product.name} from saved` : `Save ${product.name}`}
          className="absolute top-1.5 right-1.5 grid size-11 place-items-center rounded-full"
        >
          <span
            key={heartPop}
            className={cn(
              'grid size-9 place-items-center rounded-full bg-panel/90 shadow-sm backdrop-blur transition-colors',
              heartPop > 0 && 'ak-pop',
              saved ? 'text-brand' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Heart className={cn('size-[18px]', saved && 'fill-current')} aria-hidden />
          </span>
        </button>

        {!soldOut && !upcoming && v && (
          <motion.button
            type="button"
            onClick={quickAdd}
            whileTap={reduce ? undefined : { scale: 0.85 }}
            aria-label={single ? `Add ${product.name} to cart` : `Choose options for ${product.name}`}
            className="absolute right-1.5 bottom-1.5 grid size-11 place-items-center rounded-full"
          >
            <motion.span
              animate={added && !reduce ? { scale: [1, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className={cn(
                'grid size-9 place-items-center rounded-full shadow-[0_6px_16px_-6px_var(--ak-brand)] transition-colors',
                added ? 'bg-pos text-white' : 'bg-brand text-on-brand hover:bg-brand-strong',
              )}
            >
              {added ? <Check className="size-[18px]" aria-hidden /> : <Plus className="size-5" strokeWidth={2.5} aria-hidden />}
            </motion.span>
          </motion.button>
        )}
        <span className="sr-only" aria-live="polite">
          {added ? `${product.name} added to cart` : ''}
        </span>
      </div>

      <div className="flex flex-col gap-1 px-0.5 pt-2.5">
        <Link
          to={href}
          className="line-clamp-2 text-sm leading-snug font-medium text-ink decoration-brand/40 underline-offset-2 hover:underline"
        >
          {product.name}
        </Link>
        {v && (
          <PriceTag
            priceMinor={v.priceMinor}
            compareAtMinor={v.compareAtMinor}
            currency={v.currency}
            locale={shop.locale}
            from={hasPriceRange(product)}
          />
        )}
        {dots.length > 0 && (
          <div className="flex items-center gap-1" aria-label={`${dots.length} colours`}>
            {dots.slice(0, 5).map((d) => (
              <span
                key={d.id}
                title={d.name}
                className="size-3.5 rounded-full ring-1 ring-line-strong ring-offset-1 ring-offset-canvas"
                style={{ background: d.color }}
              />
            ))}
            {dots.length > 5 && <span className="text-[11px] text-ink-3 tnum">+{dots.length - 5}</span>}
          </div>
        )}
        {(product.rating || product.soldCount !== null) && (
          <div className="flex items-center gap-2">
            <RatingStars rating={product.rating?.average} count={product.rating?.count} />
            <SoldCount soldCount={product.soldCount} />
          </div>
        )}
        {single && !upcoming && !soldOut && <StockLine available={single.available} lowStockThreshold={single.lowStockThreshold} className="text-xs" />}
        {shop.deliveryPromise && !soldOut && !upcoming && (
          <p className="flex items-center gap-1 text-xs text-pos">
            <Truck className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{shop.deliveryPromise}</span>
          </p>
        )}
      </div>
    </article>
  )
}
