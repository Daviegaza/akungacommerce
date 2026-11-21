import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import { useCartStore } from '@/store/cartStore'
import { CheckoutForm } from '@/components/checkout/CheckoutForm'
import { OrderSummary } from '@/components/checkout/OrderSummary'
import { EmptyState } from '@/components/shared/EmptyState'
import { ROUTES } from '@/lib/constants'
import { ShoppingBag } from 'lucide-react'

export default function CheckoutPage() {
  const items = useCartStore((s) => s.items)

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <EmptyState
          title="Nothing to checkout"
          description="Add some products to your cart first."
          icon={<ShoppingBag className="h-12 w-12 text-surface-400" />}
          action={{
            label: 'Browse Products',
            href: ROUTES.products,
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-6"
      >
        <Link
          to={ROUTES.cart}
          className="inline-flex items-center gap-2 text-sm font-medium text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Cart
        </Link>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="text-3xl sm:text-4xl font-semibold tracking-tight text-surface-900 dark:text-white mb-8"
      >
        Checkout
      </motion.h1>

      <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
        <div className="lg:col-span-2">
          <CheckoutForm />
        </div>
        <div className="lg:col-span-1">
          <div className="sticky top-24">
            <OrderSummary />
          </div>
        </div>
      </div>
    </div>
  )
}
