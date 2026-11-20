import { CalendarClock } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { useNow } from './hooks'
import { countdownText, formatDropDate } from './storefront-utils'

/**
 * Scheduled drop: shown only while availableFrom is in the future. The
 * countdown runs from the real timestamp and the badge disappears at that time.
 */
export function DropBadge({
  availableFrom,
  shop,
  variant = 'chip',
  className,
}: {
  availableFrom: string | null
  shop: Pick<PublicShop, 'locale' | 'timezone'>
  variant?: 'chip' | 'block'
  className?: string
}) {
  const now = useNow(1000)
  if (!availableFrom) return null
  const at = Date.parse(availableFrom)
  if (Number.isNaN(at) || at <= now) return null
  const left = at - now

  if (variant === 'block') {
    return (
      <div className={cn('flex items-start gap-3 rounded-lg border border-line bg-panel p-3.5 text-ink', className)}>
        <CalendarClock className="mt-0.5 size-[18px] shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Available from {formatDropDate(availableFrom, shop)}</p>
          <p className="mt-0.5 text-sm text-ink-2">
            Drops in <span className="font-medium text-ink tnum">{countdownText(left)}</span>. You can order once it drops.
          </p>
        </div>
      </div>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md bg-panel/95 px-1.5 text-[11px] font-medium whitespace-nowrap text-ink ring-1 ring-line',
        className,
      )}
    >
      <CalendarClock className="size-3.5 text-ink-3" aria-hidden />
      Drops {formatDropDate(availableFrom, shop, false)}
      {left < 86_400_000 && <span className="text-ink-2 tnum">· {countdownText(left)}</span>}
    </span>
  )
}
