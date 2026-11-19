import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Heart, Search, ShoppingBag, X } from 'lucide-react'
import type { PublicProduct, PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { useCart } from '../cart'
import { useWishlist } from '../wishlist'
import { SearchBar } from './SearchBar'
import { initialOf, shopPath } from './storefront-utils'

export function ShopAvatar({ shop, size = 36, className }: { shop: Pick<PublicShop, 'name' | 'logoUrl'>; size?: number; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand text-on-brand', className)}
      style={{ width: size, height: size }}
    >
      {shop.logoUrl && failedUrl !== shop.logoUrl ? (
        <img src={shop.logoUrl} alt="" className="size-full object-cover" decoding="async" onError={() => setFailedUrl(shop.logoUrl)} />
      ) : (
        <span className="font-display font-extrabold" style={{ fontSize: size * 0.45 }} aria-hidden>
          {initialOf(shop.name)}
        </span>
      )}
    </span>
  )
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      key={count}
      className="ak-pop absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-on-brand ring-2 ring-canvas tnum"
      aria-hidden
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

const ICON_BTN = 'relative grid size-11 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-sunken'

/** Sticky top bar: back/shop identity, instant search, saved items and cart. */
export function ShopHeader({
  slug,
  shop,
  products,
  showBack,
}: {
  slug: string
  shop: PublicShop
  products: PublicProduct[]
  showBack?: boolean
}) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const cart = useCart(slug)
  const wishlist = useWishlist(slug)
  const [searching, setSearching] = useState(false)
  const [params] = useSearchParams()
  const qKey = params.get('q') ?? ''

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-xl supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-2 sm:gap-3 sm:px-4">
        {showBack ? (
          <button
            type="button"
            className={ICON_BTN}
            aria-label="Back"
            onClick={() => {
              if (window.history.length > 1) navigate(-1)
              else navigate(shopPath(slug))
            }}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : null}
        <Link to={shopPath(slug)} className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-2 pl-1" aria-label={`${shop.name} home`}>
          <ShopAvatar shop={shop} size={34} />
          <span className="truncate font-display text-[17px] font-extrabold tracking-tight text-ink sm:max-w-[14rem]">{shop.name}</span>
        </Link>

        <div className="mx-auto hidden max-w-xl flex-1 sm:block">
          <SearchBar key={qKey} slug={slug} shop={shop} products={products} />
        </div>

        <div className="ml-auto flex items-center sm:ml-0">
          <button type="button" className={cn(ICON_BTN, 'sm:hidden')} aria-label="Search" onClick={() => setSearching(true)}>
            <Search className="size-5" aria-hidden />
          </button>
          <Link
            to={`${shopPath(slug)}/wishlist`}
            className={ICON_BTN}
            aria-label={wishlist.count ? `Saved items, ${wishlist.count}` : 'Saved items'}
          >
            <Heart className="size-5" aria-hidden />
            <CountBadge count={wishlist.count} />
          </Link>
          <button
            type="button"
            className={ICON_BTN}
            onClick={cart.open}
            aria-label={cart.count ? `Cart, ${cart.count} items` : 'Cart, empty'}
          >
            <ShoppingBag className="size-5" aria-hidden />
            <CountBadge count={cart.count} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {searching && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 bg-canvas px-2 sm:hidden"
          >
            <SearchBar slug={slug} shop={shop} products={products} autoFocus onDone={() => setSearching(false)} className="flex-1" />
            <button type="button" className={ICON_BTN} aria-label="Close search" onClick={() => setSearching(false)}>
              <X className="size-5" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
