import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Product } from '@/types'
import { useRecentlyViewedStore } from '@/hooks/useRecentlyViewed'
import { formatPrice } from '@/lib/utils'

export function RecentlyViewed() {
  const [products, setProducts] = useState<Product[]>([])
  const clearAll = useRecentlyViewedStore((s) => s.clearAll)

  useEffect(() => {
    setProducts(useRecentlyViewedStore.getState().getProducts())
  }, [])

  if (products.length === 0) return null

  return (
    <div className="border-t border-surface-200 dark:border-surface-800 py-12">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-surface-400" />
          <h2 className="text-xl font-bold text-surface-900 dark:text-white">Recently Viewed</h2>
        </div>
        <button
          onClick={() => {
            clearAll()
            setProducts([])
          }}
          className="text-xs font-medium text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
        <AnimatePresence>
          {products.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="shrink-0 w-40"
            >
              <Link
                to={`/products/${product.id}`}
                className="group block"
              >
                <div className="relative overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800 aspect-square mb-2">
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    loading="lazy"
                    className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                </div>
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                  {product.name}
                </p>
                <p className="text-sm font-bold text-surface-700 dark:text-surface-300">
                  {formatPrice(product.price)}
                </p>
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
