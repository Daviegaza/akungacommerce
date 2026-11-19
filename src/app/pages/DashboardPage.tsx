import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { businessDate } from '@/domain/locale'
import { available, stockHealth } from '@/domain/inventory'
import { totalsByCurrency, money } from '@/domain/money'
import { useOrders, useOrg, useProducts } from '../context'
import { ErrorNotice, PageHeader, Section, Stat } from '../ui/layout'
import { Money, OrderStatusBadge, When } from '../ui/format'
import { Skeleton } from '../ui/primitives'

const LIVE = ['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched']

export default function DashboardPage() {
  const { org } = useOrg()
  const orders = useOrders()
  const products = useProducts()
  const [now] = useState(() => new Date().toISOString())
  const today = businessDate(now, org.timezone)

  const view = useMemo(() => {
    const list = orders.data ?? []
    const counted = list.filter((o) => o.status !== 'draft' && o.status !== 'cancelled')
    const todays = counted.filter((o) => businessDate(o.createdAt, org.timezone) === today)
    return {
      todaysCount: todays.length,
      todaysSales: [...totalsByCurrency(todays.map((o) => money(o.totalMinor, o.currency))).values()],
      awaiting: list.filter((o) => o.status === 'pending_confirmation' || o.status === 'draft'),
      toPrepare: list.filter((o) => o.status === 'confirmed' || o.status === 'preparing'),
      ready: list.filter((o) => o.status === 'ready'),
      balanceDue: counted.filter((o) => o.netPaidMinor < o.totalMinor && o.status !== 'refunded'),
      outstanding: [
        ...totalsByCurrency(
          counted.filter((o) => o.status !== 'refunded').map((o) => money(Math.max(o.totalMinor - o.netPaidMinor, 0), o.currency)),
        ).values(),
      ].filter((m) => m.amountMinor > 0),
      open: list.filter((o) => LIVE.includes(o.status)).length,
      recent: list.slice(0, 6),
    }
  }, [orders.data, org.timezone, today])

  const lowStock = useMemo(
    () =>
      (products.data ?? [])
        .filter((p) => p.status === 'active' && p.trackStock)
        .flatMap((p) => p.variants.filter((v) => v.isActive).map((v) => ({ p, v, health: stockHealth(v, v.lowStockThreshold) })))
        .filter((x) => x.health !== 'ok')
        .sort((a, b) => available(a.v) - available(b.v)),
    [products.data],
  )

  const greeting = new Intl.DateTimeFormat(org.locale, { timeZone: org.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(now))

  if (orders.isError) return <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />

  return (
    <>
      <PageHeader title="Today" description={`${greeting} · ${org.name}`} />

      {orders.isPending ? (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <div className="mb-10 grid grid-cols-2 gap-x-6 gap-y-6 border-b border-line pb-8 sm:grid-cols-4">
          <Stat
            label="Sales today"
            value={view.todaysSales.length ? view.todaysSales.map((m) => <Money key={m.currency} minor={m.amountMinor} currency={m.currency} className="block" />) : <Money minor={0} currency={org.baseCurrency} />}
            foot={`${view.todaysCount} ${view.todaysCount === 1 ? 'order' : 'orders'}`}
          />
          <Stat label="Open orders" value={view.open} foot="Not yet delivered" />
          <Stat
            label="Outstanding"
            value={view.outstanding.length ? view.outstanding.map((m) => <Money key={m.currency} minor={m.amountMinor} currency={m.currency} className="block" />) : <Money minor={0} currency={org.baseCurrency} />}
            foot={`${view.balanceDue.length} with balance due`}
          />
          <Stat label="Stock alerts" value={products.isPending ? '—' : lowStock.length} foot="Low or out of stock" />
        </div>
      )}

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Queue title="Needs confirming" empty="Nothing waiting for confirmation." orders={view.awaiting} />
        <Queue title="To prepare" empty="Nothing to prepare right now." orders={view.toPrepare} />
        <Queue title="Ready for pickup or dispatch" empty="Nothing is waiting to leave." orders={view.ready} />
        <Section
          title="Stock alerts"
          actions={
            <Link to="/app/inventory" className="text-xs font-medium text-ink-2 hover:text-ink">
              Inventory
            </Link>
          }
        >
          {lowStock.length === 0 ? (
            <p className="py-2 text-sm text-ink-3">All tracked items are above their low-stock level.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lowStock.slice(0, 6).map(({ p, v, health }) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {p.name}
                    {v.name !== 'Default' && <span className="text-ink-3"> · {v.name}</span>}
                  </span>
                  <span className={health === 'out' ? 'font-medium text-neg' : 'font-medium text-warn'}>
                    {health === 'out' ? 'Out of stock' : `${available(v)} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Latest orders"
        actions={
          <Link to="/app/orders" className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
            All orders <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      >
        {view.recent.length === 0 ? (
          <p className="py-2 text-sm text-ink-3">
            No orders yet. <Link to="/app/orders/new" className="font-medium text-ink underline">Create the first one</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {view.recent.map((o) => (
              <li key={o.id}>
                <Link to={`/app/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-sunken/50">
                  <span className="min-w-0 truncate">
                    <span className="tnum font-medium">#{o.number}</span> · {o.customerName ?? 'Walk-in'}
                    <span className="ml-2 text-xs text-ink-3">
                      <When iso={o.createdAt} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="hidden sm:inline">
                      <OrderStatusBadge status={o.status} />
                    </span>
                    <Money minor={o.totalMinor} currency={o.currency} className="font-medium" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function Queue({ title, empty, orders }: { title: string; empty: string; orders: { id: string; number: number; customerName: string | null; totalMinor: number; currency: string; createdAt: string }[] }) {
  return (
    <Section title={`${title}${orders.length ? ` · ${orders.length}` : ''}`}>
      {orders.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {orders.slice(0, 5).map((o) => (
            <li key={o.id}>
              <Link to={`/app/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-sunken/50">
                <span className="min-w-0 truncate">
                  <span className="tnum font-medium">#{o.number}</span> · {o.customerName ?? 'Walk-in'}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-ink-3">
                  <When iso={o.createdAt} className="hidden text-xs sm:inline" />
                  <Money minor={o.totalMinor} currency={o.currency} className="font-medium text-ink" />
                </span>
              </Link>
            </li>
          ))}
          {orders.length > 5 && (
            <li className="py-2 text-xs">
              <Link to="/app/orders" className="text-ink-2 hover:text-ink">
                +{orders.length - 5} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </Section>
  )
}
