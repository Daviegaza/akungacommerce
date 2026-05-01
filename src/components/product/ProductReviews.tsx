import { Star, ThumbsUp, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Review } from '@/types'
import { Avatar } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { getRatingStars, formatRelativeDate } from '@/lib/utils'

interface ProductReviewsProps {
  reviews: Review[]
  rating: number
  reviewCount: number
}

export function ProductReviews({ reviews, rating, reviewCount }: ProductReviewsProps) {
  const { filled, half, empty } = getRatingStars(rating)

  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => Math.floor(r.rating) === star).length
    return { star, count, percent: reviews.length > 0 ? (count / reviews.length) * 100 : 0 }
  })

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-surface-900 dark:text-white">Customer Reviews</h2>

      <div className="grid sm:grid-cols-2 gap-8">
        {/* Summary */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-5xl font-black text-surface-900 dark:text-white">{rating}</div>
            <div className="flex items-center justify-center gap-0.5 mt-1">
              {[...Array(filled)].map((_, i) => (
                <Star key={`s-${i}`} className="h-4 w-4 fill-amber-400 text-amber-400" />
              ))}
              {half && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
              {[...Array(empty)].map((_, i) => (
                <Star key={`se-${i}`} className="h-4 w-4 text-surface-200 dark:text-surface-600" />
              ))}
            </div>
            <p className="text-xs text-surface-400 mt-1">{reviewCount.toLocaleString()} reviews</p>
          </div>
          <div className="flex-1 space-y-1.5">
            {distribution.map(({ star, percent }) => (
              <div key={star} className="flex items-center gap-2">
                <span className="text-xs font-medium text-surface-500 w-4">{star}</span>
                <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                <div className="flex-1 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${percent}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full bg-amber-400"
                  />
                </div>
                <span className="text-xs text-surface-400 w-8 text-right">
                  {Math.round(percent)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Separator />

      {/* Review list */}
      {reviews.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-surface-400 dark:text-surface-500">No reviews yet. Be the first to review this product.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {reviews.map((review, i) => (
            <motion.div
              key={review.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="rounded-2xl bg-surface-50 dark:bg-surface-800/50 p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={review.userAvatar}
                    alt={review.userName}
                    fallback={review.userName}
                    size="md"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                        {review.userName}
                      </span>
                      {review.isVerified && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-400">
                          <ShieldCheck className="h-3 w-3" />
                          Verified
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex">
                        {[...Array(5)].map((_, idx) => (
                          <Star
                            key={idx}
                            className={`h-3 w-3 ${idx < review.rating ? 'fill-amber-400 text-amber-400' : 'text-surface-200 dark:text-surface-600'}`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-surface-400">
                        {formatRelativeDate(review.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <h4 className="mt-3 text-sm font-semibold text-surface-900 dark:text-surface-100">
                {review.title}
              </h4>
              <p className="mt-1.5 text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
                {review.comment}
              </p>

              <button className="mt-3 inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors">
                <ThumbsUp className="h-3.5 w-3.5" />
                Helpful
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
