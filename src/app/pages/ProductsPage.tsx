import { useMemo, useState } from 'react'
import { CalendarClock, LayoutGrid, List, Package, Plus, Search, Star } from 'lucide-react'
import type { Product, ProductStatus } from '@/gateway/types'
import { available, stockHealth, type StockHealth } from '@/domain/inventory'
import { formatDateTime } from '@/domain/locale'
import { cn } from '@/lib/utils'
import { useOrg, useProducts } from '../context'
import { EmptyState, ErrorNotice, PageHeader } from '../ui/layout'
import { Money } from '../ui/format'
import { Badge, Button, Input, PillTabs, Skeleton, Thumb } from '../ui/primitives'
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
  price: { minor: number; currency: string; from: boolean; compareAt: number | null } | null
  stock: { available: number; health: StockHealth } | null
  swatches: string[]
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
    const compareAt = cheapest.compareAtMinor != null && cheapest.compareAtMinor > cheapest.priceMinor ? cheapest.compareAtMinor : null
    price = { minor: cheapest.priceMinor, currency, from: same.some((v) => v.priceMinor !== cheapest.priceMinor), compareAt }
  }
  let stock: Row['stock'] = null
  if (p.trackStock) {
    let total = 0
    let worst: StockHealth = 'ok'
    for (const v of live) {
      total += available(v)
      const h = stockHealth(v, v.lowStockThreshold)
      if (HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h
    }
    stock = { available: total, health: live.length ? worst : 'out' }
  }
  const swatches = [...new Set(live.map((v) => v.swatch).filter((s): s is string => Boolean(s)))]
  const cover = p.images[0] ?? null
  return { product: p, variantCount: p.variants.length, price, stock, swatches, cover: cover?.url ?? null, coverAlt: cover?.alt || p.name }
}

function PriceLine({ price, large }: { price: Row['price']; large?: boolean }) {
  if (!price) return <span className="text-sm text-ink-3">No price</span>
  const pct = price.compareAt ? Math.round(((price.compareAt - price.minor) / price.compareAt) * 100) : 0
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {price.from && <span className="text-xs text-ink-3">from</span>}
      <Money minor={price.minor} currency={price.currency} className={cn('font-display font-extrabold tracking-tight text-ink', large ? 'text-[17px]' : 'text-[15px]')} />
      {price.compareAt && (
        <>
          <span className="text-xs text-ink-3">
            <span className="sr-only">was </span>
            <Money minor={price.compareAt} currency={price.currency} className="line-through" />
          </span>
          {pct > 0 && <span className="rounded-full bg-mango px-1.5 py-px text-[10px] font-bold text-on-mango">−{pct}%</span>}
        </>
      )}
    </span>
  )
}

function StockPill({ stock }: { stock: Row['stock'] }) {
  if (!stock) return <Badge>Not tracked</Badge>
  if (stock.health === 'out') return <Badge tone="neg">Out of stock</Badge>
  if (stock.health === 'low') return <Badge tone="warn">{stock.available} left</Badge>
  return <Badge tone="pos">{stock.available} in stock</Badge>
}

