import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, Star, Eye } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Product } from '@/types'
import { Badge } from '@/components/ui/badge'
import { LazyImage } from '@/components/shared/LazyImage'
import { WishlistButton } from '@/components/product/WishlistButton'
import { QuickView } from '@/components/product/QuickView'
import { useCartStore } from '@/store/cartStore'
import { useAddToCart } from '@/hooks/useAnalytics'
import { useToastStore } from '@/store/toastStore'
import { formatPrice, calculateDiscount } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface ProductCardProps {
  product: Product
  className?: string
}

export function ProductCard({ product, className }: ProductCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [quickViewOpen, setQuickViewOpen] = useState(false)
  const addItem = useCartStore((s) => s.addItem)
  const trackAddToCart = useAddToCart()
  const toast = useToastStore((s) => s.success)

  const discount = product.compareAtPrice ? calculateDiscount(product.price, product.compareAtPrice) : 0

  const handleAddToCart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      addItem({
        productId: product.id,
        name: product.name,
        image: product.images[0],
        price: product.price,
        color: product.colors[0]?.name || 'Default',
        size: product.sizes[0] || '',
        quantity: 1,
      })
      trackAddToCart(product.id, product.name, product.price, 1)
      toast('Added to cart', product.name)
    },
    [product, addItem, trackAddToCart, toast]
  )

  const handleQuickView = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setQuickViewOpen(true)
  }

  return (
    <>
      <Link
        to={`/products/${product.id}`}
        className={cn('group block', className)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative overflow-hidden rounded-2xl bg-surface-100 dark:bg-surface-800 aspect-square mb-4">
          <LazyImage
            src={product.images[0]}
            alt={product.name}
            className={cn(
              'transition-transform duration-700',
              isHovered && 'scale-110'
            )}
            containerClassName="h-full w-full"
          />

          {/* Badges */}
          <div className="absolute top-3 left-3 flex flex-col gap-1.5">
            {product.isNewArrival && <Badge variant="new">New</Badge>}
            {discount > 0 && <Badge variant="sale">-{discount}%</Badge>}
          </div>

          {/* Wishlist */}
          <div className="absolute top-3 right-3">
            <WishlistButton productId={product.id} productName={product.name} size="sm" />
          </div>

          {!product.inStock && (
            <div className="absolute inset-0 bg-white/60 dark:bg-surface-900/60 flex items-center justify-center backdrop-blur-sm">
              <Badge variant="danger" className="px-4 py-2 text-sm font-semibold">Out of Stock</Badge>
            </div>
          )}

          {/* Quick actions overlay */}
          <motion.div
            initial={false}
            animate={{ opacity: isHovered ? 1 : 0, y: isHovered ? 0 : 8 }}
            className="absolute bottom-3 right-3 flex flex-col gap-2"
          >
            <button
              onClick={handleAddToCart}
              disabled={!product.inStock}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-surface-800 shadow-lg text-surface-700 dark:text-surface-200 hover:text-brand-600 dark:hover:text-brand-400 hover:scale-110 transition-all duration-200"
              aria-label="Add to cart"
            >
              <ShoppingCart className="h-4 w-4" />
            </button>
            <button
              onClick={handleQuickView}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-surface-800 shadow-lg text-surface-700 dark:text-surface-200 hover:text-brand-600 dark:hover:text-brand-400 hover:scale-110 transition-all duration-200"
              aria-label="Quick view"
            >
              <Eye className="h-4 w-4" />
            </button>
          </motion.div>
        </div>

        {/* Info */}
        <div>
          <p className="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-1">
            {product.category}
          </p>
          <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
            {product.name}
          </h3>

          <div className="flex items-center gap-1 mt-1.5">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
              {product.rating}
            </span>
            <span className="text-xs text-surface-400">({product.reviewCount.toLocaleString()})</span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-lg font-bold text-surface-900 dark:text-white">
              {formatPrice(product.price)}
            </span>
            {product.compareAtPrice && (
              <span className="text-sm text-surface-400 line-through">
                {formatPrice(product.compareAtPrice)}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Quick View Modal */}
      <QuickView
        product={product}
        isOpen={quickViewOpen}
        onClose={() => setQuickViewOpen(false)}
      />
    </>
  )
}
