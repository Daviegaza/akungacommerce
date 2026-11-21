import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, LayoutGrid, List, Package, Plus, Search, Star, Upload } from 'lucide-react'
import type { Product, ProductStatus } from '@/gateway/types'
import { available, stockHealth, type StockHealth } from '@/domain/inventory'
import { formatDateTime } from '@/domain/locale'
import { cn } from '@/lib/utils'
import { useOrg, useProducts } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money } from '../ui/format'
import { Badge, Button, Input, PillTabs, Skeleton, Thumb, buttonClass } from '../ui/primitives'
import { ProductEditorSheet } from '../components/ProductEditor'
import { useLocalString, useNow } from '../live'

type StatusFilter = ProductStatus | 'all'
type View = 'grid' | 'list'

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
]

const HEALTH_RANK: Record<StockHealth, number> = { ok: 0, low: 1, out: 2 }

interface Row {
  product: Product
  variantCount: number
  /** Cheapest and dearest price among variants sharing the first variant's currency (never mixed). */
  price: { minor: number; maxMinor: number; currency: string; from: boolean; compareAt: number | null } | null
  stock: { available: number; health: StockHealth; lowCount: number; outCount: number } | null
  swatches: string[]
  skus: string[]
  cover: string | null
  coverAlt: string
}

function summarise(p: Product): Row {
  const live = p.variants.filter((v) => v.isActive)
  const priced = live.length ? live : p.variants
  let price: Row['price'] = null
  if (priced.length) {
    const currency = priced[0].currency
    const same = priced.filter((v) => v.currency === currency)
    const cheapest = same.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a))
    const dearest = same.reduce((a, b) => (b.priceMinor > a.priceMinor ? b : a))
    const compareAt = cheapest.compareAtMinor != null && cheapest.compareAtMinor > cheapest.priceMinor ? cheapest.compareAtMinor : null
    price = {
      minor: cheapest.priceMinor,
      maxMinor: dearest.priceMinor,
      currency,
      from: same.some((v) => v.priceMinor !== cheapest.priceMinor),
      compareAt,
    }
  }
  let stock: Row['stock'] = null
  if (p.trackStock) {
    let total = 0
    let worst: StockHealth = 'ok'
    let lowCount = 0
    let outCount = 0
    for (const v of live) {
      total += available(v)
      const h = stockHealth(v, v.lowStockThreshold)
      if (h === 'low') lowCount += 1
      if (h === 'out') outCount += 1
      if (HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h
    }
    stock = { available: total, health: live.length ? worst : 'out', lowCount, outCount }
  }
  const swatches = [...new Set(live.map((v) => v.swatch).filter((s): s is string => Boolean(s)))]
  const skus = p.variants.map((v) => v.sku).filter((s): s is string => Boolean(s))
  const cover = p.images[0] ?? null
  return { product: p, variantCount: p.variants.length, price, stock, swatches, skus, cover: cover?.url ?? null, coverAlt: cover?.alt || p.name }
}

function variantsLabel(n: number) {
  return `${n} ${n === 1 ? 'variant' : 'variants'}`
}

function skuLabel(skus: string[]) {
  if (skus.length === 0) return null
  if (skus.length === 1) return skus[0]
  return `${skus.length} SKUs`
}

/** Price, or a range when variants differ, with the compare-at ("was") price underneath. */
function PriceCell({ price, align = 'left' }: { price: Row['price']; align?: 'left' | 'right' }) {
  if (!price) return <span className="text-[13px] text-ink-3">No price</span>
  const pct = price.compareAt ? Math.round(((price.compareAt - price.minor) / price.compareAt) * 100) : 0
  return (
    <span className={cn('flex flex-col', align === 'right' ? 'items-end' : 'items-start')}>
      <span className="tnum font-medium whitespace-nowrap text-ink">
        <Money minor={price.minor} currency={price.currency} />
        {price.from && (
          <>
            <span className="text-ink-3"> – </span>
            <Money minor={price.maxMinor} currency={price.currency} />
          </>
        )}
      </span>
      {price.compareAt && (
        <span className="tnum text-xs whitespace-nowrap text-ink-3">
          <span className="sr-only">was </span>
          <Money minor={price.compareAt} currency={price.currency} className="line-through" />
          {pct > 0 && <span> · −{pct}%</span>}
        </span>
      )}
    </span>
  )
}

