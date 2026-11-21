import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BadgeCheck, Check, Heart, MapPin, Minus, Plus, ShoppingBag, Truck, Wallet } from 'lucide-react'
import type { PublicProduct, PublicShop, PublicVariant, StorefrontData } from '@/gateway/storefront'
import { isE164, whatsappChatLink } from '@/integrations/whatsapp-link'
import { cn } from '@/lib/utils'
import { useCart } from '../cart'
import { useWishlist } from '../wishlist'
import { DropBadge } from '../components/DropBadge'
import { Gallery } from '../components/Gallery'
import { useNow, useReviews } from '../components/hooks'
import { PriceTag } from '../components/PriceTag'
import { ProductRail } from '../components/ProductRail'
import { RatingStars } from '../components/RatingStars'
import { ShareButton } from '../components/ShareButton'
import { ShopHeader } from '../components/ShopHeader'
import { SoldCount } from '../components/SoldCount'
import { PoweredBy, ProductNotFound } from '../components/States'
import { SoldOutOverlay, StockLine } from '../components/StockLine'
import { TrustBlock } from '../components/TrustBlock'
import { WhatsAppGlyph } from '../components/WhatsAppGlyph'
import {
  absoluteUrl,
  cartLineFor,
  fmtMoney,
  formatDate,
  formatDropDate,
  isSoldOut,
  isUpcomingDrop,
  lowestDeliveryFee,
  productPath,
  productWhatsappText,
  shopPath,
  variantInStock,
} from '../components/storefront-utils'

export function ProductPage({ slug, data }: { slug: string; data: StorefrontData }) {
  const { productId } = useParams()
  const product = data.products.find((p) => p.id === productId)

  if (!product) {
    return (
      <>
        <ShopHeader slug={slug} shop={data.shop} products={data.products} showBack />
        <ProductNotFound homeHref={shopPath(slug)} />
        <PoweredBy />
      </>
    )
  }
  return <ProductView key={product.id} slug={slug} shop={data.shop} products={data.products} product={product} />
}

function isDefaultOnly(p: PublicProduct): boolean {
  return p.variants.length <= 1 && !p.variants[0]?.swatch
}

