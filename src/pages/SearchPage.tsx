import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { motion } from 'framer-motion'
import { products } from '@/lib/products'
import { ProductGrid } from '@/components/product/ProductGrid'
import { EmptyState } from '@/components/shared/EmptyState'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q))
    )
  }, [query])

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-white">
          {query ? `Results for "${query}"` : 'Search'}
        </h1>
        <p className="mt-2 text-surface-500 dark:text-surface-400">
          {results.length} product{results.length !== 1 ? 's' : ''} found
        </p>
      </motion.div>

      {query ? (
        <ProductGrid products={results} />
      ) : (
        <EmptyState
          title="Search for products"
          description="Enter a search term to find products you'll love."
          icon={<Search className="h-12 w-12 text-surface-400" />}
        />
      )}
    </div>
  )
}
