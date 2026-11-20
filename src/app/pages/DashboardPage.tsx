import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCheck,
  Copy,
  MessageCircle,
  PackageCheck,
  PackageOpen,
  Plus,
  Share2,
  Store,
} from 'lucide-react'
import { addDays, buildAnalytics, daysIn, type DateRange } from '@/domain/analytics'
import { businessDate } from '@/domain/locale'
import { available, stockHealth } from '@/domain/inventory'
import { divRoundHalfUp } from '@/domain/money'
import type { Address, OrderSummary } from '@/gateway/types'
import { MapFallback, StaticMap, WhenVisible, type MapMarker } from '@/maps'
import { cn } from '@/lib/utils'
import { useGateway, useMovements, useOrders, useOrg, useProducts } from '../context'
import { ErrorNotice, PageHeader, Section } from '../ui/layout'
import { Money } from '../ui/format'
import { Button, Skeleton, Sparkline, Thumb, buttonClass } from '../ui/primitives'
import { FeedList, shopUrl, useLiveFeed, useNow, useShopSettings } from '../live'

const OPEN_DELIVERY: OrderSummary['status'][] = ['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched']

function greetingFor(hour: number): string {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Drop-off coordinates when the address carries a map pin (storefront orders do). */
function coordsOf(address: Address | undefined): { lat: number; lng: number } | null {
  if (!address) return null
  const a = address as Record<string, unknown>
  const lat = typeof a.lat === 'number' ? a.lat : typeof a.lat === 'string' ? Number(a.lat) : NaN
  const lng = typeof a.lng === 'number' ? a.lng : typeof a.lng === 'string' ? Number(a.lng) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null
  return (cur - prev) / prev
}

/* ───────────── KPI rows (one per currency, never merged) ───────────── */

interface KpiRow {
  currency: string
  sales: number
  salesPrev: number
  salesToday: number
  orders: number
  ordersPrev: number
  ordersToday: number
  avg: number
  avgPrev: number
  dailySales: number[]
  dailyOrders: number[]
  dailyAvg: number[]
  unpaid: number
  unpaidCount: number
  dailyUnpaid: number[]
}

function buildKpis(orders: OrderSummary[], timezone: string, baseCurrency: string, today: string): KpiRow[] {
  const cur: DateRange = { from: addDays(today, -13), to: today }
  const prev: DateRange = { from: addDays(today, -27), to: addDays(today, -14) }
  const common = { orders, refunds: [], payments: [], products: [], timezone, baseCurrency }
  const curR = buildAnalytics({ ...common, range: cur })
  const prevR = buildAnalytics({ ...common, range: prev })
  const days = daysIn(cur)

  // Balance still owed, per currency, bucketed by the order's business day for the trend.
  const unpaid = new Map<string, { total: number; count: number; daily: Map<string, number> }>()
  for (const o of orders) {
    if (o.status === 'draft' || o.status === 'cancelled' || o.status === 'refunded') continue
    const due = o.totalMinor - o.netPaidMinor
    if (due <= 0) continue
    const u = unpaid.get(o.currency) ?? { total: 0, count: 0, daily: new Map() }
    u.total += due
    u.count += 1
    const d = businessDate(o.createdAt, timezone)
    u.daily.set(d, (u.daily.get(d) ?? 0) + due)
    unpaid.set(o.currency, u)
  }

  const currencies = new Set<string>([...curR.currencies.map((c) => c.metrics.currency), ...unpaid.keys()])
  if (currencies.size === 0) currencies.add(baseCurrency)
  const ordered = [...currencies].sort((a, b) => (a === baseCurrency ? -1 : b === baseCurrency ? 1 : a.localeCompare(b)))

  return ordered.map((currency) => {
    const c = curR.currencies.find((x) => x.metrics.currency === currency)
    const p = prevR.currencies.find((x) => x.metrics.currency === currency)
    const daily = c?.daily ?? days.map((date) => ({ date, orders: 0, grossSalesMinor: 0 }))
    const u = unpaid.get(currency)
    const last = daily[daily.length - 1]
    return {
      currency,
      sales: c?.metrics.grossSalesMinor ?? 0,
      salesPrev: p?.metrics.grossSalesMinor ?? 0,
      salesToday: last?.grossSalesMinor ?? 0,
      orders: c?.metrics.orders ?? 0,
      ordersPrev: p?.metrics.orders ?? 0,
      ordersToday: last?.orders ?? 0,
      avg: c?.metrics.averageOrderMinor ?? 0,
      avgPrev: p?.metrics.averageOrderMinor ?? 0,
      dailySales: daily.map((d) => d.grossSalesMinor),
      dailyOrders: daily.map((d) => d.orders),
      dailyAvg: daily.map((d) => (d.orders > 0 ? divRoundHalfUp(d.grossSalesMinor, d.orders) : 0)),
      unpaid: u?.total ?? 0,
      unpaidCount: u?.count ?? 0,
      dailyUnpaid: days.map((d) => u?.daily.get(d) ?? 0),
    }
  })
}

/* ───────────── Page ───────────── */

export default function DashboardPage() {
  const { org, can } = useOrg()
  const orders = useOrders()
  const products = useProducts()
  const nowMs = useNow()
  const nowIso = new Date(nowMs).toISOString()
  const today = businessDate(nowIso, org.timezone)

  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: org.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(nowMs)))
  const dateLine = new Intl.DateTimeFormat(org.locale, { timeZone: org.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(nowMs))

  const kpis = useMemo(() => (orders.data ? buildKpis(orders.data, org.timezone, org.baseCurrency, today) : []), [orders.data, org.timezone, org.baseCurrency, today])

  const queue = useMemo(() => {
    const list = orders.data ?? []
    return {
      confirm: list.filter((o) => o.status === 'pending_confirmation' || o.status === 'draft').length,
      pack: list.filter((o) => o.status === 'confirmed' || o.status === 'preparing').length,
      ready: list.filter((o) => o.status === 'ready').length,
    }
  }, [orders.data])

  const lowStock = useMemo(
    () =>
      (products.data ?? [])
        .filter((p) => p.status === 'active' && p.trackStock)
        .flatMap((p) => p.variants.filter((v) => v.isActive && stockHealth(v, v.lowStockThreshold) !== 'ok'))
        .length,
    [products.data],
  )

  if (orders.isError) return <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />

  const multi = kpis.length > 1

  return (
    <>
      <PageHeader
        eyebrow={dateLine}
        title={greetingFor(hour)}
        description={org.name}
        actions={
          can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('primary', 'md', 'hidden sm:inline-flex')}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden /> New order
            </Link>
          )
        }
      />

      {/* Work queue: always visible, cannot be dismissed. */}
      <section aria-labelledby="todo-h" className="mb-10">
        <h2 id="todo-h" className="mb-3 text-[13px] font-medium text-ink-3">
          Needs attention
        </h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
          <QueueCell loading={orders.isPending} count={queue.confirm} label="To confirm" to="/app/orders?tab=confirm" icon={<ClipboardCheck className="size-4" />} tone="brand" />
          <QueueCell loading={orders.isPending} count={queue.pack} label="To pack" to="/app/orders?tab=pack" icon={<PackageOpen className="size-4" />} tone="ink" />
          <QueueCell loading={orders.isPending} count={queue.ready} label="Ready to dispatch" to="/app/orders?tab=ready" icon={<PackageCheck className="size-4" />} tone="pos" />
          <QueueCell loading={products.isPending} count={lowStock} label="Low on stock" to="/app/inventory" icon={<AlertTriangle className="size-4" />} tone="warn" />
        </div>
      </section>

      {/* Performance per currency, never merged. */}
      <section aria-labelledby="kpi-h" className="mb-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="kpi-h" className="text-[13px] font-medium text-ink-3">
            Last 14 days
          </h2>
          <Link to="/app/analytics" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
            Analytics <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        {orders.isPending ? (
          <Skeleton className="h-[132px] rounded-[var(--radius-card)]" />
        ) : (
          <div className="flex flex-col gap-4">
            {kpis.map((k) => (
              <div key={k.currency}>
                {multi && <p className="mb-2 text-xs font-medium text-ink-3">{k.currency}</p>}
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
                  <Metric
                    label="Sales"
                    value={<Money minor={k.sales} currency={k.currency} />}
                    change={pctChange(k.sales, k.salesPrev)}
                    spark={k.dailySales}
                    sparkLabel={`Daily sales in ${k.currency}, last 14 days`}
                    foot={
                      <>
                        Today <Money minor={k.salesToday} currency={k.currency} className="text-ink-2" />
                      </>
                    }
                  />
                  <Metric
                    label="Orders"
                    value={k.orders}
                    change={pctChange(k.orders, k.ordersPrev)}
                    spark={k.dailyOrders}
                    sparkLabel={`Daily orders in ${k.currency}, last 14 days`}
                    foot={
                      <>
                        Today <span className="tnum text-ink-2">{k.ordersToday}</span>
                      </>
                    }
                  />
                  <Metric
                    label="Average order"
                    value={<Money minor={k.avg} currency={k.currency} />}
                    change={pctChange(k.avg, k.avgPrev)}
                    spark={k.dailyAvg}
                    sparkLabel={`Average order value per day in ${k.currency}, last 14 days`}
                    foot="Excludes cancelled orders"
                  />
                  <Metric
                    label="Unpaid balance"
                    value={<Money minor={k.unpaid} currency={k.currency} />}
                    spark={k.dailyUnpaid}
                    sparkLabel={`Unpaid balance by order day in ${k.currency}, last 14 days`}
                    sparkTone="warn"
                    foot={
                      k.unpaidCount > 0 ? (
                        <Link to="/app/payments" className="text-ink-2 underline-offset-2 hover:underline">
                          {k.unpaidCount} {k.unpaidCount === 1 ? 'order owes' : 'orders owe'} money
                        </Link>
                      ) : (
                        'Everything is paid'
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-x-10 gap-y-2 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <ActivitySection />
          <DeliveriesSection orders={orders.data} />
        </div>
        <div className="min-w-0">
          <ShareShopSection />
          <TopProductsSection today={today} />
        </div>
      </div>
    </>
  )
}

/* ───────────── Queue cell ───────────── */

const CELL_TONE = { brand: 'text-brand', ink: 'text-ink', pos: 'text-pos', warn: 'text-warn' } as const

function QueueCell({
  count,
  label,
  to,
  icon,
  tone,
  loading,
}: {
  count: number
  label: string
  to: string
  icon: ReactNode
  tone: keyof typeof CELL_TONE
  loading?: boolean
}) {
  if (loading) return <div className="h-[92px] animate-pulse bg-panel" aria-hidden />
  const active = count > 0
  return (
    <Link to={to} className="group flex min-h-[92px] flex-col justify-between bg-panel px-4 py-3.5 transition-colors hover:bg-sunken/60 sm:px-5">
      <span className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
        <span className="flex items-center gap-2">
          <span className={active ? CELL_TONE[tone] : 'text-ink-3'} aria-hidden>
            {active ? icon : <Check className="size-4" />}
          </span>
          {label}
        </span>
        <ArrowRight className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className={cn('tnum font-display text-[28px] leading-none font-semibold tracking-tight', active ? 'text-ink' : 'text-ink-3')}>
        {count}
        {!active && <span className="sr-only">, all clear</span>}
      </span>
    </Link>
  )
}

function Metric({
  label,
  value,
  change,
  spark,
  sparkLabel,
  sparkTone = 'brand',
  foot,
}: {
  label: string
  value: ReactNode
  change?: number | null
  spark: number[]
  sparkLabel: string
  sparkTone?: 'brand' | 'warn'
  foot: ReactNode
}) {
  const up = change != null && change > 0
  const flat = change != null && Math.abs(change) < 0.005
  return (
    <div className="flex min-w-0 flex-col bg-panel px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-2">{label}</p>
        {change != null && Number.isFinite(change) && (
          <span className={cn('tnum text-xs font-medium', flat ? 'text-ink-3' : up ? 'text-pos' : 'text-neg')} title="vs previous 14 days">
            {flat ? '0%' : `${up ? '+' : '−'}${Math.abs(Math.round(change * 100))}%`}
            <span className="sr-only"> {flat ? 'no change' : up ? 'up' : 'down'} vs previous 14 days</span>
          </span>
        )}
      </div>
      <div className="tnum mt-1.5 min-w-0 truncate font-display text-[clamp(1.05rem,4.6vw,1.5rem)] leading-tight font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <div className="min-w-0 text-xs text-ink-3">{foot}</div>
        <Sparkline values={spark} label={sparkLabel} className={cn('hidden shrink-0 sm:block', sparkTone === 'warn' ? 'text-warn' : 'text-brand')} width={72} height={24} />
      </div>
    </div>
  )
}

/* ───────────── Activity ───────────── */

function ActivitySection() {
  const feed = useLiveFeed(8)
  return (
    <Section title="Recent activity" description="Orders, payments and stock alerts. Refreshes every 20 seconds." className="border-t border-line pt-5">
      {feed.error ? <ErrorNotice error={feed.error} onRetry={feed.refetch} /> : <FeedList items={feed.items} loading={feed.isPending} />}
    </Section>
  )
}

/* ───────────── Deliveries map ───────────── */

function DeliveriesSection({ orders }: { orders: OrderSummary[] | undefined }) {
  const gateway = useGateway()
  const { org } = useOrg()
  const shop = useShopSettings()
  const open = useMemo(
    () => (orders ?? []).filter((o) => o.fulfilmentMethod === 'delivery' && OPEN_DELIVERY.includes(o.status)),
    [orders],
  )
  // The list has no addresses, so fetch details only for open delivery orders, capped at 20.
  const capped = open.slice(0, 20)
  const details = useQueries({
    queries: capped.map((o) => ({
      queryKey: [org.id, 'order', o.id],
      queryFn: () => gateway.getOrder(org.id, o.id),
      staleTime: 60_000,
    })),
  })
  const detailsLoading = details.some((d) => d.isPending)

  const drops: MapMarker[] = []
  details.forEach((d, i) => {
    const c = coordsOf(d.data?.fulfilment.address)
    if (c) drops.push({ ...c, kind: 'drop', label: `#${capped[i].number}` })
  })
  const s = shop.data
  const shopPin: MapMarker | null = s && s.locationLat != null && s.locationLng != null ? { lat: s.locationLat, lng: s.locationLng, kind: 'shop', label: s.locationLabel ?? 'Your shop' } : null
  const markers = [...(shopPin ? [shopPin] : []), ...drops]
  const outCount = open.filter((o) => o.status === 'dispatched').length
  const noPin = capped.length - drops.length

  return (
    <Section
      className="border-t border-line pt-5"
      title="Deliveries to do"
      description={
        open.length === 0
          ? 'No open delivery orders'
          : `${open.length} open${outCount ? ` · ${outCount} out for delivery` : ''}`
      }
      actions={
        <Link to="/app/fulfilment" className="text-[13px] font-medium text-ink-2 hover:text-ink">
          Fulfilment
        </Link>
      }
    >
      {shop.isPending || (detailsLoading && !shopPin) ? (
        <MapFallback height={240} />
      ) : markers.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
            {/* MapLibre (~450 KB gzipped with its worker) loads only when the map scrolls into view. */}
            <WhenVisible fallback={<MapFallback height={240} />}>
              <Suspense fallback={<MapFallback height={240} />}>
                <StaticMap markers={markers} height={240} fitToMarkers />
              </Suspense>
            </WhenVisible>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {drops.length > 0 ? `${drops.length} drop-off ${drops.length === 1 ? 'pin' : 'pins'}` : 'No drop-off pins yet'}
            {noPin > 0 && ` · ${noPin} without a map pin`}
            {open.length > capped.length && ` · showing the first ${capped.length}`}
            {!shopPin && ' · set your shop location in Storefront settings to see it here'}
          </p>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-2">
            {open.length > 0
              ? `${open.length} delivery ${open.length === 1 ? 'order has' : 'orders have'} no map pin. Add your shop location to see the map.`
              : 'Pin your shop location and delivery orders will show on a map here.'}
          </p>
          <Link to="/app/shop" className={buttonClass('secondary', 'sm', 'shrink-0')}>
            <Store className="size-4" aria-hidden /> Set location
          </Link>
        </div>
      )}
    </Section>
  )
}

/* ───────────── Share your shop ───────────── */

function ShareShopSection() {
  const shop = useShopSettings()
  const { org } = useOrg()
  const [copied, setCopied] = useState(false)

  if (shop.isPending) return <Skeleton className="mb-8 h-40 rounded-[var(--radius-card)]" />

  if (!shop.data) {
    return (
      <section className="mb-8 border-t border-line pt-5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">Open your storefront</h2>
        <p className="mt-1 text-sm text-ink-2">One link for your website, social profiles and chats. Customers order and pay; orders land here.</p>
        <Link to="/app/shop" className={buttonClass('brand', 'sm', 'mt-4')}>
          Set up your storefront <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    )
  }

  const url = shopUrl(shop.data.slug)
  const message = `Shop ${org.name} online: ${url}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const nativeShare = async () => {
    try {
      await navigator.share({ title: org.name, text: `Shop ${org.name} online`, url })
    } catch {
      /* cancelled or unsupported */
    }
  }
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <section className="mb-8 border-t border-line pt-5">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">Your storefront link</h2>
          {!shop.data.published && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">Not published</span>}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {shop.data.published ? 'Share it in your bio, chats and posts. Every order comes straight here.' : 'Only you can open it until you publish it.'}
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-panel py-1 pr-1 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-2" title={url}>
            {url.replace(/^https?:\/\//, '')}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void copy()} icon={copied ? <Check className="size-4 text-pos" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Link copied' : ''}
        </span>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('secondary', 'sm')}
          >
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {canNativeShare && (
            <Button size="sm" variant="secondary" onClick={() => void nativeShare()} icon={<Share2 className="size-4" aria-hidden />}>
              Share
            </Button>
          )}
          <Link to="/app/shop" className={buttonClass('ghost', 'sm')}>
            Edit storefront
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ───────────── Top products ───────────── */

function TopProductsSection({ today }: { today: string }) {
  const { org } = useOrg()
  const movements = useMovements()
  const products = useProducts()

  const top = useMemo(() => {
    const since = addDays(today, -29)
    const units = new Map<string, number>()
    for (const m of movements.data ?? []) {
      if (m.kind !== 'sale') continue
      if (businessDate(m.createdAt, org.timezone) < since) continue
      units.set(m.variantId, (units.get(m.variantId) ?? 0) + Math.abs(m.onHandDelta))
    }
    const byVariant = new Map<string, { productId: string; name: string; image: string | null; stock: number | null }>()
    for (const p of products.data ?? []) {
      for (const v of p.variants) {
        byVariant.set(v.id, {
          productId: p.id,
          name: v.name === 'Default' ? p.name : `${p.name} · ${v.name}`,
          image: p.images[0]?.url ?? null,
          stock: p.trackStock ? available(v) : null,
        })
      }
    }
    return [...units.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([variantId, n]) => {
        const info = byVariant.get(variantId)
        const fallback = movements.data?.find((m) => m.variantId === variantId)
        return {
          variantId,
          units: n,
          name: info?.name ?? (fallback ? `${fallback.productName} · ${fallback.variantName}` : 'Unknown item'),
          image: info?.image ?? null,
          stock: info?.stock ?? null,
        }
      })
  }, [movements.data, products.data, today, org.timezone])

  const maxUnits = top[0]?.units ?? 1

  return (
    <Section
      className="border-t border-line pt-5"
      title="Top products"
      description="Units sent out in the last 30 days"
      actions={
        <Link to="/app/products" className="text-[13px] font-medium text-ink-2 hover:text-ink">
          Products
        </Link>
      }
    >
      {movements.isPending || products.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-12" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      ) : movements.isError ? (
        <ErrorNotice error={movements.error} onRetry={() => movements.refetch()} />
      ) : top.length === 0 ? (
        <p className="text-sm text-ink-3">No items have left the shop in the last 30 days. Best sellers show up here once orders are dispatched.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {top.map((t, i) => (
            <li key={t.variantId} className="flex items-center gap-3 py-2.5">
              <span className="tnum w-4 shrink-0 text-xs text-ink-3">{i + 1}</span>
              <Thumb src={t.image} alt={t.name} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-ink-3" style={{ width: `${Math.max(6, (t.units / maxUnits) * 100)}%` }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-sm font-semibold text-ink">{t.units}</span>
                <span className="block text-[11px] text-ink-3">{t.stock != null ? `${t.stock} left` : 'sent'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
