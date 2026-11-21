import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import type { StorefrontData } from '@/gateway/storefront'
import { useWishlist } from '../wishlist'
import { ProductCard } from '../components/ProductCard'
import { ShopHeader } from '../components/ShopHeader'
import { PoweredBy } from '../components/States'
import { shopPath } from '../components/storefront-utils'

export function WishlistPage({ slug, data }: { slug: string; data: StorefrontData }) {
  const { shop, products } = data
  const wishlist = useWishlist(slug)
  const saved = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]))
    return wishlist.ids.map((id) => byId.get(id)).filter((p) => p !== undefined)
  }, [products, wishlist.ids])
  const missing = wishlist.ids.length - saved.length

  useEffect(() => {
    document.title = `Saved · ${shop.name}`
  }, [shop.name])

  return (
    <>
      <ShopHeader slug={slug} shop={shop} products={products} showBack />
      <main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Saved</h1>
        <p className="mt-1 text-[13px] text-ink-3">Kept on this device only. No account needed.</p>

        {saved.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 border-t border-line px-6 pt-14 pb-6 text-center">
            <Heart className="mb-1 size-7 text-ink-3" aria-hidden />
            <p className="text-base font-semibold text-ink">Nothing saved yet</p>
            <p className="max-w-xs text-sm text-ink-3">Tap the heart on anything you like to find it here later.</p>
            <Link
              to={shopPath(slug)}
              className="mt-4 inline-flex h-12 max-w-full items-center rounded-lg bg-primary px-5 text-[15px] font-semibold text-on-primary hover:opacity-90"
            >
              <span className="truncate">Browse {shop.name}</span>
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 border-t border-line pt-6 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5">
            {saved.map((p, i) => (
              <li key={p.id} className="ak-rise min-w-0" style={{ animationDelay: `${Math.min(i, 11) * 40}ms` }}>
                <ProductCard product={p} shop={shop} slug={slug} eager={i < 4} />
              </li>
            ))}
          </ul>
        )}
        {missing > 0 && (
          <p className="mt-6 text-sm text-ink-3">
            {missing === 1 ? '1 saved item is' : `${missing} saved items are`} no longer in this shop.
          </p>
        )}
      </main>
      <PoweredBy />
    </>
  )
}

export default WishlistPage
