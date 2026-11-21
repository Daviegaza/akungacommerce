import { useState } from 'react'
import { Star, Check, ShoppingCart, Share2, Truck, Shield, RotateCcw } from 'lucide-react'
import type { Product } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { WishlistButton } from '@/components/product/WishlistButton'
import { useCartStore } from '@/store/cartStore'
import { useToastStore } from '@/store/toastStore'
import { formatPrice, calculateDiscount, getRatingStars } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface ProductInfoProps {
  product: Product
}

export function ProductInfo({ product }: ProductInfoProps) {
  const [selectedColor, setSelectedColor] = useState(product.colors[0]?.name || '')
  const [selectedSize, setSelectedSize] = useState('')
  const [quantity, setQuantity] = useState(1)

  const addItem = useCartStore((s) => s.addItem)
  const openCart = useCartStore((s) => s.openCart)
  const toast = useToastStore((s) => s.success)

  const discount = product.compareAtPrice ? calculateDiscount(product.price, product.compareAtPrice) : 0
  const { filled, half, empty } = getRatingStars(product.rating)

  const handleAddToCart = () => {
    addItem({
      productId: product.id,
      name: product.name,
      image: product.images[0],
      price: product.price,
      color: selectedColor,
      size: selectedSize,
      quantity,
    })
    toast('Added to cart', `${product.name} × ${quantity}`)
  }

  const handleBuyNow = () => {
    handleAddToCart()
    openCart()
  }

  return (
    <div className="space-y-6">
      {/* Category + badges */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-widest">
          {product.category}
        </span>
        <div className="flex gap-1.5">
          {product.isNewArrival && <Badge variant="new">New</Badge>}
          {discount > 0 && <Badge variant="sale">Save {discount}%</Badge>}
          {!product.inStock && <Badge variant="danger">Out of Stock</Badge>}
        </div>
      </div>

      {/* Title */}
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-surface-900 dark:text-white leading-tight">
        {product.name}
      </h1>

      {/* Rating */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {[...Array(filled)].map((_, i) => (
            <Star key={`f-${i}`} className="h-4 w-4 fill-amber-400 text-amber-400" />
          ))}
          {half && <Star className="h-4 w-4 fill-amber-400 text-amber-400" style={{ clipPath: 'inset(0 50% 0 0)' }} />}
          {[...Array(empty)].map((_, i) => (
            <Star key={`e-${i}`} className="h-4 w-4 text-surface-200 dark:text-surface-600" />
          ))}
        </div>
        <span className="text-sm font-semibold text-surface-700 dark:text-surface-300">
          {product.rating}
        </span>
        <span className="text-sm text-surface-400">
          ({product.reviewCount.toLocaleString()} reviews)
        </span>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-surface-900 dark:text-white">
          {formatPrice(product.price)}
        </span>
        {product.compareAtPrice && (
          <>
            <span className="text-xl text-surface-400 line-through">
              {formatPrice(product.compareAtPrice)}
            </span>
            <span className="text-sm font-bold text-red-600 dark:text-red-400">
              Save {formatPrice(product.compareAtPrice - product.price)}
            </span>
          </>
        )}
      </div>

      {/* Short description */}
      <p className="text-surface-500 dark:text-surface-400 leading-relaxed">
        {product.shortDescription}
      </p>

      <Separator />

      {/* Color selector */}
      {product.colors.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
            Color — <span className="text-surface-500 font-normal">{selectedColor}</span>
          </h4>
          <div className="flex gap-3">
            {product.colors.map((color) => (
              <button
                key={color.name}
                onClick={() => setSelectedColor(color.name)}
                className={cn(
                  'relative h-10 w-10 rounded-full transition-all duration-200',
                  selectedColor === color.name && 'ring-2 ring-offset-2 ring-brand-600 dark:ring-brand-400 ring-offset-white dark:ring-offset-surface-900'
                )}
                style={{ backgroundColor: color.hex }}
                title={color.name}
              >
                {selectedColor === color.name && (
                  <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-md" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Size selector */}
      {product.sizes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
            Size — <span className="text-surface-500 font-normal">{selectedSize || 'Select'}</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((size) => (
              <button
                key={size}
                onClick={() => setSelectedSize(size)}
                className={cn(
                  'h-10 min-w-[3rem] rounded-xl border-2 px-4 text-sm font-medium transition-all duration-200',
                  selectedSize === size
                    ? 'border-surface-900 bg-surface-900 text-white dark:border-white dark:bg-white dark:text-surface-900'
                    : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600'
                )}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantity */}
      <div>
        <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Quantity</h4>
        <div className="inline-flex items-center rounded-xl border-2 border-surface-200 dark:border-surface-700">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="h-10 w-10 flex items-center justify-center text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-semibold text-surface-900 dark:text-surface-100">
            {quantity}
          </span>
          <button
            onClick={() => setQuantity(Math.min(10, quantity + 1))}
            className="h-10 w-10 flex items-center justify-center text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          size="xl"
          onClick={handleAddToCart}
          disabled={!product.inStock}
          className="flex-1"
        >
          <ShoppingCart className="h-5 w-5" />
          Add to Cart
        </Button>
        <Button
          size="xl"
          variant="accent"
          onClick={handleBuyNow}
          disabled={!product.inStock}
          className="flex-1"
        >
          Buy Now
        </Button>
        <WishlistButton productId={product.id} productName={product.name} size="lg" className="shrink-0 rounded-xl" />
        <Button size="xl" variant="ghost" className="shrink-0">
          <Share2 className="h-5 w-5" />
        </Button>
      </div>

      {/* Perks */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: Truck, label: 'Free shipping over $75' },
          { icon: RotateCcw, label: '30-day easy returns' },
          { icon: Shield, label: '2-year warranty' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl bg-surface-50 dark:bg-surface-800/50 px-3 py-2.5">
            <Icon className="h-4 w-4 text-surface-400 shrink-0" />
            <span className="text-xs text-surface-500 dark:text-surface-400">{label}</span>
          </div>
        ))}
      </div>

      {/* Features */}
      <div className="rounded-2xl bg-surface-50 dark:bg-surface-800/50 p-5">
        <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Key Features</h4>
        <ul className="space-y-2">
          {product.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