function ProductView({
  slug,
  shop,
  products,
  product,
}: {
  slug: string
  shop: PublicShop
  products: PublicProduct[]
  product: PublicProduct
}) {
  const reduce = useReducedMotion()
  const cart = useCart(slug)
  const wishlist = useWishlist(slug)
  const now = useNow(product.availableFrom ? 1000 : 60_000)
  const reviews = useReviews(slug, product.id)

  const [variantId, setVariantId] = useState<string | null>(
    () => (product.variants.find(variantInStock) ?? product.variants[0])?.id ?? null,
  )
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [refused, setRefused] = useState(false)
  const [fly, setFly] = useState<{ key: number; x: number; y: number; tx: number; ty: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flyCount = useRef(0)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  useEffect(() => {
    document.title = `${product.name} · ${shop.name}`
  }, [product.name, shop.name])

  const variant: PublicVariant | null = product.variants.find((v) => v.id === variantId) ?? null
  const upcoming = isUpcomingDrop(product, now)
  const soldOut = isSoldOut(product)
  const variantOut = variant ? !variantInStock(variant) : true
  const maxQty = variant?.available ?? null
  const qtyCap = maxQty === null ? 99 : Math.max(1, maxQty)
  const quantity = Math.min(qty, qtyCap)
  const canBuy = !upcoming && !variantOut && variant !== null
  const saved = wishlist.has(product.id)
  const url = absoluteUrl(productPath(slug, product.id))
  const wa = shop.whatsappE164 && isE164(shop.whatsappE164) ? shop.whatsappE164 : null
  const waHref = wa ? whatsappChatLink(wa, productWhatsappText(shop, product, variant, quantity, url)) : null
  const fee = lowestDeliveryFee(shop)
  const hasMpesa = Boolean(shop.mpesaTill || shop.mpesaPaybill)
  const hasSwatches = product.variants.some((v) => v.swatch)

  const related = useMemo(
    () => products.filter((p) => p.id !== product.id && product.category && p.category === product.category).slice(0, 12),
    [products, product.id, product.category],
  )

  function addToCart(e: MouseEvent<HTMLButtonElement>) {
    if (!variant || !canBuy) return
    const ok = cart.add(cartLineFor(product, variant), quantity)
    if (!ok) {
      setRefused(true)
      return
    }
    setRefused(false)
    setAdded(true)
    if (!reduce && product.images[0]) {
      const r = e.currentTarget.getBoundingClientRect()
      flyCount.current += 1
      setFly({ key: flyCount.current, x: r.left + r.width / 2 - 28, y: r.top - 8, tx: window.innerWidth - 64, ty: 10 })
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAdded(false), 1800)
  }

  const addLabel = upcoming
    ? product.availableFrom
      ? `Available ${formatDropDate(product.availableFrom, shop, false)}`
      : 'Coming soon'
    : soldOut || variantOut
      ? 'Sold out'
      : added
        ? 'Added to cart'
        : 'Add to cart'

  const renderAdd = (className?: string) => (
    <motion.button
      type="button"
      onClick={addToCart}
      disabled={!canBuy}
      whileTap={reduce || !canBuy ? undefined : { scale: 0.96 }}
      className={cn(
        'inline-flex h-12 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-lg px-5 text-[15px] font-semibold whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed',
        added ? 'bg-pos text-white' : 'bg-primary text-on-primary hover:opacity-90',
        !canBuy && 'bg-sunken text-ink-3 hover:bg-sunken hover:opacity-100',
        className,
      )}
    >
      {added ? <Check className="size-[18px] shrink-0" aria-hidden /> : <ShoppingBag className="size-[18px] shrink-0" aria-hidden />}
      <span className="truncate">{addLabel}</span>
      {canBuy && !added && variant && (
        <span className="shrink-0 font-medium tnum opacity-80">· {fmtMoney(variant.priceMinor * quantity, variant.currency, shop.locale)}</span>
      )}
    </motion.button>
  )

  const renderWa = (className?: string, iconOnly?: boolean) =>
    waHref ? (
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Order on WhatsApp"
        className={cn(
          'inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line-strong bg-panel px-4 text-[15px] font-medium text-ink transition-colors hover:bg-sunken',
          className,
        )}
      >
        <WhatsAppGlyph className="size-5 text-[#25D366]" />
        {!iconOnly && <span>{upcoming || soldOut ? 'Ask on WhatsApp' : 'Order on WhatsApp'}</span>}
      </a>
    ) : null

  return (
    <>
      <ShopHeader slug={slug} shop={shop} products={products} showBack />

      <main className="mx-auto max-w-7xl pb-28 sm:px-6 sm:pt-6 sm:pb-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
          <div className="lg:sticky lg:top-22">
            <Gallery
              images={product.images}
              name={product.name}
              overlay={
                <>
                  {soldOut && !upcoming && (
                    <div className="pointer-events-none">
                      <SoldOutOverlay />
                    </div>
                  )}
                </>
              }
            />
          </div>

          <div className="flex min-w-0 flex-col gap-5 px-4 pt-5 sm:px-0 lg:pt-0">
            <div>
              {product.category && <p className="text-[13px] text-ink-3">{product.category}</p>}
              <div className="mt-1 flex items-start gap-3">
                <h1 className="min-w-0 flex-1 font-display text-2xl leading-tight font-semibold tracking-tight break-words text-ink sm:text-3xl">
                  {product.name}
                </h1>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => wishlist.toggle(product.id)}
                    aria-pressed={saved}
                    aria-label={saved ? 'Remove from saved' : 'Save for later'}
                    className={cn(
                      'grid size-11 place-items-center rounded-lg border border-line-strong bg-panel transition-colors hover:bg-sunken',
                      saved ? 'text-ink' : 'text-ink-2',
                    )}
                  >
                    <Heart key={String(saved)} className={cn('size-[18px]', saved && 'ak-pop fill-current')} aria-hidden />
                  </button>
                  <ShareButton url={url} title={product.name} text={`${product.name} at ${shop.name}`} />
                </div>
              </div>
              {(product.rating || product.soldCount !== null) && (
                <div className="mt-2 flex items-center gap-3">
                  <RatingStars rating={product.rating?.average} count={product.rating?.count} size="md" />
                  <SoldCount soldCount={product.soldCount} className="text-sm" />
                </div>
              )}
            </div>

            {variant && (
              <PriceTag
                priceMinor={variant.priceMinor}
                compareAtMinor={variant.compareAtMinor}
                currency={variant.currency}
                locale={shop.locale}
                size="lg"
              />
            )}

            {upcoming && <DropBadge availableFrom={product.availableFrom} shop={shop} variant="block" />}

            {!isDefaultOnly(product) && (
              <fieldset className="min-w-0 border-t border-line pt-5">
                <legend className="float-left mb-2.5 w-full text-[13px] font-semibold text-ink">
                  {hasSwatches ? 'Colour' : 'Option'}
                  {variant && <span className="ml-1.5 font-normal text-ink-2">{variant.name}</span>}
                </legend>
                <div className="clear-both flex flex-wrap gap-2">
                  {product.variants.map((v) => {
                    const out = !variantInStock(v)
                    const on = v.id === variantId
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setVariantId(v.id)
                          setRefused(false)
                        }}
                        aria-pressed={on}
                        aria-label={`${v.name}${out ? ', sold out' : ''}`}
                        className={cn(
                          'relative inline-flex h-11 max-w-full min-w-11 items-center gap-2 rounded-lg border px-3.5 text-sm transition-colors',
                          on ? 'border-ink text-ink shadow-[inset_0_0_0_1px_var(--ak-ink)]' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink',
                          out ? 'bg-sunken text-ink-3 line-through decoration-ink-3/70' : 'bg-panel',
                        )}
                      >
                        {v.swatch && (
                          <span
                            className={cn('size-5 rounded-full ring-1 ring-line-strong', out && 'opacity-40')}
                            style={{ background: v.swatch }}
                            aria-hidden
                          />
                        )}
                        {v.name}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {variant && <StockLine available={variant.available} lowStockThreshold={variant.lowStockThreshold} />}

            {canBuy && (
              <div className="flex items-center justify-between gap-4 sm:justify-start">
                <span className="text-[13px] font-semibold text-ink">Quantity</span>
                <div className="flex h-11 items-center rounded-lg border border-line-strong bg-panel">
                  <button
                    type="button"
                    onClick={() => setQty(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="grid size-11 place-items-center rounded-l-lg text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-35"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span className="w-9 text-center text-[15px] font-medium tnum" aria-live="polite">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQty(Math.min(qtyCap, quantity + 1))}
                    disabled={quantity >= qtyCap}
                    aria-label="Increase quantity"
                    className="grid size-11 place-items-center rounded-r-lg text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-35"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            )}

            <div className="hidden gap-2 sm:flex">
              {renderAdd('flex-1')}
              {renderWa()}
            </div>
            <AnimatePresence>
              {(added || refused) && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn('-mt-2 text-sm', refused ? 'text-neg' : 'text-pos')}
                  role="status"
                >
                  {refused ? (
                    'This item uses a different currency from your cart. Check out or clear your cart first.'
                  ) : (
                    <>
                      Added.{' '}
                      <button type="button" onClick={cart.open} className="font-semibold underline">
                        View cart
                      </button>
                    </>
                  )}
                </motion.p>
              )}
            </AnimatePresence>

            {waHref && (
              <p className="-mt-2 text-xs leading-relaxed text-ink-3">
                {upcoming || soldOut ? 'Ask on WhatsApp' : 'Order on WhatsApp'} opens your own WhatsApp with the message typed out. Nothing
                is sent until you press send.
              </p>
            )}

            {(shop.deliveryEnabled || shop.pickupEnabled || hasMpesa || shop.codEnabled) && (
              <ul className="divide-y divide-line border-y border-line text-sm" aria-label="Delivery and payment">
                {shop.deliveryEnabled && (
                  <li className="flex gap-3 py-3">
                    <Truck className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{shop.deliveryPromise ?? 'Delivery available'}</p>
                      {fee !== null && (
                        <p className="text-ink-2">
                          {fee === 0 ? 'Free delivery nearby' : `Delivery from ${fmtMoney(fee, shop.currency, shop.locale)}`} · exact fee shown
                          before you pay
                        </p>
                      )}
                    </div>
                  </li>
                )}
                {shop.pickupEnabled && (
                  <li className="flex gap-3 py-3">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                    <p className="min-w-0">
                      <span className="font-medium text-ink">Pickup</span>
                      <span className="text-ink-2">{shop.locationLabel ? ` at ${shop.locationLabel}` : ' available'}</span>
                    </p>
                  </li>
                )}
                {(hasMpesa || shop.codEnabled) && (
                  <li className="flex gap-3 py-3">
                    <Wallet className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                    <p className="min-w-0">
                      <span className="font-medium text-ink">Payment</span>
                      <span className="text-ink-2">
                        {' '}
                        {[hasMpesa ? `M-Pesa ${shop.mpesaTill ? 'Till' : 'Paybill'}` : null, shop.codEnabled ? 'pay on delivery' : null]
                          .filter(Boolean)
                          .join(' or ')}
                      </span>
                    </p>
                  </li>
                )}
              </ul>
            )}

            {product.description && (
              <section aria-labelledby="fungua-desc">
                <h2 id="fungua-desc" className="text-[15px] font-semibold tracking-tight text-ink">
                  Details
                </h2>
                <p className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-line text-ink-2">{product.description}</p>
              </section>
            )}

            <TrustBlock shop={shop} contextText={`Hi ${shop.name}, a question about ${product.name}: ${url}`} />

            <section aria-labelledby="rafu-reviews" className="border-t border-line pt-6">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="rafu-reviews" className="text-base font-semibold tracking-tight text-ink">
                  Reviews
                </h2>
                {product.rating && <RatingStars rating={product.rating.average} count={product.rating.count} />}
              </div>
              {reviews.isPending ? (
                <div className="mt-3 space-y-2" aria-hidden>
                  <div className="h-16 animate-pulse rounded-lg bg-sunken" />
                  <div className="h-16 animate-pulse rounded-lg bg-sunken" />
                </div>
              ) : reviews.isError ? (
                <p className="mt-2 text-sm text-ink-3">
                  Reviews couldn't load.{' '}
                  <button type="button" className="font-medium text-ink underline underline-offset-4" onClick={() => void reviews.refetch()}>
                    Try again
                  </button>
                </p>
              ) : reviews.data.length === 0 ? (
                <p className="mt-2 text-sm text-ink-3">
                  No reviews yet. Only buyers whose order was delivered can review, so every review here is real.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {reviews.data.map((r, i) => (
                    <li key={`${r.createdAt}-${i}`} className="py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <RatingStars rating={r.rating} />
                        <span className="text-sm font-medium text-ink">{r.author}</span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-pos">
                          <BadgeCheck className="size-3.5" aria-hidden />
                          Verified purchase
                        </span>
                        <span className="ml-auto text-xs text-ink-3">{formatDate(r.createdAt, shop.locale)}</span>
                      </div>
                      {r.body && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-2">{r.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {related.length > 0 && (
          <ProductRail className="mt-12 sm:-mx-6" title={`More ${product.category}`} products={related} shop={shop} slug={slug} />
        )}
      </main>
      <PoweredBy />

      {/* Sticky bottom bar on phones */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <div className="flex min-w-0 gap-2">
          {renderWa('w-12 shrink-0 px-0', true)}
          {renderAdd('min-w-0 flex-1 px-3')}
        </div>
      </div>

      <AnimatePresence>
        {fly && product.images[0] && (
          <motion.img
            key={fly.key}
            src={product.images[0].url}
            alt=""
            aria-hidden
            className="pointer-events-none fixed top-0 left-0 z-[60] size-14 rounded-lg object-cover shadow-[var(--shadow-lift)]"
            initial={{ x: fly.x, y: fly.y, scale: 1, opacity: 0.95 }}
            animate={{ x: fly.tx, y: fly.ty, scale: 0.35, opacity: 0.2 }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            onAnimationComplete={() => setFly(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export default ProductPage
