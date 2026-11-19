import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ORDER_TRANSITIONS, type OrderStatus } from '@/domain/orders'
import type { OrderSummary } from '@/gateway/types'
import { useAction, useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Button, Skeleton, buttonClass } from '../ui/primitives'

interface NextStep {
  to: OrderStatus
  label: string
}

/**
 * The single forward step offered for an order, taken from ORDER_TRANSITIONS
 * (never `cancelled`; cancelling stays on the order page where it can be explained).
 */
function nextStepFor(o: Pick<OrderSummary, 'status' | 'fulfilmentMethod'>): NextStep | null {
  const forward = ORDER_TRANSITIONS[o.status].filter((s) => s !== 'cancelled')
  if (forward.length === 0) return null
  let to = forward[0]
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
      return 'Start preparing'
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

interface Lane {
  id: string
  title: string
  hint: string
  statuses: OrderStatus[]
}

const LANES: Lane[] = [
  { id: 'prepare', title: 'To prepare', hint: 'Confirmed or being prepared', statuses: ['confirmed', 'preparing'] },
  { id: 'ready', title: 'Ready', hint: 'Packed, waiting for pickup or a rider', statuses: ['ready'] },
  { id: 'out', title: 'Out for delivery', hint: 'Left the shop', statuses: ['dispatched'] },
]

type TransitionInput = { id: string; to: OrderStatus }

function QueueRow({
  o,
  allowed,
  pending,
  error,
  onAdvance,
}: {
  o: OrderSummary
  allowed: boolean
  pending: boolean
  error: unknown
  onAdvance: (step: NextStep) => void
}) {
  const step = nextStepFor(o)
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] text-ink">
            <Link to={`/app/orders/${o.id}`} className="tnum font-medium hover:underline">
              #{o.number}
            </Link>
            <span className="text-ink-2"> · {o.customerName ?? 'Walk-in'}</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {o.fulfilmentMethod === 'pickup' ? 'Pickup' : 'Delivery'} · <When iso={o.createdAt} />
          </p>
        </div>
        <Money minor={o.totalMinor} currency={o.currency} className="text-sm font-medium text-ink" />
      </div>
      {step && (
        <div className="mt-2">
          <Button
            size="sm"
            variant={o.status === 'pending_confirmation' ? 'secondary' : 'primary'}
            loading={pending}
            disabled={!allowed}
            onClick={() => onAdvance(step)}
            aria-label={`${step.label}, order ${o.number}`}
            title={allowed ? undefined : 'Your role cannot move orders'}
          >
            {step.label}
          </Button>
        </div>
      )}
      {error != null && (
        <div className="mt-2">
          <ErrorNotice error={error} />
        </div>
      )}
    </li>
  )
}

export default function FulfilmentPage() {
  const orders = useOrders()
  const { can } = useOrg()
  const allowed = can('orders.transition')
  const transition = useAction<TransitionInput>((g, o, { id, to }) => g.transitionOrder(o, id, to, null))
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<Record<string, unknown>>({})

  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, OrderSummary[]>()
    for (const o of orders.data ?? []) {
      const list = map.get(o.status) ?? []
      list.push(o)
      map.set(o.status, list)
    }
    // Oldest first: the queue is worked from the top.
    for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return map
  }, [orders.data])

  const laneOrders = (statuses: OrderStatus[]) => statuses.flatMap((s) => byStatus.get(s) ?? [])
  const awaiting = byStatus.get('pending_confirmation') ?? []
  const activeCount = LANES.reduce((n, l) => n + laneOrders(l.statuses).length, 0)

  async function advance(o: OrderSummary, step: NextStep) {
    setPendingIds((prev) => new Set(prev).add(o.id))
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
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(o.id)
        return next
      })
    }
  }

  const row = (o: OrderSummary) => (
    <QueueRow key={o.id} o={o} allowed={allowed} pending={pendingIds.has(o.id)} error={errors[o.id]} onAdvance={(step) => void advance(o, step)} />
  )

  return (
    <>
      <PageHeader title="Fulfilment" description="Work through today's orders from the oldest. One tap moves an order to its next step." />

      {orders.isPending ? (
        <div className="grid gap-8 lg:grid-cols-3">
          {LANES.map((l) => (
            <div key={l.id} className="flex flex-col gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      ) : orders.isError ? (
        <ErrorNotice error={orders.error} onRetry={() => void orders.refetch()} />
      ) : activeCount === 0 && awaiting.length === 0 ? (
        <EmptyState
          title="Nothing to fulfil right now"
          body="Confirmed orders show up here to prepare, hand over or send out."
          action={
            <Link to="/app/orders" className={buttonClass('secondary', 'sm')}>
              View all orders
            </Link>
          }
        />
      ) : (
        <>
          {!allowed && (
            <div className="mb-6">
              <Notice>Your role can see the queue but cannot move orders. Ask an owner or manager to change your role.</Notice>
            </div>
          )}

          {awaiting.length > 0 && (
            <details className="group mb-8 border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="text-[15px] font-semibold text-ink">
                  Awaiting confirmation <span className="tnum ml-1 font-normal text-ink-3">{awaiting.length}</span>
                </span>
                <span className="text-xs text-ink-3 group-open:hidden">Show</span>
                <span className="hidden text-xs text-ink-3 group-open:inline">Hide</span>
              </summary>
              <p className="pb-1 text-xs text-ink-3">Check stock and payment with the customer before confirming.</p>
              <ul className="divide-y divide-line border-t border-line">{awaiting.map(row)}</ul>
            </details>
          )}

          <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            {LANES.map((lane) => {
              const list = laneOrders(lane.statuses)
              const headingId = `lane-${lane.id}`
              return (
                <section key={lane.id} aria-labelledby={headingId} className="min-w-0">
                  <div className="border-b border-line pb-2">
                    <h2 id={headingId} className="text-[15px] font-semibold text-ink">
                      {lane.title} <span className="tnum ml-1 font-normal text-ink-3">{list.length}</span>
                    </h2>
                    <p className="text-xs text-ink-3">{lane.hint}</p>
                  </div>
                  {list.length === 0 ? (
                    <p className="py-4 text-sm text-ink-3">Nothing here.</p>
                  ) : (
                    <ul className="divide-y divide-line">{list.map(row)}</ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
