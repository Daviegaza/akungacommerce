import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { CHANNEL_LABEL, type OrderSummary } from '@/gateway/types'
import { useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money, OrderStatusBadge, PaymentStateBadge, When, paymentStateOf } from '../ui/format'
import { Input, Skeleton, buttonClass } from '../ui/primitives'
import { cn } from '@/lib/utils'

type Filter = 'open' | 'attention' | 'unpaid' | 'done' | 'cancelled' | 'all'

const FILTERS: { id: Filter; label: string; test: (o: OrderSummary) => boolean }[] = [
  { id: 'open', label: 'Open', test: (o) => ['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched'].includes(o.status) },
  { id: 'attention', label: 'Needs confirming', test: (o) => o.status === 'pending_confirmation' || o.status === 'draft' },
  { id: 'unpaid', label: 'Balance due', test: (o) => !['draft', 'cancelled'].includes(o.status) && o.netPaidMinor < o.totalMinor },
  { id: 'done', label: 'Completed', test: (o) => o.status === 'delivered' || o.status === 'refunded' },
  { id: 'cancelled', label: 'Cancelled', test: (o) => o.status === 'cancelled' },
  { id: 'all', label: 'All', test: () => true },
]

export default function OrdersPage() {
  const orders = useOrders()
  const { can } = useOrg()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>
    for (const f of FILTERS) out[f.id] = (orders.data ?? []).filter(f.test).length
    return out
  }, [orders.data])

  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test
    const needle = q.trim().toLowerCase().replace(/^#/, '')
    return (orders.data ?? []).filter(test).filter((o) => {
      if (!needle) return true
      return (
        String(o.number).includes(needle) ||
        (o.customerName ?? '').toLowerCase().includes(needle) ||
        (o.customerPhone ?? '').includes(needle.replace(/\s/g, ''))
      )
    })
  }, [orders.data, filter, q])

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order, whichever channel it came from."
        actions={
          can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('primary')}>
              <Plus className="size-4" aria-hidden /> New order
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Filter orders" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors',
                filter === f.id ? 'bg-primary text-on-primary' : 'text-ink-2 hover:bg-sunken',
              )}
            >
              {f.label}
              <span className={cn('tnum text-xs', filter === f.id ? 'opacity-70' : 'text-ink-3')}>{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative block lg:w-72">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, customer or phone" className="pl-9" />
        </label>
      </div>

      {orders.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : orders.isError ? (
        <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={orders.data.length === 0 ? 'No orders yet' : 'Nothing matches'}
          body={
            orders.data.length === 0
              ? 'Capture your first order from a chat, a call or a walk-in customer. Prices and stock come from your catalogue.'
              : 'Try another filter or clear the search.'
          }
          action={
            orders.data.length === 0 && can('orders.create') ? (
              <Link to="/app/orders/new" className={buttonClass('primary')}>
                New order
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Placed</Th>
                  <Th>Customer</Th>
                  <Th>Channel</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer hover:bg-sunken/60"
                    onClick={() => navigate(`/app/orders/${o.id}`)}
                  >
                    <Td>
                      <Link to={`/app/orders/${o.id}`} className="tnum font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                        #{o.number}
                      </Link>
                    </Td>
                    <Td className="text-ink-2">
                      <When iso={o.createdAt} />
                    </Td>
                    <Td className="max-w-[220px] truncate">{o.customerName ?? <span className="text-ink-3">Walk-in</span>}</Td>
                    <Td className="text-ink-2">{CHANNEL_LABEL[o.channel]}</Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td>{o.status !== 'draft' && o.status !== 'cancelled' && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}</Td>
                    <Td align="right" className="font-medium">
                      <Money minor={o.totalMinor} currency={o.currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {rows.map((o) => (
              <li key={o.id}>
                <Link to={`/app/orders/${o.id}`} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-ink">
                      <span className="tnum">#{o.number}</span> · {o.customerName ?? 'Walk-in'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      <When iso={o.createdAt} /> · {CHANNEL_LABEL[o.channel]}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      {o.status !== 'draft' && o.status !== 'cancelled' && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}
                    </div>
                  </div>
                  <Money minor={o.totalMinor} currency={o.currency} className="text-[15px] font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
