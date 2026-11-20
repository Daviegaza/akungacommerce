import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCheck,
  Copy,
  MapPin,
  MessageCircle,
  PackageCheck,
  PackageOpen,
  Plus,
  Share2,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react'
import { addDays, buildAnalytics, daysIn, type DateRange } from '@/domain/analytics'
import { businessDate } from '@/domain/locale'
import { available, stockHealth } from '@/domain/inventory'
import { divRoundHalfUp } from '@/domain/money'
import type { Address, OrderSummary } from '@/gateway/types'
import { MapFallback, StaticMap, WhenVisible, type MapMarker } from '@/maps'
import { cn } from '@/lib/utils'
import { useGateway, useMovements, useOrders, useOrg, useProducts } from '../context'
import { ErrorNotice, KpiTile, PageHeader, Section } from '../ui/layout'
import { Money } from '../ui/format'
import { Button, Card, Skeleton, Thumb, buttonClass } from '../ui/primitives'
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
        description={`Here is what is happening at ${org.name} today.`}
        actions={
          can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('brand', 'md', 'hidden sm:inline-flex')}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden /> New order
            </Link>
          )
        }
      />

      {/* To-do queue: always visible, cannot be dismissed. */}
      <section aria-labelledby="todo-h" className="mb-8">
        <h2 id="todo-h" className="sr-only">
          To do
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QueuePill loading={orders.isPending} count={queue.confirm} label="to confirm" to="/app/orders?tab=confirm" icon={<ClipboardCheck className="size-5" />} tone="brand" />
          <QueuePill loading={orders.isPending} count={queue.pack} label="to pack" to="/app/orders?tab=pack" icon={<PackageOpen className="size-5" />} tone="info" />
          <QueuePill loading={orders.isPending} count={queue.ready} label="ready to dispatch" to="/app/orders?tab=ready" icon={<PackageCheck className="size-5" />} tone="pos" />
          <QueuePill loading={products.isPending} count={lowStock} label="low on stock" to="/app/inventory" icon={<AlertTriangle className="size-5" />} tone="warn" />
        </div>
      </section>

      {/* KPI tiles per currency. */}
      <section aria-labelledby="kpi-h" className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="kpi-h" className="font-display text-[17px] font-bold tracking-tight text-ink">
            Last 14 days
          </h2>
          <Link to="/app/analytics" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
            Analytics <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        {orders.isPending ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[136px] rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {kpis.map((k) => (
              <div key={k.currency}>
                {multi && <p className="mb-2 text-xs font-bold text-ink-3">{k.currency}</p>}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KpiTile
                    label="Sales"
                    value={<Money minor={k.sales} currency={k.currency} />}
                    change={pctChange(k.sales, k.salesPrev)}
                    spark={k.dailySales}
                    sparkLabel={`Daily sales in ${k.currency}, last 14 days`}
                    foot={
                      <>
                        Today <Money minor={k.salesToday} currency={k.currency} className="font-semibold text-ink-2" />
                      </>
                    }
                  />
                  <KpiTile
                    label="Orders"
                    value={k.orders}
                    change={pctChange(k.orders, k.ordersPrev)}
                    spark={k.dailyOrders}
                    sparkLabel={`Daily orders in ${k.currency}, last 14 days`}
                    tone="info"
                    foot={
                      <>
                        Today <span className="tnum font-semibold text-ink-2">{k.ordersToday}</span>
                      </>
                    }
                  />
                  <KpiTile
                    label="Avg order"
                    value={<Money minor={k.avg} currency={k.currency} />}
                    change={pctChange(k.avg, k.avgPrev)}
                    spark={k.dailyAvg}
                    sparkLabel={`Average order value per day in ${k.currency}, last 14 days`}
                    tone="pos"
                    foot="Excludes cancelled orders"
                  />
                  <KpiTile
                    label="Unpaid balance"
                    value={<Money minor={k.unpaid} currency={k.currency} />}
                    spark={k.dailyUnpaid}
                    sparkLabel={`Unpaid balance by order day in ${k.currency}, last 14 days`}
                    tone="warn"
                    foot={
                      k.unpaidCount > 0 ? (
                        <Link to="/app/payments" className="font-semibold text-ink-2 underline-offset-2 hover:underline">
                          {k.unpaidCount} {k.unpaidCount === 1 ? 'order' : 'orders'} owe money
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

      <div className="grid gap-x-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <ActivityCard />
          <DeliveriesCard orders={orders.data} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <ShareShopCard />
          <TopProductsCard today={today} />
        </div>
      </div>
    </>
  )
}

/* ───────────── Queue pill ───────────── */

const PILL_TONE = {
  brand: { active: 'bg-brand text-on-brand shadow-[0_10px_24px_-12px_var(--ak-brand)]', icon: 'bg-white/20' },
  info: { active: 'bg-info-soft text-info ring-1 ring-info/20', icon: 'bg-info/10' },
  pos: { active: 'bg-pos-soft text-pos ring-1 ring-pos/20', icon: 'bg-pos/10' },
  warn: { active: 'bg-warn-soft text-warn ring-1 ring-warn/20', icon: 'bg-warn/10' },
} as const

function QueuePill({
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
  tone: keyof typeof PILL_TONE
  loading?: boolean
}) {
  if (loading) return <Skeleton className="h-[76px] rounded-[var(--radius-card)]" />
  const active = count > 0
  const t = PILL_TONE[tone]
  return (
    <Link
      to={to}
      className={cn(
        'ak-rise group flex min-h-[76px] items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 active:scale-[0.98]',
        active ? t.active : 'bg-panel text-ink-3 shadow-[var(--shadow-card)] ring-1 ring-line/60',
      )}
    >
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', active ? t.icon : 'bg-sunken')} aria-hidden>
        {active ? icon : <Check className="size-5" />}
      </span>
      <span className="min-w-0">
        <span className={cn('tnum block font-display text-2xl leading-none font-extrabold tracking-tight', !active && 'text-ink-2')}>{count}</span>
        <span className="mt-1 block text-[13px] leading-tight font-semibold">{label}</span>
      </span>
    </Link>
  )
}

/* ───────────── Activity ───────────── */

function ActivityCard() {
  const feed = useLiveFeed(8)
  return (
    <Section
      variant="card"
      title={
        <span className="flex items-center gap-2">
          Live activity
          <span className="ak-live-dot size-2 rounded-full bg-pos" aria-hidden />
        </span>
      }
      description="Updates every 20 seconds"
    >
      {feed.error ? <ErrorNotice error={feed.error} onRetry={feed.refetch} /> : <FeedList items={feed.items} loading={feed.isPending} />}
    </Section>
  )
}

/* ───────────── Deliveries map ───────────── */

function DeliveriesCard({ orders }: { orders: OrderSummary[] | undefined }) {
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
      variant="card"
      icon={<MapPin className="size-4" aria-hidden />}
      title="Deliveries to do"
      description={
        open.length === 0
          ? 'No open delivery orders'
          : `${open.length} open${outCount ? ` · ${outCount} out for delivery` : ''}`
      }
      actions={
        <Link to="/app/fulfilment" className="text-[13px] font-semibold text-ink-2 hover:text-ink">
          Fulfilment
        </Link>
      }
    >
      {shop.isPending || (detailsLoading && !shopPin) ? (
        <MapFallback height={240} />
      ) : markers.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-2xl">
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
            {!shopPin && ' · set your shop location in My shop to see it here'}
          </p>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-sunken px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
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

function ShareShopCard() {
  const shop = useShopSettings()
  const { org } = useOrg()
  const [copied, setCopied] = useState(false)

  if (shop.isPending) return <Skeleton className="mb-8 h-44 rounded-[var(--radius-card)]" />

  if (!shop.data) {
    return (
      <Card className="relative mb-8 overflow-hidden p-5">
        <span className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-full bg-brand-soft" aria-hidden />
        <div className="relative">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand text-on-brand">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <h2 className="mt-3 font-display text-xl font-extrabold tracking-tight text-ink">Open your online shop</h2>
          <p className="mt-1 text-sm text-ink-2">One link for WhatsApp, Instagram and TikTok. Customers order and pay; orders land here.</p>
          <Link to="/app/shop" className={buttonClass('brand', 'md', 'mt-4')}>
            Set up your shop <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Card>
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
    <Card className="relative mb-8 overflow-hidden p-5">
      <span className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-brand-soft" aria-hidden />
      <div className="relative">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">Share your shop</h2>
          {!shop.data.published && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn">Not published</span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {shop.data.published ? 'Post it on your Status and bio. Every order comes straight here.' : 'Only you can open it until you publish it in My shop.'}
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-sunken py-1.5 pr-1.5 pl-3">
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
            className={buttonClass('secondary', 'sm', 'text-[#0B7A3E] dark:text-[#4ade80]')}
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
            Edit shop
          </Link>
        </div>
      </div>
    </Card>
  )
}

/* ───────────── Top products ───────────── */

function TopProductsCard({ today }: { today: string }) {
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
      variant="card"
      icon={<TrendingUp className="size-4" aria-hidden />}
      title="Top products"
      description="Units sent out in the last 30 days"
      actions={
        <Link to="/app/products" className="text-[13px] font-semibold text-ink-2 hover:text-ink">
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
        <p className="rounded-2xl bg-sunken px-4 py-5 text-sm text-ink-3">No items have left the shop in the last 30 days. Best sellers show up here once orders are dispatched.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {top.map((t, i) => (
            <li key={t.variantId} className="ak-rise flex items-center gap-3" style={{ animationDelay: `${i * 40}ms` }}>
              <span className="relative shrink-0">
                <Thumb src={t.image} alt={t.name} className="size-12" />
                <span className="tnum absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary ring-2 ring-panel">
                  {i + 1}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{t.name}</span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(6, (t.units / maxUnits) * 100)}%` }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-sm font-bold text-ink">{t.units}</span>
                <span className="block text-[11px] text-ink-3">{t.stock != null ? `${t.stock} left` : 'sent'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
