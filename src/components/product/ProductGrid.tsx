import { motion } from 'framer-motion'
import type { Product } from '@/types'
import { ProductCard } from './ProductCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { SearchX } from 'lucide-react'

interface ProductGridProps {
  products: Product[]
}

export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        title="No products found"
        description="Try adjusting your filters or search terms."
        icon={<SearchX className="h-12 w-12 text-surface-400" />}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
      {products.map((product, i) => (
        <motion.div
          key={product.id}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.06 }}
        >
          <ProductCard product={product} />
        </motion.div>
      ))}
    </div>
  )
}
