import { useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpDown, Banknote, CalendarClock, MapPin, Smartphone, Truck, X } from 'lucide-react'
import type { StorefrontData } from '@/gateway/storefront'
import { isE164, whatsappChatLink } from '@/integrations/whatsapp-link'
import { cn } from '@/lib/utils'
import { CategoryChips } from '../components/CategoryChips'
import { useNow } from '../components/hooks'
import { ProductCard } from '../components/ProductCard'
import { ProductRail } from '../components/ProductRail'
import { ShareButton } from '../components/ShareButton'
import { ShopAvatar, ShopHeader } from '../components/ShopHeader'
import { PoweredBy } from '../components/States'
import { RatingStars } from '../components/RatingStars'
import { WhatsAppGlyph } from '../components/WhatsAppGlyph'
import { TrustBlock } from '../components/TrustBlock'
import {
  absoluteUrl,
  categoriesOf,
  dropTime,
  hasDeal,
  isNew,
  isPurchasable,
  isUpcomingDrop,
  shopPath,
  sortProducts,
  type SortKey,
} from '../components/storefront-utils'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'newest', label: 'Newest' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
]

/** One quiet fact in the merchant header (delivery, pickup, payment). */
function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
        on ? 'border-ink bg-ink text-canvas' : 'border-line-strong bg-panel text-ink-2 hover:border-ink-3 hover:text-ink',
      )}
    >
      <span className="truncate">{children}</span>
      {on && <X className="size-3.5 shrink-0" aria-hidden />}
    </button>
  )
}

