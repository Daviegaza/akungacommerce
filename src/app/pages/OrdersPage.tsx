import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, Plus, Receipt, Search } from 'lucide-react'
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS, type OrderStatus } from '@/domain/orders'
import type { OrderSummary } from '@/gateway/types'
import { cn } from '@/lib/utils'
import { useAction, useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, PageHeader } from '../ui/layout'
import { ChannelBadge, FulfilmentBadge, Money, OrderStatusBadge, PaymentStateBadge, RelativeTime, paymentStateOf } from '../ui/format'
import { Avatar, Button, Input, PillTabs, Skeleton, buttonClass, type PillTab } from '../ui/primitives'

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

export default function OrdersPage() {
  const orders = useOrders()
  const { can } = useOrg()
  const allowed = can('orders.transition')
  const reduce = useReducedMotion() ?? false
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

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order, whichever channel it came from. Move each one on with a tap."
        actions={
          can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('brand')}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden /> New order
            </Link>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        <PillTabs tabs={pillTabs} value={tab} onChange={setTab} label="Filter orders by status" />
        <label className="relative block sm:max-w-sm">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, customer or phone" className="rounded-full pl-10" />
        </label>
      </div>

      {!allowed && orders.isSuccess && orders.data.length > 0 && (
        <p className="mb-4 text-xs text-ink-3">Your role can see orders but cannot move them on. Ask an owner or manager to change your role.</p>
      )}

      {orders.isPending ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[168px] rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : orders.isError ? (
        <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" aria-hidden />}
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
              <Link to="/app/orders/new" className={buttonClass('brand')}>
                New order
              </Link>
            ) : q.trim() ? (
              <Button onClick={() => setQ('')}>Clear search</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {rows.map((o) => (
              <motion.li
                key={o.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                transition={{ duration: reduce ? 0.01 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <OrderCard o={o} allowed={allowed} pendingTo={pending[o.id]} error={errors[o.id]} onAdvance={(step) => void advance(o, step)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </>
  )
}

function OrderCard({
  o,
  allowed,
  pendingTo,
  error,
  onAdvance,
}: {
  o: OrderSummary
  allowed: boolean
  pendingTo: OrderStatus | undefined
  error: unknown
  onAdvance: (step: NextStep) => void
}) {
  const step = nextStepFor(o)
  const shownStatus = pendingTo ?? o.status
  const showPayment = o.status !== 'draft' && o.status !== 'cancelled'
  const due = o.totalMinor - o.netPaidMinor
  const name = o.customerName ?? 'Walk-in customer'
  return (
    <article
      className={cn(
        'group relative flex h-full flex-col rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] ring-1 ring-line/60 transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] sm:p-5',
        pendingTo && 'ring-brand/40',
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={o.customerName} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-ink">
            <Link to={`/app/orders/${o.id}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none">
              {name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            <span className="tnum font-semibold text-ink-2">#{o.number}</span> · <RelativeTime iso={o.createdAt} />
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money minor={o.totalMinor} currency={o.currency} className="font-display text-lg font-semibold tracking-tight text-ink" />
          {showPayment && due > 0 && o.netPaidMinor > 0 && (
            <p className="text-[11px] text-ink-3">
              <Money minor={due} currency={o.currency} /> due
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={cn('transition-opacity', pendingTo && 'opacity-70')}>
          <OrderStatusBadge status={shownStatus} />
        </span>
        {showPayment && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}
        <ChannelBadge channel={o.channel} />
        <FulfilmentBadge method={o.fulfilmentMethod} />
      </div>

      <div className="mt-auto pt-4">
      {error != null && (
        <div className="relative z-10 mb-3">
          <ErrorNotice error={error} />
        </div>
      )}
      <div className="relative z-10 flex items-center gap-2">
        {step && (
          <Button
            size="sm"
            variant={o.status === 'pending_confirmation' || o.status === 'draft' ? 'brand' : 'primary'}
            loading={Boolean(pendingTo)}
            disabled={!allowed}
            onClick={() => onAdvance(step)}
            aria-label={`${step.label}, order ${o.number}`}
            title={allowed ? undefined : 'Your role cannot move orders'}
          >
            {pendingTo ? `${ORDER_STATUS_LABEL[pendingTo]}…` : step.label}
          </Button>
        )}
        <Link
          to={`/app/orders/${o.id}`}
          className={cn(buttonClass('ghost', 'sm'), 'ml-auto text-ink-3')}
          aria-label={`Open order ${o.number}`}
          tabIndex={-1}
        >
          Details <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      </div>
    </article>
  )
}
