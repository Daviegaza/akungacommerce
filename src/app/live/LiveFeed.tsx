import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, BellRing, ShoppingBag, Truck, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '../ui/layout'
import { Avatar, Skeleton } from '../ui/primitives'
import { RelativeTime } from '../ui/format'
import type { FeedItem, FeedKind } from './feed'

const KIND: Record<FeedKind, { icon: typeof ShoppingBag; className: string }> = {
  order: { icon: ShoppingBag, className: 'bg-brand text-on-brand' },
  status: { icon: Truck, className: 'bg-info-soft text-info' },
  payment: { icon: Banknote, className: 'bg-pos-soft text-pos' },
  reversal: { icon: Undo2, className: 'bg-neg-soft text-neg' },
  stock: { icon: AlertTriangle, className: 'bg-warn-soft text-warn' },
}

function FeedIcon({ item }: { item: FeedItem }) {
  const k = KIND[item.kind]
  const Icon = k.icon
  if (item.person) {
    return (
      <span className="relative shrink-0">
        <Avatar name={item.person} size={40} />
        <span className={cn('absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-2 ring-panel', k.className)} aria-hidden>
          <Icon className="size-3" />
        </span>
      </span>
    )
  }
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', k.className)} aria-hidden>
      <Icon className="size-[18px]" />
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
      <ul className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
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
        <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <BellRing className="size-5" aria-hidden />
        </span>
        <p className="max-w-xs text-sm text-ink-3">{emptyText}</p>
      </div>
    )
  }
  return (
    <ol className="-mx-2 flex flex-col">
      {items.map((item, i) => {
        const unread = unreadAfter != null && item.at > unreadAfter
        return (
          <li key={item.id} className="ak-rise" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
            <Link
              to={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-sunken focus-visible:bg-sunken"
            >
              <FeedIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{item.title}</span>
                  {unread && <span className="size-2 shrink-0 rounded-full bg-brand" role="img" aria-label="New" />}
                </span>
                <span className="block truncate text-xs text-ink-3">{item.detail}</span>
              </span>
              <RelativeTime iso={item.at} className="shrink-0 text-xs font-medium text-ink-3" />
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