function Swatches({ colours }: { colours: string[] }) {
  if (colours.length === 0) return null
  return (
    <span className="flex items-center -space-x-1" aria-label={`${colours.length} colours`} role="img">
      {colours.slice(0, 5).map((c) => (
        <span key={c} className="size-3.5 rounded-full ring-2 ring-panel" style={{ backgroundColor: c }} />
      ))}
      {colours.length > 5 && <span className="pl-2 text-[11px] text-ink-3">+{colours.length - 5}</span>}
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
  const out = r.stock?.health === 'out'
  return (
    <li className="ak-rise">
      <button type="button" onClick={onOpen} className="group block w-full rounded-[var(--radius-card)] text-left focus-visible:outline-offset-4" aria-label={`${p.name}, edit`}>
        <span className="relative block overflow-hidden rounded-[var(--radius-card)] bg-sunken shadow-[var(--shadow-card)] ring-1 ring-line/60 transition-shadow duration-200 group-hover:shadow-[var(--shadow-lift)]">
          <Thumb
            src={r.cover}
            alt={r.coverAlt}
            rounded="rounded-none"
            className={cn('w-full transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:scale-[1.04]', (out || p.status !== 'active') && 'opacity-80')}
          />
          <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
            {p.status !== 'active' && <Badge className="bg-panel/90 text-ink shadow-sm backdrop-blur">{p.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
            {drop && (
              <Badge tone="mango" className="shadow-sm">
                <CalendarClock className="size-3" aria-hidden /> Drop
              </Badge>
            )}
          </span>
          {p.featured && (
            <span className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-mango text-on-mango shadow-sm" title="Featured">
              <Star className="size-4 fill-current" aria-hidden />
              <span className="sr-only">Featured</span>
            </span>
          )}
          {out ? (
            <span className="absolute inset-0 flex items-center justify-center bg-[#160f1e]/40">
              <span className="rounded-full bg-panel px-3 py-1 text-xs font-bold text-ink shadow">Out of stock</span>
            </span>
          ) : (
            r.stock && (
              <span className="absolute bottom-2 left-2">
                <span
                  className={cn(
                    'tnum inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold shadow-sm backdrop-blur',
                    r.stock.health === 'low' ? 'bg-warn-soft/95 text-warn' : 'bg-panel/90 text-ink',
                  )}
                >
                  {r.stock.health === 'low' ? `Only ${r.stock.available} left` : `${r.stock.available} in stock`}
                </span>
              </span>
            )
          )}
        </span>
        <span className="mt-2.5 block px-0.5">
          <span className="line-clamp-2 text-sm leading-snug font-semibold text-ink">{p.name}</span>
          <span className="mt-1 block">
            <PriceLine price={r.price} />
          </span>
          <span className="mt-1 flex items-center gap-2 text-xs text-ink-3">
            <span>
              {r.variantCount} {r.variantCount === 1 ? 'variant' : 'variants'}
            </span>
            <Swatches colours={r.swatches} />
          </span>
          {drop && <span className="mt-1 block text-[11px] font-semibold text-warn">Drops {drop}</span>}
        </span>
      </button>
    </li>
  )
}

function ListRow({ r, drop, onOpen }: { r: Row; drop: string | null; onOpen: () => void }) {
  const p = r.product
  return (
    <li className="ak-rise">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-sunken sm:gap-4">
        <span className="relative shrink-0">
          <Thumb src={r.cover} alt={r.coverAlt} className="size-14 sm:size-16" />
          {p.featured && (
            <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-mango text-on-mango ring-2 ring-panel" title="Featured">
              <Star className="size-3 fill-current" aria-hidden />
              <span className="sr-only">Featured</span>
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{p.name}</span>
            {p.status !== 'active' && <Badge>{p.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
            {drop && (
              <Badge tone="mango">
                <CalendarClock className="size-3" aria-hidden /> Drop
              </Badge>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-2 truncate text-xs text-ink-3">
            {[p.category, `${r.variantCount} ${r.variantCount === 1 ? 'variant' : 'variants'}`].filter(Boolean).join(' · ')}
            <Swatches colours={r.swatches} />
          </span>
          <span className="mt-1.5 block sm:hidden">
            <StockPill stock={r.stock} />
          </span>
        </span>
        <span className="hidden shrink-0 sm:block">
          <StockPill stock={r.stock} />
        </span>
        <span className="w-28 shrink-0 text-right">
          <PriceLine price={r.price} />
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
  const view: View = rawView === 'list' ? 'list' : 'grid'
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
        description="Your shelf. Photos, prices and stock here feed your shop and every new order."
        actions={
          canWrite && (
            <Button variant="brand" icon={<Plus className="size-4" strokeWidth={2.5} aria-hidden />} onClick={() => setOpen(null)}>
              Add product
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        <PillTabs
          tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: products.isPending ? undefined : counts[f.id] }))}
          value={filter}
          onChange={setFilter}
          label="Filter by status"
        />
        <div className="flex items-center gap-2">
          <label className="relative block flex-1 sm:max-w-sm">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU or category" className="rounded-full pl-10" />
          </label>
          <div role="group" aria-label="Layout" className="ml-auto flex shrink-0 rounded-full bg-panel p-1 ring-1 ring-line">
            {(
              [
                { id: 'grid', label: 'Grid view', icon: LayoutGrid },
                { id: 'list', label: 'List view', icon: List },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={view === o.id}
                aria-label={o.label}
                title={o.label}
                onClick={() => setView(o.id === 'grid' ? null : 'list')}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full transition-colors',
                  view === o.id ? 'bg-primary text-on-primary' : 'text-ink-3 hover:text-ink',
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-square rounded-[var(--radius-card)]" />
                <Skeleton className="mt-2.5 h-4 w-3/4" />
                <Skeleton className="mt-1.5 h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )
      ) : products.isError ? (
        <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
      ) : rows.length === 0 ? (
        products.data.length === 0 ? (
          <EmptyState
            icon={<Package className="size-6" aria-hidden />}
            title="Your shelf is empty"
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
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
          {rows.map((r) => (
            <GridCard key={r.product.id} r={r} drop={dropLabel(r.product)} onOpen={() => setOpen(r.product)} />
          ))}
        </ul>
      ) : (
        <ul className="-mx-2 flex flex-col rounded-[var(--radius-card)] sm:mx-0 sm:bg-panel sm:p-2 sm:shadow-[var(--shadow-card)] sm:ring-1 sm:ring-line/60">
          {rows.map((r) => (
            <ListRow key={r.product.id} r={r} drop={dropLabel(r.product)} onOpen={() => setOpen(r.product)} />
          ))}
        </ul>
      )}

      {open !== undefined && <ProductEditorSheet product={open ?? undefined} readOnly={!canWrite} onClose={() => setOpen(undefined)} />}
    </>
  )
}
