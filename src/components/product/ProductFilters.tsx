import { X, Filter } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFilterStore } from '@/store/filterStore'
import { Separator } from '@/components/ui/separator'
import { CATEGORIES, PRICE_RANGE } from '@/lib/constants'
import { cn, formatPrice } from '@/lib/utils'

interface ProductFiltersProps {
  isOpen: boolean
  onClose: () => void
}

export function ProductFilters({ isOpen, onClose }: ProductFiltersProps) {
  const categories = useFilterStore((s) => s.categories)
  const toggleCategory = useFilterStore((s) => s.toggleCategory)
  const priceRange = useFilterStore((s) => s.priceRange)
  const setPriceRange = useFilterStore((s) => s.setPriceRange)
  const inStockOnly = useFilterStore((s) => s.inStockOnly)
  const toggleInStock = useFilterStore((s) => s.toggleInStock)
  const onSale = useFilterStore((s) => s.onSale)
  const toggleOnSale = useFilterStore((s) => s.toggleOnSale)
  const resetFilters = useFilterStore((s) => s.resetFilters)
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount())

  const content = (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-surface-900 dark:text-white flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Separator />

      {/* Categories */}
      <div>
        <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Category</h4>
        <div className="space-y-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={cn(
                'flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm transition-all duration-200',
                categories.includes(cat.id)
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400 font-medium'
                  : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-200 dark:hover:bg-surface-800'
              )}
            >
              <span>{cat.name}</span>
              <span className="text-xs text-surface-400">{cat.productCount}</span>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Price Range */}
      <div>
        <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Price Range</h4>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">{formatPrice(priceRange[0])}</span>
            <input
              type="range"
              min={PRICE_RANGE[0]}
              max={PRICE_RANGE[1]}
              step={50}
              value={priceRange[1]}
              onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
              className="flex-1 accent-brand-600"
            />
            <span className="text-xs text-surface-400">{formatPrice(priceRange[1])}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Toggles */}
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={toggleInStock}
            className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/20"
          />
          <span className="text-sm text-surface-700 dark:text-surface-300">In Stock Only</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={onSale}
            onChange={toggleOnSale}
            className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/20"
          />
          <span className="text-sm text-surface-700 dark:text-surface-300">On Sale</span>
        </label>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-64 shrink-0">{content}</div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 z-50 h-full w-80 max-w-[85vw] bg-white dark:bg-surface-900 shadow-2xl lg:hidden p-6 overflow-auto"
            >
              {content}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
