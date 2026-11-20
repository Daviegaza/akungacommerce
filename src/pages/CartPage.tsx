import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCartStore } from '@/store/cartStore'
import { CartItem } from '@/components/cart/CartItem'
import { CartSummary } from '@/components/cart/CartSummary'
import { EmptyState } from '@/components/shared/EmptyState'
import { ROUTES } from '@/lib/constants'

export default function CartPage() {
  const items = useCartStore((s) => s.items)
  const clearCart = useCartStore((s) => s.clearCart)

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <EmptyState
          title="Your cart is empty"
          description="Looks like you haven't added anything to your cart yet. Browse our products and find something you'll love."
          icon={<ShoppingBag className="h-12 w-12 text-surface-400" />}
          action={{
            label: 'Start Shopping',
            href: ROUTES.products,
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-surface-900 dark:text-white">
            Shopping Cart
          </h1>
          <p className="mt-2 text-surface-500 dark:text-surface-400">
            {items.length} item{items.length !== 1 ? 's' : ''} in your cart
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={clearCart}
            className="text-sm font-medium text-surface-400 hover:text-red-500 transition-colors"
          >
            Clear Cart
          </button>
          <Link
            to={ROUTES.products}
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            Continue Shopping
          </Link>
        </div>
      </motion.div>

      {/* Content */}
      <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
        <div className="lg:col-span-2 space-y-4">
          <AnimatePresence>
            {items.map((item) => (
              <CartItem key={item.id} item={item} />
            ))}
          </AnimatePresence>
        </div>
        <div className="lg:col-span-1">
          <div className="sticky top-24">
            <CartSummary />
          </div>
        </div>
      </div>
    </div>
  )
}
