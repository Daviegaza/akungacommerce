import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Receipt, Search, Store, Truck } from 'lucide-react'
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS, type OrderStatus } from '@/domain/orders'
import { formatPhone } from '@/domain/locale'
import { CHANNEL_LABEL, type OrderSummary } from '@/gateway/types'
import { cn } from '@/lib/utils'
import { useAction, useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money, OrderStatusBadge, PaymentStateBadge, RelativeTime, paymentStateOf } from '../ui/format'
import { Button, Input, PillTabs, Skeleton, buttonClass, type PillTab } from '../ui/primitives'

type TabId = 'confirm' | 'pack' | 'ready' | 'out' | 'completed' | 'cancelled' | 'all'

const TABS: { id: TabId; label: string; test: (o: OrderSummary) => boolean }[] = [
  { id: 'confirm', label: 'To confirm', test: (o) => o.status === 'pending_confirmation' || o.status === 'draft' },
  { id: 'pack', label: 'To pack', test: (o) => o.status === 'confirmed' || o.status === 'preparing' },
  { id: 'ready', label: 'Ready', test: (o) => o.status === 'ready' },
  { id: 'out', label: 'Out for delivery', test: (o) => o.status === 'dispatched' },
  { id: 'completed', label: 'Completed', test: (o) => o.status === 'delivered' || o.status === 'refunded' },
  { id: 'cancelled', label: 'Cancelled', test: (o) => o.status === 'cancelled' },
  { id: 'all', label: 'All', test: () => true },
]
const TAB_IDS = new Set<string>(TABS.map((t) => t.id))

interface NextStep {
  to: OrderStatus
  label: string
}

/**
 * The single forward step offered for an order, taken from ORDER_TRANSITIONS
 * (never `cancelled`; cancelling stays on the order page where it can be explained).
 * Mirrors the Fulfilment queue.
 */
function nextStepFor(o: Pick<OrderSummary, 'status' | 'fulfilmentMethod'>): NextStep | null {
  const forward = ORDER_TRANSITIONS[o.status].filter((s) => s !== 'cancelled')
  if (forward.length === 0) return null
  let to = forward[0]
  if (o.status === 'draft' && forward.includes('confirmed')) to = 'confirmed'
  if (o.status === 'ready') {
    const wanted: OrderStatus = o.fulfilmentMethod === 'pickup' ? 'delivered' : 'dispatched'
    if (forward.includes(wanted)) to = wanted
  }
  return { to, label: labelFor(o, to) }
}

function labelFor(o: Pick<OrderSummary, 'status' | 'fulfilmentMethod'>, to: OrderStatus): string {
  switch (to) {
    case 'confirmed':
      return 'Confirm'
    case 'preparing':
      return 'Start packing'
    case 'ready':
      return 'Mark ready'
    case 'dispatched':
      return 'Dispatch'
    case 'delivered':
      return o.status === 'ready' && o.fulfilmentMethod === 'pickup' ? 'Mark collected' : 'Mark delivered'
    default:
      return 'Move on'
  }
}

type TransitionInput = { id: string; to: OrderStatus }

interface RowProps {
  o: OrderSummary
  allowed: boolean
  pendingTo: OrderStatus | undefined
  error: unknown
  onAdvance: (step: NextStep) => void
}