/** Stock in words: totals, plus which variants are low or out. Colour always comes with a word. */
function StockText({ stock, align = 'left' }: { stock: Row['stock']; align?: 'left' | 'right' }) {
  if (!stock) return <span className="text-[13px] text-ink-3">Not tracked</span>
  const wrap = cn('flex flex-col text-[13px]', align === 'right' ? 'items-end' : 'items-start')
  if (stock.available <= 0) {
    return (
      <span className={wrap}>
        <span className="font-medium text-neg">Out of stock</span>
      </span>
    )
  }
  return (
    <span className={wrap}>
      <span className="tnum whitespace-nowrap text-ink-2">{stock.available} in stock</span>
      {stock.outCount > 0 ? (
        <span className="tnum text-xs whitespace-nowrap text-neg">
          {stock.outCount} {stock.outCount === 1 ? 'variant' : 'variants'} out
        </span>
      ) : stock.lowCount > 0 ? (
        <span className="tnum text-xs whitespace-nowrap text-warn">
          Low stock{stock.lowCount > 1 ? ` · ${stock.lowCount} variants` : ''}
        </span>
      ) : null}
    </span>
  )
}

function StatusBadges({ p, drop }: { p: Product; drop: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {p.status === 'active' ? (
        <Badge tone="pos" dot>
          Active
        </Badge>
      ) : (
        <Badge>{p.status === 'draft' ? 'Draft' : 'Archived'}</Badge>
      )}
      {drop && (
        <Badge tone="info">
          <CalendarClock className="size-3" aria-hidden /> Drop
        </Badge>
      )}
      {p.featured && <FeaturedBadge />}
    </span>
  )
}

function FeaturedBadge() {
  return (
    <Badge>
      <Star className="size-3 text-ink-3" aria-hidden /> Featured
    </Badge>
  )
}

function Swatches({ colours }: { colours: string[] }) {
  if (colours.length === 0) return null
  return (
    <span className="flex items-center -space-x-1" aria-label={`${colours.length} colours`} role="img">
      {colours.slice(0, 5).map((c) => (
        <span key={c} className="size-3 rounded-full ring-2 ring-panel" style={{ backgroundColor: c }} />
      ))}
      {colours.length > 5 && <span className="tnum pl-2 text-[11px] text-ink-3">+{colours.length - 5}</span>}
    </span>
  )
}

function useDropLabel() {
  const { org } = useOrg()
  const now = useNow()
  return (p: Product) => {
    if (!p.availableFrom) return null
    const t = Date.parse(p.availableFrom)
    if (Number.isNaN(t) || t <= now) return null
    return formatDateTime(p.availableFrom, org.locale, org.timezone, true)
  }
}

function GridCard({ r, drop, onOpen }: { r: Row; drop: string | null; onOpen: () => void }) {
  const p = r.product
  const muted = r.stock?.available === 0 || p.status !== 'active'
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group block w-full rounded-[var(--radius-card)] text-left focus-visible:outline-offset-4"
        aria-label={`${p.name}, edit`}
      >
        <Thumb
          src={r.cover}
          alt={r.coverAlt}
          rounded="rounded-[var(--radius-card)]"
          className={cn('w-full border border-line transition-colors group-hover:border-line-strong', muted && 'opacity-75')}
        />
        <span className="mt-2.5 block min-w-0">
          <span className="line-clamp-2 text-[13.5px] leading-snug font-medium text-ink group-hover:underline group-hover:underline-offset-2">
            {p.name}
          </span>
          <span className="mt-1 block text-[13px]">
            <PriceCell price={r.price} />
          </span>
          <span className="mt-1 flex items-center gap-2">
            <StockText stock={r.stock} />
            <Swatches colours={r.swatches} />
          </span>
          {(p.status !== 'active' || p.featured) && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {p.status !== 'active' && <Badge>{p.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
              {p.featured && <FeaturedBadge />}
            </span>
          )}
          {drop && <span className="tnum mt-1.5 block text-xs text-ink-3">Drops {drop}</span>}
        </span>
      </button>
    </li>
  )
}

