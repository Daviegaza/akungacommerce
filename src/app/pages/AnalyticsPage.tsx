import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildAnalytics, rangeFor, type CurrencyReport, type DailyPoint, type RangeKey, type StockHealthCounts } from '@/domain/analytics'
import { CHANNEL_LABEL } from '@/gateway/types'
import { useOrders, useOrg, usePayments, useProducts, useRefunds } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Section, Table, Td, Th } from '../ui/layout'
import { Money, useFormatMoney } from '../ui/format'
import { Skeleton, buttonClass } from '../ui/primitives'
import { cn } from '@/lib/utils'

const RANGES: { id: RangeKey; label: string; long: string }[] = [
  { id: 'today', label: 'Today', long: 'today' },
  { id: '7d', label: '7 days', long: 'the last 7 days' },
  { id: '30d', label: '30 days', long: 'the last 30 days' },
  { id: '90d', label: '90 days', long: 'the last 90 days' },
]

function useShortDate() {
  const { org } = useOrg()
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(org.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    // Business dates are calendar dates; format them at UTC midnight so no zone shifts the day.
    return (date: string) => fmt.format(new Date(`${date}T00:00:00Z`))
  }, [org.locale])
}

function RangeControl({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex rounded-lg bg-sunken p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={value === r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            'h-8 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === r.id ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--ak-line)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function DailyChart({ currency, daily }: { currency: string; daily: DailyPoint[] }) {
  const formatMoney = useFormatMoney()
  const shortDate = useShortDate()
  const max = Math.max(0, ...daily.map((d) => d.grossSalesMinor))
  const dense = daily.length > 40

  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between gap-3 text-xs text-ink-3">
        <span>Gross sales per day</span>
        {max > 0 && <span className="tnum">Peak {formatMoney(max, currency)}</span>}
      </figcaption>
      <ol
        aria-label={`Gross sales per day in ${currency}`}
        className={cn('flex h-32 items-end border-b border-line-strong', dense ? 'gap-px' : 'gap-1')}
      >
        {daily.map((d) => {
          const pct = max > 0 ? (d.grossSalesMinor / max) * 100 : 0
          const label = `${shortDate(d.date)}: ${formatMoney(d.grossSalesMinor, currency)} from ${d.orders} ${d.orders === 1 ? 'order' : 'orders'}`
          return (
            <li key={d.date} aria-label={label} title={label} className="flex h-full max-w-10 min-w-0 flex-1 items-end">
              <span
                aria-hidden
                className={cn('block w-full rounded-t-[2px]', d.grossSalesMinor > 0 ? 'bg-ink' : 'bg-line')}
                style={{ height: d.grossSalesMinor > 0 ? `max(2px, ${pct}%)` : '1px' }}
              />
            </li>
          )
        })}
      </ol>
      {daily.length > 1 && (
        <div className="tnum mt-1 flex justify-between text-xs text-ink-3" aria-hidden>
          <span>{shortDate(daily[0].date)}</span>
          <span>{shortDate(daily[daily.length - 1].date)}</span>
        </div>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-ink-2 hover:text-ink">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <Table>
            <caption className="sr-only">Gross sales per day in {currency}</caption>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Gross sales</Th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date}>
                  <Td className="tnum text-ink-2">{shortDate(d.date)}</Td>
                  <Td align="right">{d.orders}</Td>
                  <Td align="right">
                    <Money minor={d.grossSalesMinor} currency={currency} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </figure>
  )
}

function CurrencyBlock({ report, rangeLong }: { report: CurrencyReport; rangeLong: string }) {
  const m = report.metrics
  return (
    <Section title={m.currency} description={`${m.orders} ${m.orders === 1 ? 'order' : 'orders'} in ${rangeLong}`}>
      {/* Phones: label/value rows so long amounts never truncate. Wider: unboxed stat row. */}
      <dl className="divide-y divide-line sm:grid sm:grid-cols-3 sm:gap-x-6 sm:gap-y-6 sm:divide-y-0 sm:pt-2 xl:grid-cols-5">
        {[
          { label: 'Gross sales', value: <Money minor={m.grossSalesMinor} currency={m.currency} />, foot: 'Drafts and cancelled excluded' },
          { label: 'Refunds', value: <Money minor={m.refundsMinor} currency={m.currency} /> },
          { label: 'Net sales', value: <Money minor={m.netSalesMinor} currency={m.currency} />, foot: 'Gross minus refunds' },
          { label: 'Orders', value: <span className="tnum">{m.orders}</span> },
          {
            label: 'Average order',
            value: m.orders > 0 ? <Money minor={m.averageOrderMinor} currency={m.currency} /> : <span className="text-ink-3">—</span>,
          },
        ].map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-4 py-2.5 sm:block sm:py-0">
            <dt className="text-sm text-ink-3 sm:text-xs sm:font-medium sm:tracking-wide sm:uppercase">{s.label}</dt>
            <dd className="text-right sm:mt-1 sm:text-left">
              <span className="block text-[15px] font-semibold text-ink sm:text-xl sm:tracking-[-0.02em] 2xl:text-2xl">{s.value}</span>
              {s.foot && <span className="mt-0.5 hidden text-xs text-ink-3 sm:block">{s.foot}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {m.unverifiedPaymentsMinor > 0 && (
        <p className="mt-4 text-sm text-ink-2">
          <Money minor={m.unverifiedPaymentsMinor} currency={m.currency} className="font-medium text-warn" /> of payments in this period were
          recorded manually and are not verified by a provider.
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px] lg:gap-10">
        <DailyChart currency={m.currency} daily={report.daily} />
        <div className="min-w-0">
          <h3 className="mb-1 text-xs font-medium text-ink-3">By channel</h3>
          {report.channels.length === 0 ? (
            <p className="py-3 text-sm text-ink-3">No orders in this period.</p>
          ) : (
            <Table>
              <caption className="sr-only">Orders and gross sales by channel in {m.currency}</caption>
              <thead>
                <tr>
                  <Th>Channel</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Gross</Th>
                </tr>
              </thead>
              <tbody>
                {report.channels.map((c) => (
                  <tr key={c.channel}>
                    <Td>{CHANNEL_LABEL[c.channel]}</Td>
                    <Td align="right">{c.orders}</Td>
                    <Td align="right">
                      <Money minor={c.grossSalesMinor} currency={m.currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </Section>
  )
}

function StockHealth({ counts }: { counts: StockHealthCounts }) {
  const items: { label: string; value: number; tone: string }[] = [
    { label: 'Out of stock', value: counts.out, tone: counts.out > 0 ? 'text-neg' : 'text-ink' },
    { label: 'Running low', value: counts.low, tone: counts.low > 0 ? 'text-warn' : 'text-ink' },
    { label: 'In stock', value: counts.ok, tone: 'text-ink' },
    { label: 'Not tracked', value: counts.untracked, tone: 'text-ink-3' },
  ]
  return (
    <Section
      title="Stock health"
      description="Active variants right now, not limited to the date range."
      actions={
        <Link to="/app/inventory" className="text-[13px] font-medium text-ink-2 hover:text-ink hover:underline">
          Open inventory
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 pt-2 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">{it.label}</dt>
            <dd className={cn('tnum mt-1 text-2xl font-semibold tracking-[-0.02em]', it.tone)}>{it.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

export default function AnalyticsPage() {
  const { org, can } = useOrg()
  const orders = useOrders()
  const refunds = useRefunds()
  const payments = usePayments()
  const products = useProducts()
  const [range, setRange] = useState<RangeKey>('30d')
  // "Now" is captured on mount and refreshed whenever the range is changed (never read during render).
  const [now, setNow] = useState(() => new Date())

  const queries = [orders, refunds, payments, products]
  const pending = queries.some((q) => q.isPending)
  const failed = queries.find((q) => q.isError)

  const report = useMemo(() => {
    if (!orders.data || !refunds.data || !payments.data || !products.data) return null
    return buildAnalytics({
      orders: orders.data,
      refunds: refunds.data,
      payments: payments.data,
      products: products.data,
      timezone: org.timezone,
      range: rangeFor(range, now, org.timezone),
      baseCurrency: org.baseCurrency,
    })
  }, [orders.data, refunds.data, payments.data, products.data, org.timezone, org.baseCurrency, range, now])

  const rangeMeta = RANGES.find((r) => r.id === range)!

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Sales by the business day in ${org.timezone.replace(/_/g, ' ')}.`}
        actions={
          <RangeControl
            value={range}
            onChange={(v) => {
              setRange(v)
              setNow(new Date())
            }}
          />
        }
      />

      {pending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-5 w-24" />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-32" />
        </div>
      ) : failed ? (
        <ErrorNotice
          error={failed.error}
          onRetry={() => {
            for (const q of queries) if (q.isError) void q.refetch()
          }}
        />
      ) : report ? (
        <>
          {report.currencies.length > 1 && (
            <div className="mb-8">
              <Notice>
                You sold in {report.currencies.length} currencies. Figures are shown separately for each currency and are never converted or added
                together.
              </Notice>
            </div>
          )}

          {report.currencies.length === 0 ? (
            <div className="mb-10">
              <EmptyState
                title={`No sales in ${rangeMeta.long}`}
                body={range === '90d' ? 'Orders you capture appear here by the day they were placed.' : 'Try a longer range, or capture an order.'}
                action={
                  can('orders.create') ? (
                    <Link to="/app/orders/new" className={buttonClass('primary', 'sm')}>
                      New order
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            report.currencies.map((c) => <CurrencyBlock key={c.metrics.currency} report={c} rangeLong={rangeMeta.long} />)
          )}

          <StockHealth counts={report.stock} />
        </>
      ) : null}
    </>
  )
}
