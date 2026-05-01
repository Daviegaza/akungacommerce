import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, ArrowRight, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchStore } from '@/store/searchStore'
import { useDebounce } from '@/hooks/useDebounce'
import { useSearch } from '@/hooks/useAnalytics'
import { formatPrice } from '@/lib/utils'

export function SearchOverlay() {
  const isOpen = useSearchStore((s) => s.isOpen)
  const closeSearch = useSearchStore((s) => s.closeSearch)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.setQuery)
  const results = useSearchStore((s) => s.results)
  const suggestions = useSearchStore((s) => s.suggestions)
  const isSearching = useSearchStore((s) => s.isSearching)
  const search = useSearchStore((s) => s.search)
  const debouncedQuery = useDebounce(query, 250)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const trackSearch = useSearch()

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    search(debouncedQuery)
  }, [debouncedQuery, search])

  useEffect(() => {
    if (query && results.length > 0) {
      trackSearch(query, results.length)
    }
  }, [results, query, trackSearch])

  const handleSelect = (productId: string) => {
    closeSearch()
    navigate(`/products/${productId}`)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSearch}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed left-[50%] top-[15%] z-50 translate-x-[-50%] w-full max-w-xl"
          >
            <div className="mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden">
              {/* Input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <Search className="h-5 w-5 text-surface-400 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products..."
                  className="flex-1 bg-transparent text-surface-900 dark:text-surface-100 placeholder:text-surface-400 text-base outline-none"
                />
                <button
                  onClick={closeSearch}
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Results */}
              <div className="max-h-[60vh] overflow-auto">
                {isSearching ? (
                  <div className="p-8 text-center">
                    <div className="animate-spin mx-auto h-6 w-6 rounded-full border-2 border-surface-200 border-t-brand-600" />
                  </div>
                ) : query && results.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-surface-500 dark:text-surface-400">No products found for "{query}"</p>
                  </div>
                ) : results.length > 0 ? (
                  <div className="py-2">
                    {results.slice(0, 8).map((product) => (
                      <motion.button
                        key={product.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.04 }}
                        onClick={() => handleSelect(product.id)}
                        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-left"
                      >
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          className="h-12 w-12 rounded-xl object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                            {product.name}
                          </p>
                          <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 capitalize">
                            {product.category}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                            {formatPrice(product.price)}
                          </p>
                          {product.compareAtPrice && (
                            <p className="text-xs text-surface-400 line-through">
                              {formatPrice(product.compareAtPrice)}
                            </p>
                          )}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                ) : suggestions.length > 0 ? (
                  <div className="py-2">
                    <p className="px-4 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                      Suggestions
                    </p>
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => setQuery(s)}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-left"
                      >
                        <ArrowRight className="h-3.5 w-3.5 text-surface-400" />
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center">
                    <Sparkles className="h-8 w-8 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                      Start typing to search products
                    </p>
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2.5 border-t border-surface-100 dark:border-surface-800 flex items-center gap-4 text-xs text-surface-400">
                <span>Press <kbd className="px-1.5 py-0.5 rounded-md bg-surface-100 dark:bg-surface-800 font-mono text-[10px]">ESC</kbd> to close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