function ProductTable({ rows, dropLabel, onOpen }: { rows: Row[]; dropLabel: (p: Product) => string | null; onOpen: (p: Product) => void }) {
  return (
    <Table>
      <caption className="sr-only">Products</caption>
      <thead>
        <tr>
          <Th>Product</Th>
          <Th className="hidden xl:table-cell">SKU · category</Th>
          <Th align="right">Price</Th>
          <Th>Stock</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const p = r.product
          const drop = dropLabel(p)
          return (
            <tr key={p.id} onClick={() => onOpen(p)} className="cursor-pointer transition-colors hover:bg-sunken/50">
              <Td className="py-2.5">
                <span className="flex min-w-0 items-center gap-3">
                  <Thumb src={r.cover} alt={r.coverAlt} rounded="rounded-md" className="size-10 shrink-0 border border-line" />
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(p)
                      }}
                      aria-label={`${p.name}, edit`}
                      className="block max-w-64 truncate rounded-sm text-left font-medium text-ink hover:underline hover:underline-offset-2"
                    >
                      {p.name}
                    </button>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <span className="tnum">{variantsLabel(r.variantCount)}</span>
                      <Swatches colours={r.swatches} />
                      {drop && <span className="tnum truncate">· Drops {drop}</span>}
                    </span>
                  </span>
                </span>
              </Td>
              <Td className="hidden xl:table-cell">
                <span className="block max-w-48 truncate text-[13px] text-ink-2">{skuLabel(r.skus) ?? <span className="text-ink-3">No SKU</span>}</span>
                <span className="block max-w-48 truncate text-xs text-ink-3">{p.category ?? 'No category'}</span>
              </Td>
              <Td align="right">
                <PriceCell price={r.price} align="right" />
              </Td>
              <Td>
                <StockText stock={r.stock} />
              </Td>
              <Td>
                <StatusBadges p={p} drop={drop} />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

function CompactRow({ r, drop, onOpen }: { r: Row; drop: string | null; onOpen: () => void }) {
  const p = r.product
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`${p.name}, edit`} className="flex w-full items-start gap-3 py-3 text-left transition-colors active:bg-sunken/60">
        <Thumb src={r.cover} alt={r.coverAlt} rounded="rounded-md" className="size-10 shrink-0 border border-line" />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 truncate text-[14px] font-medium text-ink">{p.name}</span>
            <span className="shrink-0 text-[13px]">
              <PriceCell price={r.price} align="right" />
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {[variantsLabel(r.variantCount), p.category, skuLabel(r.skus)].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StockText stock={r.stock} />
            {(p.status !== 'active' || drop || p.featured) && <StatusBadges p={p} drop={drop} />}
          </span>
        </span>
      </button>
    </li>
  )
}

