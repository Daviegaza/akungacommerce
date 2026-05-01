import { Minus, Plus, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import type { CartItem as CartItemType } from '@/types'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'

interface CartItemProps {
  item: CartItemType
}

export function CartItem({ item }: CartItemProps) {
  const removeItem = useCartStore((s) => s.removeItem)
  const updateQuantity = useCartStore((s) => s.updateQuantity)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex gap-4 sm:gap-6 p-4 sm:p-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700"
    >
      <Link
        to={`/products/${item.productId}`}
        className="shrink-0"
      >
        <img
          src={item.image}
          alt={item.name}
          className="h-24 w-24 sm:h-28 sm:w-28 rounded-xl object-cover"
        />
      </Link>

      <div className="flex-1 min-w-0">
        <Link
          to={`/products/${item.productId}`}
          className="text-base sm:text-lg font-semibold text-surface-900 dark:text-surface-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors truncate block"
        >
          {item.name}
        </Link>

        <p className="text-sm text-surface-400 dark:text-surface-500 mt-0.5">
          {item.color} {item.size && `/ ${item.size}`}
        </p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => updateQuantity(item.id, item.quantity - 1)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all border border-surface-200 dark:border-surface-700"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center text-sm font-semibold text-surface-900 dark:text-surface-100">
              {item.quantity}
            </span>
            <button
              onClick={() => updateQuantity(item.id, item.quantity + 1)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all border border-surface-200 dark:border-surface-700"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-surface-900 dark:text-white">
              {formatPrice(item.price * item.quantity)}
            </span>
            <button
              onClick={() => removeItem(item.id)}
              className="p-2 text-surface-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label="Remove item"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
