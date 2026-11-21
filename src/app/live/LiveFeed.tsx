import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, BellRing, ShoppingBag, Truck, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '../ui/layout'
import { Skeleton } from '../ui/primitives'
import { RelativeTime } from '../ui/format'
import type { FeedItem, FeedKind } from './feed'

const KIND: Record<FeedKind, { icon: typeof ShoppingBag; className: string }> = {
  order: { icon: ShoppingBag, className: 'text-brand' },
  status: { icon: Truck, className: 'text-ink-2' },
  payment: { icon: Banknote, className: 'text-pos' },
  reversal: { icon: Undo2, className: 'text-neg' },
  stock: { icon: AlertTriangle, className: 'text-warn' },
}

function FeedIcon({ item }: { item: FeedItem }) {
  const k = KIND[item.kind]
  const Icon = k.icon
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel', k.className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  )
}

/** Activity rows with icon/avatar, title, detail and a relative time. */
export function FeedList({
  items,
  loading,
  onNavigate,
  unreadAfter,
  emptyText = 'Nothing has happened yet. New orders, payments and stock alerts will appear here as they happen.',
}: {
  items: FeedItem[]
  loading?: boolean
  onNavigate?: () => void
  /** Items newer than this ISO time get a "new" dot. */
  unreadAfter?: string | null
  emptyText?: string
}) {
  if (loading) {
    return (
      <ul className="flex flex-col divide-y divide-line" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-8" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    )
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg border border-line text-ink-3">
          <BellRing className="size-5" aria-hidden />
        </span>
        <p className="max-w-xs text-sm text-ink-3">{emptyText}</p>
      </div>
    )
  }
  return (
    <ol className="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const unread = unreadAfter != null && item.at > unreadAfter
        return (
          <li key={item.id}>
            <Link
              to={item.href}
              onClick={onNavigate}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-sunken focus-visible:bg-sunken"
            >
              <FeedIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{item.title}</span>
                  {unread && <span className="size-2 shrink-0 rounded-full bg-brand" role="img" aria-label="New" />}
                </span>
                <span className="block truncate text-xs text-ink-3">{item.detail}</span>
              </span>
              <RelativeTime iso={item.at} className="tnum shrink-0 text-xs text-ink-3" />
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

export function LiveFeedSheet({
  open,
  onOpenChange,
  items,
  loading,
  unreadAfter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: FeedItem[]
  loading?: boolean
  unreadAfter?: string | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Activity" description="Orders, payments and stock as they happen. Checks for new orders every 20 seconds.">
      <FeedList items={items} loading={loading} unreadAfter={unreadAfter} onNavigate={() => onOpenChange(false)} />
    </Sheet>
  )
}
