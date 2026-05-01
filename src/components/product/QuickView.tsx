import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { X, ShoppingCart, ChevronLeft, ChevronRight, Minus, Plus, Star, Heart } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Product } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCartStore } from '@/store/cartStore'
import { useWishlistStore } from '@/store/wishlistStore'
import { useToastStore } from '@/store/toastStore'
import { useAddToCart } from '@/hooks/useAnalytics'
import { formatPrice, calculateDiscount, cn } from '@/lib/utils'

interface QuickViewProps {
  product: Product
  isOpen: boolean
  onClose: () => void
}

export function QuickView({ product, isOpen, onClose }: QuickViewProps) {
  const [activeImage, setActiveImage] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [selectedColor, setSelectedColor] = useState(product.colors[0]?.name || '')

  const addItem = useCartStore((s) => s.addItem)
  const trackAddToCart = useAddToCart()
  const toggleWishlist = useWishlistStore((s) => s.toggleItem)
  const hasWishlisted = useWishlistStore((s) => s.hasItem)
  const toast = useToastStore((s) => s.success)

  const discount = product.compareAtPrice ? calculateDiscount(product.price, product.compareAtPrice) : 0
  const isWishlisted = hasWishlisted(product.id)

  const handleAddToCart = useCallback(() => {
    addItem({
      productId: product.id,
      name: product.name,
      image: product.images[0],
      price: product.price,
      color: selectedColor,
      size: '',
      quantity,
    })
    trackAddToCart(product.id, product.name, product.price, quantity)
    toast('Added to cart', `${product.name} × ${quantity}`)
    onClose()
  }, [product, selectedColor, quantity, addItem, trackAddToCart, toast, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-3xl max-h-[90vh] overflow-auto rounded-3xl bg-white dark:bg-surface-900 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 transition-all"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="grid md:grid-cols-2">
              {/* Image gallery */}
              <div className="relative bg-surface-100 dark:bg-surface-800">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={activeImage}
                    src={product.images[activeImage]}
                    alt={`${product.name} - ${activeImage + 1}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-72 md:h-full w-full object-cover"
                  />
                </AnimatePresence>

                {product.images.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImage((i) => (i - 1 + product.images.length) % product.images.length)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 dark:bg-surface-800/90 shadow-lg flex items-center justify-center"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setActiveImage((i) => (i + 1) % product.images.length)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 dark:bg-surface-800/90 shadow-lg flex items-center justify-center"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                {/* Discount badge */}
                {discount > 0 && (
                  <Badge variant="sale" className="absolute top-3 left-3">-{discount}%</Badge>
                )}
              </div>

              {/* Info */}
              <div className="p-6 sm:p-8 flex flex-col">
                <p className="text-xs font-medium text-surface-400 uppercase tracking-widest">{product.category}</p>
                <h2 className="text-xl font-bold text-surface-900 dark:text-white mt-1">{product.name}</h2>

                <div className="flex items-center gap-1.5 mt-2">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm font-semibold">{product.rating}</span>
                  <span className="text-xs text-surface-400">({product.reviewCount.toLocaleString()})</span>
                  {product.inStock ? (
                    <span className="text-xs text-green-600 dark:text-green-400 ml-2">In Stock</span>
                  ) : (
                    <span className="text-xs text-red-500 ml-2">Out of Stock</span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mt-3">
                  <span className="text-2xl font-black text-surface-900 dark:text-white">{formatPrice(product.price)}</span>
                  {product.compareAtPrice && (
                    <span className="text-sm text-surface-400 line-through">{formatPrice(product.compareAtPrice)}</span>
                  )}
                </div>

                <p className="text-sm text-surface-500 dark:text-surface-400 mt-3 line-clamp-2 leading-relaxed">
                  {product.shortDescription}
                </p>

                {/* Color selector */}
                {product.colors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-surface-500 mb-2">Color: {selectedColor}</p>
                    <div className="flex gap-2">
                      {product.colors.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => setSelectedColor(c.name)}
                          className={cn(
                            'h-8 w-8 rounded-full border-2 transition-all',
                            selectedColor === c.name ? 'border-surface-900 dark:border-white scale-110' : 'border-transparent hover:scale-105'
                          )}
                          style={{ backgroundColor: c.hex }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Quantity + Add to Cart */}
                <div className="mt-auto pt-6">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-0.5 rounded-xl border-2 border-surface-200 dark:border-surface-700">
                      <button
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="h-10 w-10 flex items-center justify-center text-surface-500 hover:text-surface-900 dark:hover:text-surface-100"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{quantity}</span>
                      <button
                        onClick={() => setQuantity(Math.min(10, quantity + 1))}
                        className="h-10 w-10 flex items-center justify-center text-surface-500 hover:text-surface-900 dark:hover:text-surface-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <Button onClick={handleAddToCart} disabled={!product.inStock} className="flex-1">
                      <ShoppingCart className="h-4 w-4" />
                      Add to Cart
                    </Button>

                    <button
                      onClick={() => toggleWishlist(product.id)}
                      className={cn(
                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-200',
                        isWishlisted
                          ? 'border-red-200 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-900/20'
                          : 'border-surface-200 text-surface-400 hover:text-red-500 hover:border-red-200 dark:border-surface-700'
                      )}
                    >
                      <Heart className={cn('h-5 w-5 transition-all', isWishlisted && 'fill-current scale-110')} />
                    </button>
                  </div>

                  <Link
                    to={`/products/${product.id}`}
                    onClick={onClose}
                    className="block mt-3 text-center text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    View Full Details
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
