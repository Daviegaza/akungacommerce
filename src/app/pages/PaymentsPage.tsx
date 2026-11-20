import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { money, totalsByCurrency, type Money as MoneyValue } from '@/domain/money'
import { businessDate } from '@/domain/locale'
import type { PaymentStatus } from '@/domain/payments'
import { PAYMENT_METHOD_LABEL, type Payment, type Refund } from '@/gateway/types'
import { downloadCsv, ordersCsv, paymentsCsv, refundsCsv } from '@/integrations/csv'
import { useIntegrations, useOrders, useOrg, usePayments, useRefunds } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money, VerificationBadge, When } from '../ui/format'
import { Badge, Button, Select, Skeleton } from '../ui/primitives'
import { cn } from '@/lib/utils'
import { MpesaReconciliation } from '../components/MpesaReconciliation'
import { WhereIsMyMoney } from '../components/WhereIsMyMoney'
import { BRAND } from '@/brand/brand'

const DAY_MS = 86_400_000

type TabId = 'payments' | 'refunds'
type VerificationFilter = 'all' | 'manual_unverified' | 'provider_verified'
type StatusFilter = 'all' | PaymentStatus

const STATUS_LABEL: Record<PaymentStatus, string> = {
  succeeded: 'Received',
  pending: 'Pending',
  failed: 'Failed',
  reversed: 'Reversed',
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business'
  )
}

function OrderLink({ id, number }: { id: string; number: number | null }) {
  return (
    <Link to={`/app/orders/${id}`} className="tnum font-medium text-ink hover:underline">
      {number != null ? `#${number}` : 'Order'}
    </Link>
  )
}

function PaymentStatusCell({ p }: { p: Payment }) {
  if (p.status === 'succeeded') return <span className="text-ink-2">Received</span>
  if (p.status === 'reversed') {
    return (
      <span className="flex flex-col gap-0.5">
        <Badge>Reversed</Badge>
        {p.reversedReason && <span className="max-w-[220px] text-xs text-ink-3">{p.reversedReason}</span>}
      </span>
    )
  }
  return <Badge tone={p.status === 'failed' ? 'neg' : 'warn'}>{STATUS_LABEL[p.status]}</Badge>
}

function PaymentAmount({ p, className }: { p: Payment; className?: string }) {
  const struck = p.status === 'reversed' || p.status === 'failed'
  return (
    <Money
      minor={p.amountMinor}
      currency={p.currency}
      className={cn(struck ? 'text-ink-3 line-through' : 'font-medium text-ink', className)}
    />
  )
}

function RefundVerification({ r }: { r: Refund }) {
  return r.verification === 'provider_verified' ? <Badge tone="pos">Provider verified</Badge> : <Badge tone="warn">Recorded manually</Badge>
}

/* ───────────── 30-day summary ───────────── */

