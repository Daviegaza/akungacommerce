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
      <div className={cn('flex items-start gap-3 rounded-2xl bg-mango-soft p-4 text-ink', className)}>
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Available from {formatDropDate(availableFrom, shop)}</p>
          <p className="text-sm text-ink-2">
            Drops in <span className="font-semibold tnum">{countdownText(left)}</span>. You can order once it drops.
          </p>
        </div>
      </div>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full bg-mango px-2 text-[11px] font-bold whitespace-nowrap text-on-mango shadow-sm',
        className,
      )}
    >
      <CalendarClock className="size-3.5" aria-hidden />
      Drops {formatDropDate(availableFrom, shop, false)}
      {left < 86_400_000 && <span className="font-semibold tnum opacity-80">· {countdownText(left)}</span>}
    </span>
  )
}
