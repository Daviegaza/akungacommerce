import { Link } from 'react-router-dom'
import { X, ShoppingBag, Minus, Plus, Trash2, ArrowRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCartStore } from '@/store/cartStore'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatPrice } from '@/lib/utils'
import { STANDARD_SHIPPING, SHIPPING_THRESHOLD, ROUTES } from '@/lib/constants'
import { useRemoveFromCart, useBeginCheckout } from '@/hooks/useAnalytics'

export function CartDrawer() {
  const items = useCartStore((s) => s.items)
  const subtotal = useCartStore((s) => s.subtotal())
  const isOpen = useCartStore((s) => s.isOpen)
  const closeCart = useCartStore((s) => s.closeCart)
  const removeItem = useCartStore((s) => s.removeItem)
  const updateQuantity = useCartStore((s) => s.updateQuantity)

  const trackRemove = useRemoveFromCart()
  const trackCheckout = useBeginCheckout()

  const shipping = subtotal >= SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING
  const total = subtotal + shipping

  const handleRemove = (item: { id: string; productId: string; name: string; price: number }) => {
    removeItem(item.id)
    trackRemove(item.productId, item.name, item.price)
  }

  const handleCheckout = () => {
    trackCheckout(total, items.length)
    closeCart()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-surface-900 shadow-2xl"
          >
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-surface-900 dark:text-surface-100" />
                  <h2 className="text-lg font-bold text-surface-900 dark:text-white">
                    Cart ({items.length})
                  </h2>
                </div>
                <button
                  onClick={closeCart}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Items */}
              {items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    title="Your cart is empty"
                    description="Looks like you haven't added anything yet."
                    icon={<ShoppingBag className="h-10 w-10 text-surface-400" />}
                    action={{
                      label: 'Start Shopping',
                      onClick: closeCart,
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
                    <AnimatePresence>
                      {items.map((item) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20, height: 0 }}
                          className="flex gap-4"
                        >
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-20 w-20 rounded-xl object-cover shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                              {item.name}
                            </h4>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                              {item.color} {item.size && `/ ${item.size}`}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                  className="h-7 w-7 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="w-8 text-center text-sm font-semibold text-surface-900 dark:text-surface-100">
                                  {item.quantity}
                                </span>
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                  className="h-7 w-7 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-surface-900 dark:text-surface-100">
                                  {formatPrice(item.price * item.quantity)}
                                </span>
                                <button
                                  onClick={() => handleRemove(item)}
                                  className="text-surface-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-surface-200 dark:border-surface-700 px-6 py-4 space-y-3">
                    {shipping > 0 && (
                      <div className="text-xs text-surface-500 dark:text-surface-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
                        Add {formatPrice(SHIPPING_THRESHOLD - subtotal)} more for free shipping
                      </div>
                    )}
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-surface-500 dark:text-surface-400">
                        <span>Subtotal</span>
                        <span>{formatPrice(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-surface-500 dark:text-surface-400">
                        <span>Shipping</span>
                        <span>{shipping === 0 ? 'Free' : formatPrice(shipping)}</span>
                      </div>
                      <Separator className="my-1.5" />
                      <div className="flex justify-between text-base font-bold text-surface-900 dark:text-white">
                        <span>Total</span>
                        <span>{formatPrice(total)}</span>
                      </div>
                    </div>
                    <Link
                      to={ROUTES.checkout}
                      onClick={handleCheckout}
                      className="block"
                    >
                      <Button size="lg" className="w-full">
                        Checkout
                        <ArrowRight className="h-5 w-5" />
                      </Button>
                    </Link>
                    <button
                      onClick={closeCart}
                      className="w-full text-center text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300 transition-colors py-1"
                    >
                      Continue Shopping
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