function ThirtyDaySummary({ payments, refunds, since }: { payments: Payment[]; refunds: Refund[]; since: number }) {
  const rows = useMemo(() => {
    const recent = payments.filter((p) => p.status === 'succeeded' && Date.parse(p.receivedAt) >= since)
    const received = totalsByCurrency(recent.map((p) => money(p.amountMinor, p.currency)))
    const unverified = totalsByCurrency(
      recent.filter((p) => p.verification === 'manual_unverified').map((p) => money(p.amountMinor, p.currency)),
    )
    const refunded = totalsByCurrency(
      refunds.filter((r) => r.status === 'succeeded' && Date.parse(r.createdAt) >= since).map((r) => money(r.amountMinor, r.currency)),
    )
    const currencies = [...new Set([...received.keys(), ...refunded.keys()])].sort()
    const amt = (m: Map<string, MoneyValue>, c: string) => m.get(c)?.amountMinor ?? 0
    return currencies.map((c) => ({ currency: c, received: amt(received, c), unverified: amt(unverified, c), refunded: amt(refunded, c) }))
  }, [payments, refunds, since])

  if (rows.length === 0) {
    return <p className="border-y border-line py-3 text-sm text-ink-3">No payments or refunds recorded in the last 30 days.</p>
  }
  return (
    <ul className="tnum divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.currency} className="flex flex-col gap-x-8 gap-y-1 py-3 sm:flex-row sm:items-baseline">
          <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-ink-3">{r.currency}</span>
          <span className="text-sm text-ink-2">
            Received <Money minor={r.received} currency={r.currency} className="font-semibold text-ink" />
          </span>
          <span className="text-sm text-ink-2">
            of which manual, unverified{' '}
            <Money minor={r.unverified} currency={r.currency} className={cn('font-medium', r.unverified > 0 ? 'text-warn' : 'text-ink')} />
          </span>
          <span className="text-sm text-ink-2">
            Refunded <Money minor={r.refunded} currency={r.currency} className="font-medium text-ink" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ───────────── Payments tab ───────────── */

function PaymentsPanel({ payments }: { payments: Payment[] }) {
  const [verification, setVerification] = useState<VerificationFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const verificationId = useId()
  const statusId = useId()

  const rows = useMemo(
    () =>
      payments
        .filter((p) => verification === 'all' || p.verification === verification)
        .filter((p) => status === 'all' || p.status === status)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    [payments, verification, status],
  )

  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments recorded yet"
        body="Open an order and choose Record payment when a customer pays by cash, bank transfer or mobile money."
        action={
          <Link to="/app/orders" className="text-sm font-medium text-ink underline underline-offset-2">
            Go to orders
          </Link>
        }
      />
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-[150px] flex-1 flex-col gap-1 sm:max-w-[220px] sm:flex-none">
          <label htmlFor={verificationId} className="text-[13px] font-medium text-ink-2">
            Verification
          </label>
          <Select id={verificationId} value={verification} onChange={(e) => setVerification(e.target.value as VerificationFilter)} className="h-9">
            <option value="all">All</option>
            <option value="manual_unverified">Manual, unverified</option>
            <option value="provider_verified">Provider verified</option>
          </Select>
        </div>
        <div className="flex min-w-[150px] flex-1 flex-col gap-1 sm:max-w-[180px] sm:flex-none">
          <label htmlFor={statusId} className="text-[13px] font-medium text-ink-2">
            Status
          </label>
          <Select id={statusId} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9">
            <option value="all">All</option>
            {(Object.keys(STATUS_LABEL) as PaymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <p className="tnum pb-2 text-xs text-ink-3" aria-live="polite">
          {rows.length} of {payments.length}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No payments match"
          body="Change the verification or status filter to see more."
          action={
            <Button
              size="sm"
              onClick={() => {
                setVerification('all')
                setStatus('all')
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Order</Th>
                  <Th>Method</Th>
                  <Th className="hidden lg:table-cell">Reference</Th>
                  <Th>Verification</Th>
                  <Th>Status</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <Td className="tnum whitespace-nowrap text-ink-2">
                      <When iso={p.receivedAt} />
                    </Td>
                    <Td>
                      <OrderLink id={p.orderId} number={p.orderNumber} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{PAYMENT_METHOD_LABEL[p.method]}</Td>
                    <Td className="hidden max-w-[160px] truncate font-mono text-[12.5px] text-ink-2 lg:table-cell">{p.externalRef ?? <span className="font-sans text-ink-3">—</span>}</Td>
                    <Td>
                      <VerificationBadge verification={p.verification} />
                    </Td>
                    <Td>
                      <PaymentStatusCell p={p} />
                    </Td>
                    <Td align="right">
                      <PaymentAmount p={p} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="-mx-4 divide-y divide-line border-y border-line px-4 sm:mx-0 sm:px-0 md:hidden">
            {rows.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] text-ink">
                    <OrderLink id={p.orderId} number={p.orderNumber} />
                    <span className="text-ink-2"> · {PAYMENT_METHOD_LABEL[p.method]}</span>
                  </p>
                  <p className="tnum mt-0.5 truncate text-xs text-ink-3">
                    <When iso={p.receivedAt} />
                    {p.externalRef && <> · {p.externalRef}</>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-start gap-1.5">
                    <VerificationBadge verification={p.verification} />
                    {p.status !== 'succeeded' && <PaymentStatusCell p={p} />}
                  </div>
                </div>
                <PaymentAmount p={p} className="text-[15px]" />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/* ───────────── Refunds tab ───────────── */

function RefundsPanel({ refunds }: { refunds: Refund[] }) {
  const rows = useMemo(() => [...refunds].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [refunds])
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No refunds recorded"
        body="Refunds are recorded from the order they belong to, against the payment being returned."
        action={
          <Link to="/app/orders" className="text-sm font-medium text-ink underline underline-offset-2">
            Go to orders
          </Link>
        }
      />
    )
  }
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-ink-3">
        A refund here is a record. {BRAND.name} does not move money: pay the customer back through your usual channel, then record it.
      </p>
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>Recorded</Th>
              <Th>Order</Th>
              <Th>Reason</Th>
              <Th>Verification</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="tnum whitespace-nowrap text-ink-2">
                  <When iso={r.createdAt} />
                </Td>
                <Td>
                  <OrderLink id={r.orderId} number={r.orderNumber} />
                </Td>
                <Td className="max-w-[280px] text-ink-2">
                  <span className="line-clamp-2">{r.reason}</span>
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1.5">
                    <RefundVerification r={r} />
                    {r.status !== 'succeeded' && <Badge tone={r.status === 'failed' ? 'neg' : 'warn'}>{r.status === 'failed' ? 'Failed' : 'Pending'}</Badge>}
                  </span>
                </Td>
                <Td align="right">
                  <Money minor={r.amountMinor} currency={r.currency} className={cn('font-medium', r.status === 'failed' && 'text-ink-3 line-through')} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <ul className="-mx-4 divide-y divide-line border-y border-line px-4 sm:mx-0 sm:px-0 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-[15px] text-ink">
                <OrderLink id={r.orderId} number={r.orderNumber} />
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                <When iso={r.createdAt} />
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-ink-2">{r.reason}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <RefundVerification r={r} />
                {r.status !== 'succeeded' && <Badge tone={r.status === 'failed' ? 'neg' : 'warn'}>{r.status === 'failed' ? 'Failed' : 'Pending'}</Badge>}
              </div>
            </div>
            <Money minor={r.amountMinor} currency={r.currency} className={cn('text-[15px] font-medium', r.status === 'failed' && 'text-ink-3 line-through')} />
          </li>
        ))}
      </ul>
    </>
  )
}

/* ───────────── Page ───────────── */

const TABS: { id: TabId; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'refunds', label: 'Refunds' },
]

export default function PaymentsPage() {
  const { org } = useOrg()
  const payments = usePayments()
  const refunds = useRefunds()
  const orders = useOrders()
  const integrations = useIntegrations()
  const [tab, setTab] = useState<TabId>('payments')
  const [since] = useState(() => Date.now() - 30 * DAY_MS)
  const [exportError, setExportError] = useState<Error | null>(null)
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ payments: null, refunds: null })
  const baseId = useId()

  const providerConnected = integrations.data?.some((i) => i.kind === 'payment' && i.label === 'connected_verified') ?? false

  function exportCsv(kind: 'payments' | 'refunds' | 'orders') {
    setExportError(null)
    const date = businessDate(new Date().toISOString(), org.timezone)
    const name = `${slugify(org.name)}-${kind}-${date}.csv`
    let csv: string
    if (kind === 'payments') csv = paymentsCsv(payments.data ?? [])
    else if (kind === 'refunds') csv = refundsCsv(refunds.data ?? [])
    else csv = ordersCsv(orders.data ?? [])
    if (!downloadCsv(name, csv)) setExportError(new Error('This browser blocked the download. Try another browser.'))
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = TABS.findIndex((t) => t.id === tab)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    const id = TABS[next].id
    setTab(id)
    tabRefs.current[id]?.focus()
  }

  const count = (id: TabId) => (id === 'payments' ? payments.data?.length : refunds.data?.length)

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment recorded against an order, whatever the method, and refunds paid back. Amounts stay in their own currency."
        actions={
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export CSV">
            <span className="text-xs text-ink-3">Export CSV</span>
            <Button size="sm" onClick={() => exportCsv('payments')} disabled={!payments.data}>
              Payments
            </Button>
            <Button size="sm" onClick={() => exportCsv('refunds')} disabled={!refunds.data}>
              Refunds
            </Button>
            <Button size="sm" onClick={() => exportCsv('orders')} disabled={!orders.data}>
              Orders
            </Button>
          </div>
        }
      />

      {exportError && (
        <div className="mb-6">
          <ErrorNotice error={exportError} />
        </div>
      )}

      {/* ───── Ledger first ───── */}
      <section aria-labelledby={`${baseId}-sum-h`} className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={`${baseId}-sum-h`} className="text-[13px] font-medium text-ink-3">
            Last 30 days
          </h2>
          <p className="text-xs text-ink-3">Grouped by currency. Different currencies are never added together.</p>
        </div>
        {payments.isPending || refunds.isPending ? (
          <div className="flex flex-col gap-2 border-y border-line py-3">
            <Skeleton className="h-5 w-full max-w-lg" />
            <Skeleton className="h-5 w-full max-w-md" />
          </div>
        ) : payments.isError || refunds.isError ? (
          <ErrorNotice
            error={payments.error ?? refunds.error}
            onRetry={() => {
              void payments.refetch()
              void refunds.refetch()
            }}
          />
        ) : (
          <ThirtyDaySummary payments={payments.data ?? []} refunds={refunds.data ?? []} since={since} />
        )}
      </section>

      <div className="mb-6">
        <Notice>
          Payments you record are marked manual and unverified. Provider verification appears only after a verified callback from a connected payment
          provider{integrations.isSuccess && !providerConnected ? ' — none is connected yet.' : '.'}
        </Notice>
      </div>

      <div role="tablist" aria-label="Payments and refunds" className="no-scrollbar -mx-4 mb-4 flex gap-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => {
          const selected = tab === t.id
          const n = count(t.id)
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
              className={cn(
                '-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 text-[13.5px] font-medium transition-colors duration-150',
                selected ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink',
              )}
            >
              {t.label}
              {n !== undefined && (
                <span
                  className={cn(
                    'tnum inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-medium',
                    selected ? 'bg-ink text-canvas' : n > 0 ? 'bg-sunken text-ink-2' : 'text-ink-3',
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {TABS.map((t) => {
        const q = t.id === 'payments' ? payments : refunds
        return (
          <div key={t.id} role="tabpanel" id={`${baseId}-panel-${t.id}`} aria-labelledby={`${baseId}-tab-${t.id}`} hidden={tab !== t.id}>
            {tab !== t.id ? null : q.isPending ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : q.isError ? (
              <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
            ) : t.id === 'payments' ? (
              <PaymentsPanel payments={payments.data ?? []} />
            ) : (
              <RefundsPanel refunds={refunds.data ?? []} />
            )}
          </div>
        )
      })}

      {/* ───── Settings: how money reaches you ───── */}
      <div className="mt-14 border-t border-line-strong pt-8">
        <div className="mb-8 max-w-2xl">
          <h2 className="font-display text-[20px] font-semibold tracking-[-0.025em] text-ink">How you get paid</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
            Customers can pay by cash, bank transfer, mobile money or card, depending on what you accept. Every payment is kept on its order and shows
            in the ledger above, either typed in by your team (manual, unverified) or confirmed by a connected provider. The sections below cover mobile
            money (M-Pesa) and, where available, bank transfers: where the money goes, how it is set up, and matching payments to orders.
          </p>
        </div>
        <WhereIsMyMoney />
        <MpesaReconciliation />
      </div>
    </>
  )
}