export default function OrdersPage() {
  const orders = useOrders()
  const { can } = useOrg()
  const allowed = can('orders.transition')
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const transition = useAction<TransitionInput>((g, o, { id, to }) => g.transitionOrder(o, id, to, null))
  const [pending, setPending] = useState<Record<string, OrderStatus>>({})
  const [errors, setErrors] = useState<Record<string, unknown>>({})

  const counts = useMemo(() => {
    const out = {} as Record<TabId, number>
    for (const t of TABS) out[t.id] = (orders.data ?? []).filter(t.test).length
    return out
  }, [orders.data])

  const param = params.get('tab')
  const tab: TabId = param && TAB_IDS.has(param) ? (param as TabId) : counts.confirm > 0 ? 'confirm' : 'all'
  const setTab = (id: TabId) => {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    const test = TABS.find((t) => t.id === tab)!.test
    const needle = q.trim().toLowerCase().replace(/^#/, '')
    return (orders.data ?? []).filter(test).filter((o) => {
      if (!needle) return true
      return (
        String(o.number).includes(needle) ||
        (o.customerName ?? '').toLowerCase().includes(needle) ||
        (o.customerPhone ?? '').includes(needle.replace(/\s/g, ''))
      )
    })
  }, [orders.data, tab, q])

  async function advance(o: OrderSummary, step: NextStep) {
    setPending((prev) => ({ ...prev, [o.id]: step.to }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[o.id]
      return next
    })
    try {
      await transition.mutateAsync({ id: o.id, to: step.to })
    } catch (err) {
      setErrors((prev) => ({ ...prev, [o.id]: err }))
    } finally {
      setPending((prev) => {
        const next = { ...prev }
        delete next[o.id]
        return next
      })
    }
  }

  const pillTabs: PillTab<TabId>[] = TABS.map((t) => ({ id: t.id, label: t.label, count: orders.isPending ? undefined : counts[t.id] }))
  const rowProps = (o: OrderSummary): RowProps => ({
    o,
    allowed,
    pendingTo: pending[o.id],
    error: errors[o.id],
    onAdvance: (step) => void advance(o, step),
  })

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order, whichever channel it came from. Move each one on with a tap."
        actions={
          can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('primary')}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden /> New order
            </Link>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-4">
        <PillTabs tabs={pillTabs} value={tab} onChange={setTab} label="Filter orders by status" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block sm:w-80">
            <span className="sr-only">Search orders</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, customer or phone" className="h-10 pl-10" />
          </label>
          {orders.isSuccess && orders.data.length > 0 && (
            <p className="tnum text-xs text-ink-3" aria-live="polite">
              {rows.length} {rows.length === 1 ? 'order' : 'orders'}
            </p>
          )}
        </div>
      </div>

      {!allowed && orders.isSuccess && orders.data.length > 0 && (
        <p className="mb-4 text-xs text-ink-3">Your role can see orders but cannot move them on. Ask an owner or manager to change your role.</p>
      )}

      {orders.isPending ? (
        <div aria-busy="true">
          <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel md:block">
            <div className="h-10 border-b border-line bg-sunken/50" />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-6 border-b border-line px-4 py-3.5 last:border-b-0">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
          <div className="divide-y divide-line border-y border-line md:hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-start justify-between gap-4 py-3.5">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : orders.isError ? (
        <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-5" aria-hidden />}
          title={orders.data.length === 0 ? 'No orders yet' : q.trim() ? 'Nothing matches' : `Nothing in ${TABS.find((t) => t.id === tab)!.label.toLowerCase()}`}
          body={
            orders.data.length === 0
              ? 'Capture your first order from a chat, a call or a walk-in customer, or share your shop link. Prices and stock come from your catalogue.'
              : q.trim()
                ? 'Try another tab or clear the search.'
                : 'All caught up here.'
          }
          action={
            orders.data.length === 0 && can('orders.create') ? (
              <Link to="/app/orders/new" className={buttonClass('primary', 'sm')}>
                New order
              </Link>
            ) : q.trim() ? (
              <Button size="sm" onClick={() => setQ('')}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Phones: compact divided list (first in the DOM, so phone-sized checks match the visible row). */}
          <ul className="-mx-4 divide-y divide-line border-y border-line sm:mx-0 md:hidden">
            {rows.map((o) => (
              <OrderListRow key={o.id} {...rowProps(o)} />
            ))}
          </ul>

          {/* Wide screens: dense queue table. */}
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">Orders</caption>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th className="hidden lg:table-cell">Channel</Th>
                  <Th className="hidden lg:table-cell">Fulfilment</Th>
                  <Th>Payment</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th align="right" className="hidden xl:table-cell">
                    Age
                  </Th>
                  <Th align="right">
                    <span className="sr-only">Next step</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <OrderTableRow key={o.id} {...rowProps(o)} />
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}

/* ───────────── Shared row bits ───────────── */

function rowState(o: OrderSummary, pendingTo: OrderStatus | undefined) {
  const step = nextStepFor(o)
  const shownStatus = pendingTo ?? o.status
  const showPayment = o.status !== 'draft' && o.status !== 'cancelled'
  const due = o.totalMinor - o.netPaidMinor
  const name = o.customerName ?? 'Walk-in customer'
  return { step, shownStatus, showPayment, due, name }
}

function AdvanceButton({ o, step, allowed, pendingTo, onAdvance, className }: Omit<RowProps, 'error'> & { step: NextStep; className?: string }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={Boolean(pendingTo)}
      disabled={!allowed}
      onClick={() => onAdvance(step)}
      aria-label={`${step.label}, order ${o.number}`}
      title={allowed ? undefined : 'Your role cannot move orders'}
      className={cn('relative z-10', className)}
    >
      {pendingTo ? `${ORDER_STATUS_LABEL[pendingTo]}…` : step.label}
    </Button>
  )
}

function FulfilmentText({ method }: { method: OrderSummary['fulfilmentMethod'] }) {
  const Icon = method === 'delivery' ? Truck : Store
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
      <Icon className="size-4 text-ink-3" aria-hidden />
      {method === 'delivery' ? 'Delivery' : 'Pickup'}
    </span>
  )
}

/* ───────────── Table row (md+) ───────────── */

function OrderTableRow({ o, allowed, pendingTo, error, onAdvance }: RowProps) {
  const { step, shownStatus, showPayment, due, name } = rowState(o, pendingTo)
  return (
    <>
      <tr className={cn('group relative transition-colors hover:bg-sunken/50', pendingTo && 'bg-sunken/40')}>
        <Td className="tnum font-medium whitespace-nowrap text-ink">#{o.number}</Td>
        <Td className="max-w-[240px]">
          <Link
            to={`/app/orders/${o.id}`}
            className="block truncate font-medium text-ink after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-brand focus-visible:after:ring-inset"
            aria-label={`Order ${o.number}, ${name}`}
          >
            {name}
          </Link>
          {o.customerPhone && <span className="tnum block truncate text-xs text-ink-3">{formatPhone(o.customerPhone)}</span>}
        </Td>
        <Td className="hidden whitespace-nowrap text-ink-2 lg:table-cell">{CHANNEL_LABEL[o.channel]}</Td>
        <Td className="hidden lg:table-cell">
          <FulfilmentText method={o.fulfilmentMethod} />
        </Td>
        <Td>{showPayment ? <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} /> : <span className="text-ink-3">—</span>}</Td>
        <Td>
          <span className={cn('transition-opacity', pendingTo && 'opacity-70')}>
            <OrderStatusBadge status={shownStatus} />
          </span>
        </Td>
        <Td align="right" className="whitespace-nowrap">
          <Money minor={o.totalMinor} currency={o.currency} className="font-medium text-ink" />
          {showPayment && due > 0 && o.netPaidMinor > 0 && (
            <span className="block text-xs text-ink-3">
              <Money minor={due} currency={o.currency} /> due
            </span>
          )}
        </Td>
        <Td align="right" className="hidden text-xs text-ink-3 xl:table-cell">
          <RelativeTime iso={o.createdAt} />
        </Td>
        <Td align="right" className="w-px whitespace-nowrap">
          {step && <AdvanceButton o={o} step={step} allowed={allowed} pendingTo={pendingTo} onAdvance={onAdvance} className="h-8 px-3" />}
        </Td>
      </tr>
      {error != null && (
        <tr>
          <td colSpan={9} className="border-b border-line px-4 py-2">
            <ErrorNotice error={error} />
          </td>
        </tr>
      )}
    </>
  )
}

/* ───────────── List row (phones) ───────────── */

function OrderListRow({ o, allowed, pendingTo, error, onAdvance }: RowProps) {
  const { step, shownStatus, showPayment, due, name } = rowState(o, pendingTo)
  return (
    <li className={cn('relative px-4 py-3 transition-colors active:bg-sunken/60 sm:px-0', pendingTo && 'bg-sunken/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ink">
            <Link to={`/app/orders/${o.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand focus-visible:after:ring-inset">
              {name}
            </Link>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            <span className="tnum font-medium text-ink-2">#{o.number}</span> · <RelativeTime iso={o.createdAt} /> · {o.fulfilmentMethod === 'delivery' ? 'Delivery' : 'Pickup'} ·{' '}
            {CHANNEL_LABEL[o.channel]}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Money minor={o.totalMinor} currency={o.currency} className="text-[15px] font-semibold text-ink" />
          <span className={cn('transition-opacity', pendingTo && 'opacity-70')}>
            <OrderStatusBadge status={shownStatus} />
          </span>
        </div>
      </div>
      {(step || showPayment) && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
            {showPayment && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}
            {showPayment && due > 0 && o.netPaidMinor > 0 && (
              <span className="truncate">
                <Money minor={due} currency={o.currency} /> due
              </span>
            )}
          </span>
          {step && <AdvanceButton o={o} step={step} allowed={allowed} pendingTo={pendingTo} onAdvance={onAdvance} className="h-10 shrink-0" />}
        </div>
      )}
      {error != null && (
        <div className="relative z-10 mt-2">
          <ErrorNotice error={error} />
        </div>
      )}
    </li>
  )
}
