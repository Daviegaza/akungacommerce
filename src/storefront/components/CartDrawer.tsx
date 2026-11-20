import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { isE164, whatsappChatLink } from '@/integrations/whatsapp-link'
import { Button } from '@/app/ui/primitives'
import { cn } from '@/lib/utils'
import { useCart } from '../cart'
import { useMediaQuery } from './hooks'
import { ProductImg } from './ProductImg'
import { absoluteUrl, cartWhatsappText, fmtMoney, lowestDeliveryFee, productPath, shopPath } from './storefront-utils'
import { WhatsAppGlyph } from './WhatsAppGlyph'

const EASE = [0.2, 0.8, 0.2, 1] as const

/** Slide-up sheet on phones, side drawer from sm. */
export function CartDrawer({ slug, shop }: { slug: string; shop: PublicShop }) {
  const cart = useCart(slug)
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const wide = useMediaQuery('(min-width: 640px)')
  const closeRef = useRef<HTMLButtonElement>(null)
  const { isOpen, close } = cart

  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    const prevFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => closeRef.current?.focus(), 50)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      prevFocus?.focus?.()
    }
  }, [isOpen, close])

  const wa = shop.whatsappE164 && isE164(shop.whatsappE164) ? shop.whatsappE164 : null
  const fee = lowestDeliveryFee(shop)
  const currency = cart.currency ?? shop.currency

  const panelMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : wide
      ? { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }
      : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50" key="cart">
          <motion.div
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rafu-cart-title"
            {...panelMotion}
            transition={{ duration: 0.32, ease: EASE }}
            className={cn(
              'absolute flex flex-col bg-canvas shadow-[var(--shadow-lift)]',
              'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[var(--radius-card)]',
              'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[420px] sm:rounded-none sm:border-l sm:border-line',
            )}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong sm:hidden" aria-hidden />
            <div className="flex items-center justify-between border-b border-line py-2 pr-3 pl-5 sm:py-3">
              <h2 id="rafu-cart-title" className="text-base font-semibold tracking-tight text-ink">
                Your cart
                {cart.count > 0 && <span className="ml-1.5 text-sm font-normal text-ink-3 tnum">{cart.count}</span>}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close cart"
                className="grid size-11 place-items-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {cart.lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 pb-[max(3.5rem,env(safe-area-inset-bottom))] text-center">
                <ShoppingBag className="mb-1 size-7 text-ink-3" aria-hidden />
                <p className="text-base font-semibold text-ink">Your cart is empty</p>
                <p className="max-w-xs text-sm text-ink-3">Tap + on anything you like and it will wait for you here.</p>
                <Button variant="primary" size="lg" className="mt-4" onClick={close}>
                  Keep shopping
                </Button>
              </div>
            ) : (
              <>
                <ul className="flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-5">
                  <AnimatePresence initial={false}>
                    {cart.lines.map((l) => {
                      const atMax = l.maxQuantity !== null && l.quantity >= l.maxQuantity
                      return (
                        <motion.li
                          key={l.variantId}
                          layout={!reduce}
                          initial={reduce ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
                          transition={{ duration: 0.22, ease: EASE }}
                          className="flex gap-3 py-4"
                        >
                          <Link
                            to={productPath(slug, l.productId)}
                            onClick={close}
                            className="size-[72px] shrink-0 overflow-hidden rounded-lg bg-sunken"
                            tabIndex={-1}
                            aria-hidden
                          >
                            <ProductImg src={l.image} name={l.name} className="size-full" initialClassName="text-2xl" />
                          </Link>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <Link
                                  to={productPath(slug, l.productId)}
                                  onClick={close}
                                  className="line-clamp-2 text-sm leading-snug font-medium break-words text-ink hover:underline"
                                >
                                  {l.name}
                                </Link>
                                {l.variantName && l.variantName !== 'Default' && <p className="text-xs text-ink-3">{l.variantName}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => cart.remove(l.variantId)}
                                aria-label={`Remove ${l.name}`}
                                className="-mt-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-neg"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </div>
                            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                              <div className="flex h-10 items-center rounded-lg border border-line-strong bg-panel">
                                <button
                                  type="button"
                                  onClick={() => cart.setQuantity(l.variantId, l.quantity - 1)}
                                  aria-label={l.quantity === 1 ? `Remove ${l.name}` : `One less ${l.name}`}
                                  className="grid size-10 place-items-center rounded-l-lg text-ink-2 hover:bg-sunken hover:text-ink"
                                >
                                  <Minus className="size-4" aria-hidden />
                                </button>
                                <span className="w-7 text-center text-sm font-medium tnum" aria-live="polite">
                                  {l.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => cart.setQuantity(l.variantId, l.quantity + 1)}
                                  disabled={atMax}
                                  aria-label={`One more ${l.name}`}
                                  className="grid size-10 place-items-center rounded-r-lg text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-35"
                                >
                                  <Plus className="size-4" aria-hidden />
                                </button>
                              </div>
                              <span className="text-sm font-semibold text-ink tnum">
                                {fmtMoney(l.unitPriceMinor * l.quantity, l.currency, shop.locale)}
                              </span>
                            </div>
                            {atMax && <p className="mt-1 text-[11px] text-ink-3">That is all the stock available.</p>}
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>

                <div className="border-t border-line bg-canvas px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-2">Subtotal</span>
                    <span className="text-xl font-semibold tracking-tight text-ink tnum">{fmtMoney(cart.subtotalMinor, currency, shop.locale)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {shop.deliveryEnabled
                      ? fee !== null
                        ? `Delivery from ${fmtMoney(fee, shop.currency, shop.locale)}, added before you pay.`
                        : 'Delivery fee is shown before you pay.'
                      : shop.pickupEnabled && shop.locationLabel
                        ? `Pickup at ${shop.locationLabel}.`
                        : 'Your full total is shown before you pay.'}
                  </p>
                  <Button
                    variant="primary"
                    size="lg"
                    className="mt-4 w-full"
                    onClick={() => {
                      close()
                      navigate(`${shopPath(slug)}/checkout`)
                    }}
                  >
                    Checkout
                  </Button>
                  {wa && (
                    <a
                      href={whatsappChatLink(
                        wa,
                        cartWhatsappText(shop, cart.lines, cart.subtotalMinor, currency, absoluteUrl(shopPath(slug))),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-panel text-[15px] font-medium text-ink transition-colors hover:bg-sunken"
                    >
                      <WhatsAppGlyph className="size-5 text-[#25D366]" />
                      Order on WhatsApp
                    </a>
                  )}
                  {wa && (
                    <p className="mt-2 text-center text-[11px] leading-snug text-ink-3">
                      Opens your own WhatsApp with the order typed out. Nothing is sent until you press send.
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
