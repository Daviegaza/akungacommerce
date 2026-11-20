import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Real rating only: null means no verified reviews yet, so render nothing. */
export function RatingStars({
  rating,
  count,
  size = 'sm',
  className,
}: {
  rating: number | null | undefined
  count?: number
  size?: 'sm' | 'md'
  className?: string
}) {
  if (rating === null || rating === undefined) return null
  const r = Math.max(0, Math.min(5, rating))
  const icon = size === 'md' ? 'size-4' : 'size-3.5'
  const text = size === 'md' ? 'text-sm' : 'text-xs'
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="relative inline-flex" aria-hidden>
        <span className="flex text-line-strong">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className={cn(icon, 'shrink-0 fill-current')} strokeWidth={0} />
          ))}
        </span>
        <span className="absolute inset-y-0 left-0 flex overflow-hidden text-mango" style={{ width: `${(r / 5) * 100}%` }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className={cn(icon, 'shrink-0 fill-current')} strokeWidth={0} />
          ))}
        </span>
      </span>
      <span className={cn('font-medium text-ink tnum', text)} aria-hidden>
        {r.toFixed(1)}
      </span>
      {count !== undefined && (
        <span className={cn('text-ink-3 tnum', text)} aria-hidden>
          ({count})
        </span>
      )}
      <span className="sr-only">
        Rated {r.toFixed(1)} out of 5{count !== undefined ? ` from ${count} verified reviews` : ''}
      </span>
    </span>
  )
}
