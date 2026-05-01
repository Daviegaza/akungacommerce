import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Product, SortOption } from '@/types'
import { products } from '@/lib/products'
import { useFilterStore } from '@/store/filterStore'
import { ProductGrid } from '@/components/product/ProductGrid'
import { ProductFilters } from '@/components/product/ProductFilters'
import { ProductSort } from '@/components/product/ProductSort'
import { Button } from '@/components/ui/button'

export default function ProductListPage() {
  const [searchParams] = useSearchParams()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const search = useFilterStore((s) => s.search)
  const categories = useFilterStore((s) => s.categories)
  const priceRange = useFilterStore((s) => s.priceRange)
  const sortBy = useFilterStore((s) => s.sortBy)
  const inStockOnly = useFilterStore((s) => s.inStockOnly)
  const onSale = useFilterStore((s) => s.onSale)
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount())

  const filteredProducts = useMemo(() => {
    let result: Product[] = [...products]

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q))
      )
    }

    // URL param: category
    const urlCategory = searchParams.get('category')
    if (urlCategory) {
      result = result.filter((p) => p.category === urlCategory)
    } else if (categories.length > 0) {
      result = result.filter((p) => categories.includes(p.category))
    }

    // Price range
    result = result.filter((p) => p.price >= priceRange[0] && p.price <= priceRange[1])

    // In stock
    if (inStockOnly) {
      result = result.filter((p) => p.inStock)
    }

    // On sale
    if (onSale) {
      result = result.filter((p) => p.compareAtPrice !== null)
    }

    // URL param: sale
    if (searchParams.get('sale') === 'true') {
      result = result.filter((p) => p.compareAtPrice !== null)
    }

    // Sort
    const sortFn: Record<SortOption, (a: Product, b: Product) => number> = {
      featured: (a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0),
      newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
      bestselling: (a, b) => b.reviewCount - a.reviewCount,
    }

    result.sort(sortFn[sortBy])

    return result
  }, [search, categories, priceRange, sortBy, inStockOnly, onSale, searchParams])

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-white">
          {searchParams.get('category')
            ? `${searchParams.get('category')!.charAt(0).toUpperCase() + searchParams.get('category')!.slice(1)}`
            : searchParams.get('sale') === 'true'
              ? 'Deals & Discounts'
              : 'All Products'}
        </h1>
        <p className="mt-2 text-surface-500 dark:text-surface-400">
          {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
        </p>
      </motion.div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <Button
          variant="outline"
          size="md"
          onClick={() => setMobileFiltersOpen(true)}
          className="lg:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div className="hidden lg:block" />
        <ProductSort />
      </div>

      {/* Content */}
      <div className="flex gap-10">
        <ProductFilters
          isOpen={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
        />
        <div className="flex-1 min-w-0">
          <ProductGrid products={filteredProducts} />
        </div>
      </div>
    </div>
  )
}
