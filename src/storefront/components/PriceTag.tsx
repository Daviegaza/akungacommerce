import { cn } from '@/lib/utils'
import { discountPercent, fmtMoney } from './storefront-utils'

/** Bold display price; "was" price + mango chip only for a real compare-at above the price. */
export function PriceTag({
  priceMinor,
  compareAtMinor,
  currency,
  locale,
  from,
  size = 'md',
  className,
}: {
  priceMinor: number
  compareAtMinor: number | null
  currency: string
  locale?: string
  from?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const pct = discountPercent(priceMinor, compareAtMinor)
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <span
        className={cn(
          'font-display font-extrabold tracking-tight text-ink tnum',
          size === 'sm' && 'text-base',
          size === 'md' && 'text-lg',
          size === 'lg' && 'text-3xl',
        )}
      >
        {from && <span className="mr-1 font-body text-xs font-medium text-ink-3">From</span>}
        {fmtMoney(priceMinor, currency, locale)}
      </span>
      {pct !== null && compareAtMinor !== null && (
        <>
          <span className={cn('text-ink-3 line-through tnum', size === 'lg' ? 'text-base' : 'text-xs')}>
            <span className="sr-only">was </span>
            {fmtMoney(compareAtMinor, currency, locale)}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-md bg-mango px-1.5 font-bold text-on-mango tnum',
              size === 'lg' ? 'h-6 text-sm' : 'h-5 text-[11px]',
            )}
          >
            −{pct}%
          </span>
        </>
      )}
    </div>
  )
}
