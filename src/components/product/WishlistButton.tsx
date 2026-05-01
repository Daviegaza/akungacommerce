import { Heart } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWishlistStore } from '@/store/wishlistStore'
import { cn } from '@/lib/utils'

interface WishlistButtonProps {
  productId: string
  productName: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

const iconSizes = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

export function WishlistButton({ productId, productName, className, size = 'md' }: WishlistButtonProps) {
  const hasItem = useWishlistStore((s) => s.hasItem)
  const toggleItem = useWishlistStore((s) => s.toggleItem)
  const isWishlisted = hasItem(productId)

  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleItem(productId)
      }}
      className={cn(
        'relative flex items-center justify-center rounded-xl transition-all duration-200',
        isWishlisted
          ? 'text-red-500 hover:text-red-600 bg-red-50 dark:bg-red-900/20'
          : 'text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20',
        sizeClasses[size],
        className
      )}
      aria-label={isWishlisted ? `Remove ${productName} from wishlist` : `Add ${productName} to wishlist`}
    >
      <motion.div
        animate={{ scale: isWishlisted ? 1 : 0.85 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        <Heart
          className={cn(
            iconSizes[size],
            'transition-all duration-300',
            isWishlisted && 'fill-current'
          )}
        />
      </motion.div>

      {/* Heart burst animation */}
      <AnimatePresence>
        {isWishlisted && (
          <motion.div
            key="burst"
            initial={{ opacity: 1, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 rounded-full bg-red-500/20"
          />
        )}
      </AnimatePresence>
    </button>
  )
}
