import { useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpDown, Banknote, BadgeCheck, CalendarClock, Flame, MapPin, Smartphone, Sparkles, Star, Truck, X } from 'lucide-react'
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

function InfoChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-[13px] font-medium text-ink-2">
      <span className="shrink-0 text-ink-3">{icon}</span>
      <span className="truncate">{children}</span>
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
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
        on ? 'border-ink bg-ink text-canvas' : 'border-line bg-panel text-ink hover:border-line-strong',
      )}
    >
      {children}
      {on && <X className="size-3.5" aria-hidden />}
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

  return (
    <>
      <ShopHeader slug={slug} shop={shop} products={products} />

      <main className="mx-auto max-w-7xl pb-4">
        {/* ───────── Hero ───────── */}
        <section aria-label={shop.name} className="sm:px-6 sm:pt-4">
          <div className="relative h-44 overflow-hidden bg-brand-soft sm:h-72 sm:rounded-[var(--radius-card)]">
            {shop.coverUrl ? (
              <img src={shop.coverUrl} alt="" decoding="async" className="ak-rise size-full object-cover" />
            ) : (
              <div className="absolute inset-0 overflow-hidden" aria-hidden>
                <span className="absolute -right-6 -bottom-16 font-display text-[16rem] leading-none font-extrabold text-brand/10 sm:text-[22rem]">
                  {shop.name.trim()[0]?.toUpperCase()}
                </span>
                <span className="absolute top-10 left-8 h-3 w-40 rounded-full bg-brand/15" />
                <span className="absolute top-20 left-8 h-3 w-56 rounded-full bg-brand/10" />
                <span className="absolute top-[3.6rem] left-52 size-5 rounded-full bg-mango/70" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/35 via-transparent to-transparent" aria-hidden />
          </div>

          <div className="relative px-4 sm:px-8">
            <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
              <ShopAvatar shop={shop} size={84} className="shadow-[var(--shadow-lift)] ring-4 ring-canvas sm:size-24" />
              <div className="flex items-center gap-2 pb-1">
                {wa && (
                  <a
                    href={whatsappChatLink(wa, `Hi ${shop.name}, I found your shop: ${absoluteUrl(shopPath(slug))}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold text-ink transition-colors hover:bg-sunken"
                  >
                    <WhatsAppGlyph className="size-[18px] text-[#25D366]" />
                    <span className="hidden min-[380px]:inline">Chat</span>
                  </a>
                )}
                <ShareButton url={absoluteUrl(shopPath(slug))} title={shop.name} text={shop.tagline ?? `Shop ${shop.name}`} label="Share shop" />
              </div>
            </div>

            <h1 className="ak-rise mt-3 font-display text-[2.1rem] leading-[1.05] font-extrabold tracking-tight text-ink sm:text-5xl">
              {shop.name}
            </h1>
            {shop.tagline && <p className="mt-1.5 max-w-2xl text-[15px] text-ink-2 sm:text-base">{shop.tagline}</p>}
            {shop.rating && shop.rating.count > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <RatingStars rating={shop.rating.average} count={shop.rating.count} size="md" />
                <span className="text-xs text-ink-3">verified buyers</span>
              </div>
            )}

            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Shop details">
              {shop.registeredName && (
                <InfoChip icon={<BadgeCheck className="size-4 text-pos" aria-hidden />}>M-Pesa: {shop.registeredName}</InfoChip>
              )}
              {shop.deliveryEnabled && shop.deliveryPromise && (
                <InfoChip icon={<Truck className="size-4" aria-hidden />}>{shop.deliveryPromise}</InfoChip>
              )}
              {shop.pickupEnabled && shop.locationLabel && (
                <InfoChip icon={<MapPin className="size-4" aria-hidden />}>Pickup · {shop.locationLabel}</InfoChip>
              )}
              {(shop.mpesaTill || shop.mpesaPaybill) && (
                <InfoChip icon={<Smartphone className="size-4" aria-hidden />}>
                  M-Pesa {shop.mpesaTill ? `Till ${shop.mpesaTill}` : `Paybill ${shop.mpesaPaybill}`}
                </InfoChip>
              )}
              {shop.codEnabled && <InfoChip icon={<Banknote className="size-4" aria-hidden />}>Pay on delivery</InfoChip>}
            </ul>
            {shop.about && <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-relaxed text-ink-2">{shop.about}</p>}
          </div>
        </section>

        {products.length === 0 ? (
          <div className="ak-rise mx-4 mt-10 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-14 text-center sm:mx-6">
            <p className="font-display text-xl font-extrabold text-ink">The shelves are being stocked</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">
              {shop.name} hasn't added products yet. {wa ? 'Say hi on WhatsApp to ask what is coming.' : 'Check back soon.'}
            </p>
          </div>
        ) : (
          <>
            <CategoryChips
              className="mt-7"
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
                  title="Coming soon"
                  icon={<CalendarClock className="size-5 text-warn" aria-hidden />}
                  subtitle="Scheduled drops. You can order once they land."
                  products={rails.drops}
                  shop={shop}
                  slug={slug}
                />
                <ProductRail
                  title="Featured"
                  icon={<Star className="size-5 fill-mango text-mango" aria-hidden />}
                  products={rails.featured.length >= 2 ? rails.featured : []}
                  shop={shop}
                  slug={slug}
                />
                <ProductRail
                  title="New this week"
                  icon={<Sparkles className="size-5 text-brand" aria-hidden />}
                  subtitle="Added in the last 14 days"
                  products={rails.fresh}
                  shop={shop}
                  slug={slug}
                />
                <ProductRail
                  title="Deals"
                  icon={<Flame className="size-5 text-warn" aria-hidden />}
                  subtitle="Real price drops from the seller's usual price"
                  products={rails.deals}
                  shop={shop}
                  slug={slug}
                />
              </div>
            )}

            {/* ───────── Grid ───────── */}
            <section aria-labelledby="rafu-grid-title" className="mt-10 px-4 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="rafu-grid-title" className="truncate text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
                    {gridTitle}
                  </h2>
                  <p className="text-sm text-ink-3 tnum" aria-live="polite">
                    {results.length} {results.length === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <label className="relative inline-flex h-10 items-center rounded-full border border-line bg-panel pr-3 pl-3.5 text-sm font-semibold text-ink hover:border-line-strong">
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

              <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
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
                    className="h-10 shrink-0 px-3 text-sm font-semibold text-brand hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <div className="ak-rise mt-6 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-12 text-center">
                  <p className="font-display text-lg font-extrabold text-ink">Nothing matches that</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">Try fewer filters or a different word.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => update((p) => ['q', 'cat', 'stock', 'sale'].forEach((k) => p.delete(k)))}
                      className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-strong"
                    >
                      Show everything
                    </button>
                    {wa && (
                      <a
                        href={whatsappChatLink(wa, q ? `Hi ${shop.name}, do you have “${q}”?` : `Hi ${shop.name}, I'm looking for something.`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-panel px-4 text-sm font-semibold text-ink hover:bg-sunken"
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
                  className="mt-5 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-4"
                  initial="hidden"
                  animate="show"
                >
                  {results.map((p, i) => (
                    <motion.li
                      key={p.id}
                      className="min-w-0"
                      variants={{
                        hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 14 },
                        show: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.32, ease: [0.2, 0.8, 0.2, 1], delay: reduce ? 0 : Math.min(i, 11) * 0.04 },
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
      </main>
      <PoweredBy />
    </>
  )
}

export default ShopHome
