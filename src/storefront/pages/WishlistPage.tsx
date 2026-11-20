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
      <main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Saved</h1>
        <p className="mt-1 text-sm text-ink-3">Kept on this device only. No account needed.</p>

        {saved.length === 0 ? (
          <div className="ak-rise mt-8 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-14 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand">
              <Heart className="size-7" aria-hidden />
            </span>
            <p className="font-display text-xl font-semibold text-ink">Nothing saved yet</p>
            <p className="max-w-xs text-sm text-ink-3">Tap the heart on anything you like to find it here later.</p>
            <Link
              to={shopPath(slug)}
              className="mt-2 inline-flex h-12 items-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-on-brand shadow-[0_6px_20px_-6px_var(--ak-brand)] hover:bg-brand-strong"
            >
              Browse {shop.name}
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-4">
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