export function ShopHome({ slug, data }: { slug: string; data: StorefrontData }) {
  const { shop, products } = data
  const [params, setParams] = useSearchParams()
  const reduce = useReducedMotion()
  const now = useNow(60_000)

  const q = (params.get('q') ?? '').trim()
  const cat = params.get('cat')
  const inStock = params.get('stock') === '1'
  const onSale = params.get('sale') === '1'
  const sortParam = params.get('sort')
  const sort: SortKey = SORTS.some((s) => s.key === sortParam) ? (sortParam as SortKey) : 'featured'
  const filtering = Boolean(q || cat || inStock || onSale)

  useEffect(() => {
    document.title = q ? `“${q}” · ${shop.name}` : shop.tagline ? `${shop.name} · ${shop.tagline}` : shop.name
  }, [q, shop.name, shop.tagline])

  function update(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    mut(next)
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const toggle = (key: string, on: boolean) => update((p) => (on ? p.set(key, '1') : p.delete(key)))

  const categories = useMemo(() => categoriesOf(products), [products])

  const rails = useMemo(() => {
    const live = products.filter((p) => !isUpcomingDrop(p, now))
    return {
      featured: live.filter((p) => p.featured).slice(0, 12),
      fresh: sortProducts(
        live.filter((p) => isNew(p, now)),
        'newest',
      ).slice(0, 12),
      drops: products
        .filter((p) => isUpcomingDrop(p, now))
        .sort((a, b) => (dropTime(a) ?? 0) - (dropTime(b) ?? 0)),
      deals: live.filter((p) => hasDeal(p) && isPurchasable(p, now)).slice(0, 12),
    }
  }, [products, now])

  const results = useMemo(() => {
    const term = q.toLowerCase()
    const list = products.filter((p) => {
      if (cat && p.category !== cat) return false
      if (inStock && !isPurchasable(p, now)) return false
      if (onSale && !hasDeal(p)) return false
      if (term) {
        const hay = `${p.name} ${p.category ?? ''} ${p.description ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    return sortProducts(list, sort)
  }, [products, q, cat, inStock, onSale, sort, now])

  const wa = shop.whatsappE164 && isE164(shop.whatsappE164) ? shop.whatsappE164 : null
  const gridTitle = q ? `Results for “${q}”` : cat ?? 'All products'
  const gridKey = `${q}|${cat}|${inStock}|${onSale}|${sort}`
  const mpesaNumber = shop.mpesaTill ? `Till ${shop.mpesaTill}` : shop.mpesaPaybill ? `Paybill ${shop.mpesaPaybill}` : null
  const hasCover = Boolean(shop.coverUrl)

  return (
    <>
      <ShopHeader slug={slug} shop={shop} products={products} />

      <main className="mx-auto max-w-7xl pb-4">
        {/* ───────── Merchant header ───────── */}
        <section aria-label={shop.name} className="sm:px-6 sm:pt-5">
          {hasCover && (
            <div className="relative h-36 overflow-hidden bg-sunken sm:h-52 sm:rounded-[var(--radius-card)] lg:h-60">
              <img src={shop.coverUrl ?? undefined} alt="" decoding="async" className="size-full object-cover" />
            </div>
          )}

          <div className={cn('px-4 sm:px-0', hasCover ? 'sm:px-2' : 'pt-6 sm:pt-4')}>
            <div className={cn('relative flex items-end justify-between gap-3', hasCover && '-mt-8 sm:-mt-10')}>
              <ShopAvatar shop={shop} size={76} className={cn(hasCover && 'ring-4 ring-canvas')} />
              <div className="flex items-center gap-2">
                {wa && (
                  <a
                    href={whatsappChatLink(wa, `Hi ${shop.name}, I found your shop: ${absoluteUrl(shopPath(slug))}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Chat with ${shop.name} on WhatsApp`}
                    className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3.5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
                  >
                    <WhatsAppGlyph className="size-[18px] text-[#25D366]" />
                    <span className="hidden min-[380px]:inline">Chat</span>
                  </a>
                )}
                <ShareButton url={absoluteUrl(shopPath(slug))} title={shop.name} text={shop.tagline ?? `Shop ${shop.name}`} label="Share shop" />
              </div>
            </div>

            <h1 className="mt-4 font-display text-[1.75rem] leading-tight font-semibold tracking-tight break-words text-ink sm:text-4xl">
              {shop.name}
            </h1>
            {shop.tagline && <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{shop.tagline}</p>}
            {shop.rating && shop.rating.count > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <RatingStars rating={shop.rating.average} count={shop.rating.count} size="md" />
                <span className="text-xs text-ink-3">verified buyers</span>
              </div>
            )}

            <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-5" aria-label="Shop details">
              {shop.deliveryEnabled && shop.deliveryPromise && (
                <Fact icon={<Truck className="size-4" aria-hidden />}>{shop.deliveryPromise}</Fact>
              )}
              {shop.pickupEnabled && shop.locationLabel && (
                <Fact icon={<MapPin className="size-4" aria-hidden />}>Pickup · {shop.locationLabel}</Fact>
              )}
              {(mpesaNumber || shop.registeredName) && (
                <Fact icon={<Smartphone className="size-4" aria-hidden />}>
                  {mpesaNumber ? `M-Pesa ${mpesaNumber}` : 'M-Pesa'}
                  {shop.registeredName && <span className="text-ink-3">{mpesaNumber ? ' · ' : ': '}{shop.registeredName}</span>}
                </Fact>
              )}
              {shop.codEnabled && <Fact icon={<Banknote className="size-4" aria-hidden />}>Pay on delivery</Fact>}
            </ul>
            {shop.about && <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-relaxed text-ink-2">{shop.about}</p>}
          </div>
        </section>

        {products.length === 0 ? (
          <div className="mx-4 mt-10 border-t border-line pt-10 pb-6 text-center sm:mx-6">
            <p className="text-base font-semibold text-ink">New products are on the way</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">
              {shop.name} hasn't added products yet. {wa ? 'Say hi on WhatsApp to ask what is coming.' : 'Check back soon.'}
            </p>
          </div>
        ) : (
          <>
            <CategoryChips
              className="mx-4 mt-8 sm:mx-6"
              categories={categories}
              active={cat}
              onSelect={(name) =>
                update((p) => {
                  if (name) p.set('cat', name)
                  else p.delete('cat')
                })
              }
            />

            {!filtering && (
              <div className="mt-8 flex flex-col gap-10">
                <ProductRail
                  title="Featured"
                  products={rails.featured.length >= 2 ? rails.featured : []}
                  shop={shop}
                  slug={slug}
                />
                <ProductRail title="New this week" subtitle="Added in the last 14 days" products={rails.fresh} shop={shop} slug={slug} />
                <ProductRail
                  title="Deals"
                  subtitle="Real price drops from the seller's usual price"
                  products={rails.deals}
                  shop={shop}
                  slug={slug}
                />
                <ProductRail
                  quiet
                  title="Coming soon"
                  icon={<CalendarClock className="size-4 text-ink-3" aria-hidden />}
                  subtitle="Scheduled drops. You can order once they land."
                  products={rails.drops}
                  shop={shop}
                  slug={slug}
                />
              </div>
            )}

            {/* ───────── Grid ───────── */}
            <section aria-labelledby="fungua-grid-title" className="mx-4 mt-10 border-t border-line pt-6 sm:mx-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="fungua-grid-title" className="truncate text-base font-semibold tracking-tight text-ink sm:text-lg">
                    {gridTitle}
                  </h2>
                  <p className="text-xs text-ink-3 tnum" aria-live="polite">
                    {results.length} {results.length === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <label className="relative inline-flex h-10 items-center rounded-lg border border-line-strong bg-panel pr-3 pl-3 text-[13px] font-medium text-ink transition-colors hover:border-ink-3">
                  <ArrowUpDown className="mr-1.5 size-4 text-ink-3" aria-hidden />
                  <span className="sr-only">Sort by</span>
                  <select
                    value={sort}
                    onChange={(e) =>
                      update((p) => {
                        if (e.target.value === 'featured') p.delete('sort')
                        else p.set('sort', e.target.value)
                      })
                    }
                    className="cursor-pointer appearance-none bg-transparent pr-1 outline-none"
                  >
                    {SORTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="no-scrollbar -mx-4 mt-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                <FilterChip on={inStock} onClick={() => toggle('stock', !inStock)}>
                  In stock
                </FilterChip>
                {products.some(hasDeal) && (
                  <FilterChip on={onSale} onClick={() => toggle('sale', !onSale)}>
                    On sale
                  </FilterChip>
                )}
                {cat && (
                  <FilterChip on onClick={() => update((p) => p.delete('cat'))}>
                    {cat}
                  </FilterChip>
                )}
                {q && (
                  <FilterChip on onClick={() => update((p) => p.delete('q'))}>
                    “{q}”
                  </FilterChip>
                )}
                {filtering && (
                  <button
                    type="button"
                    onClick={() => update((p) => ['q', 'cat', 'stock', 'sale'].forEach((k) => p.delete(k)))}
                    className="h-10 shrink-0 px-2 text-[13px] font-medium text-ink underline underline-offset-4 decoration-line-strong hover:decoration-ink"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <div className="mt-6 border-t border-line py-12 text-center">
                  <p className="text-base font-semibold text-ink">Nothing matches that</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">Try fewer filters or a different word.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => update((p) => ['q', 'cat', 'stock', 'sale'].forEach((k) => p.delete(k)))}
                      className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary hover:opacity-90"
                    >
                      Show everything
                    </button>
                    {wa && (
                      <a
                        href={whatsappChatLink(wa, q ? `Hi ${shop.name}, do you have “${q}”?` : `Hi ${shop.name}, I'm looking for something.`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-panel px-4 text-sm font-medium text-ink hover:bg-sunken"
                      >
                        <WhatsAppGlyph className="size-4 text-[#25D366]" />
                        Ask on WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <motion.ul
                  key={gridKey}
                  className="mt-5 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5"
                  initial="hidden"
                  animate="show"
                >
                  {results.map((p, i) => (
                    <motion.li
                      key={p.id}
                      className="min-w-0"
                      variants={{
                        hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
                        show: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1], delay: reduce ? 0 : Math.min(i, 11) * 0.03 },
                        },
                      }}
                    >
                      <ProductCard product={p} shop={shop} slug={slug} eager={i < 4} />
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </section>
          </>
        )}
        <TrustBlock shop={shop} className="mx-4 mt-14 max-w-2xl sm:mx-6" />
      </main>
      <PoweredBy />
    </>
  )
}

export default ShopHome