export default function ProductsPage() {
  const products = useProducts()
  const { can } = useOrg()
  const canWrite = can('catalogue.write')
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [q, setQ] = useState('')
  const [rawView, setView] = useLocalString('rafu.productsView')
  // List is the default; the grid is an opt-in preference stored per device.
  const view: View = rawView === 'grid' ? 'grid' : 'list'
  const dropLabel = useDropLabel()
  // undefined = closed, null = new product, Product = editing
  const [open, setOpen] = useState<Product | null | undefined>(undefined)

  const all = useMemo(() => (products.data ?? []).map(summarise), [products.data])

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { active: 0, draft: 0, archived: 0, all: all.length }
    for (const r of all) out[r.product.status] += 1
    return out
  }, [all])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((r) => filter === 'all' || r.product.status === filter)
      .filter((r) => {
        if (!needle) return true
        const p = r.product
        return (
          p.name.toLowerCase().includes(needle) ||
          (p.category ?? '').toLowerCase().includes(needle) ||
          p.variants.some((v) => (v.sku ?? '').toLowerCase().includes(needle) || v.name.toLowerCase().includes(needle))
        )
      })
      .sort((a, b) => Number(b.product.featured) - Number(a.product.featured) || a.product.name.localeCompare(b.product.name))
  }, [all, filter, q])

  const filterLabel = FILTERS.find((f) => f.id === filter)?.label.toLowerCase()

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue. Photos, prices and stock here feed your shop and every new order."
        actions={
          canWrite && (
            <>
              <Link to="/app/products/import" className={buttonClass('secondary', 'md')}>
                <Upload className="size-4 text-ink-3" aria-hidden /> Import CSV
              </Link>
              <Button variant="brand" icon={<Plus className="size-4" strokeWidth={2.25} aria-hidden />} onClick={() => setOpen(null)}>
                Add product
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-4">
        <PillTabs
          tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: products.isPending ? undefined : counts[f.id] }))}
          value={filter}
          onChange={setFilter}
          label="Filter by status"
        />
        <div className="flex items-center gap-2">
          <label className="relative block min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU or category" className="pl-10" />
          </label>
          <div role="group" aria-label="Layout" className="ml-auto flex h-11 shrink-0 items-center gap-0.5 rounded-lg border border-line-strong bg-panel p-1">
            {(
              [
                { id: 'list', label: 'List view', icon: List },
                { id: 'grid', label: 'Grid view', icon: LayoutGrid },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={view === o.id}
                aria-label={o.label}
                title={o.label}
                onClick={() => setView(o.id === 'grid' ? 'grid' : null)}
                className={cn(
                  'flex size-9 items-center justify-center rounded-md transition-colors',
                  view === o.id ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink',
                )}
              >
                <o.icon className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>

      {!canWrite && products.isSuccess && products.data.length > 0 && (
        <p className="mb-4 text-xs text-ink-3">Your role can view the catalogue. Ask an owner, admin or manager to add or change products.</p>
      )}

      {products.isPending ? (
        view === 'grid' ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-square rounded-[var(--radius-card)]" />
                <Skeleton className="mt-2.5 h-4 w-3/4" />
                <Skeleton className="mt-1.5 h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-line border-y border-line" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="mt-1.5 h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        )
      ) : products.isError ? (
        <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
      ) : rows.length === 0 ? (
        products.data.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" aria-hidden />}
            title="No products yet"
            body="Add what you sell with a photo and a price. Sizes and colours become variants, each with its own stock."
            action={
              canWrite ? (
                <Button variant="brand" onClick={() => setOpen(null)}>
                  Add your first product
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            title="Nothing matches"
            body={q.trim() ? `No ${filter === 'all' ? '' : `${filterLabel} `}product matches “${q.trim()}”.` : `No ${filterLabel} products.`}
            action={
              <Button
                onClick={() => {
                  setQ('')
                  setFilter('all')
                }}
              >
                Show all products
              </Button>
            }
          />
        )
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((r) => (
            <GridCard key={r.product.id} r={r} drop={dropLabel(r.product)} onOpen={() => setOpen(r.product)} />
          ))}
        </ul>
      ) : (
        <>
          <div className="hidden lg:block">
            <ProductTable rows={rows} dropLabel={dropLabel} onOpen={(p) => setOpen(p)} />
          </div>
          <ul className="divide-y divide-line border-y border-line lg:hidden">
            {rows.map((r) => (
              <CompactRow key={r.product.id} r={r} drop={dropLabel(r.product)} onOpen={() => setOpen(r.product)} />
            ))}
          </ul>
        </>
      )}

      {!products.isPending && !products.isError && rows.length > 0 && (
        <p className="tnum mt-3 text-xs text-ink-3">
          {rows.length} of {counts.all} {counts.all === 1 ? 'product' : 'products'}
        </p>
      )}

      {open !== undefined && <ProductEditorSheet product={open ?? undefined} readOnly={!canWrite} onClose={() => setOpen(undefined)} />}
    </>
  )
}
