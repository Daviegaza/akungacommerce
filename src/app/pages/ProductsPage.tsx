import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Product, ProductStatus } from '@/gateway/types'
import { available, stockHealth, type StockHealth } from '@/domain/inventory'
import { useOrg, useProducts } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money } from '../ui/format'
import { Badge, Button, Input, Skeleton } from '../ui/primitives'
import { ProductEditorSheet } from '../components/ProductEditor'
import { cn } from '@/lib/utils'

type StatusFilter = ProductStatus | 'all'

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
  price: { minor: number; currency: string; from: boolean } | null
  stock: { available: number; health: StockHealth } | null
}

function summarise(p: Product): Row {
  const live = p.variants.filter((v) => v.isActive)
  const priced = live.length ? live : p.variants
  let price: Row['price'] = null
  if (priced.length) {
    const currency = priced[0].currency
    const same = priced.filter((v) => v.currency === currency).map((v) => v.priceMinor)
    const min = Math.min(...same)
    price = { minor: min, currency, from: same.some((m) => m !== min) }
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
  return { product: p, variantCount: p.variants.length, price, stock }
}

function StockCell({ stock, labelled }: { stock: Row['stock']; labelled?: boolean }) {
  if (!stock) return <span className="text-ink-3">{labelled ? 'Stock not tracked' : 'Not tracked'}</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tnum">
        {stock.available}
        {labelled && ' available'}
      </span>
      {stock.health === 'out' && <Badge tone="neg">Out</Badge>}
      {stock.health === 'low' && <Badge tone="warn">Low</Badge>}
    </span>
  )
}

function PriceText({ price }: { price: Row['price'] }) {
  if (!price) return <span className="text-ink-3">—</span>
  return (
    <span className="whitespace-nowrap">
      {price.from && <span className="mr-1 text-ink-3">from</span>}
      <Money minor={price.minor} currency={price.currency} />
    </span>
  )
}

function StatusTag({ status }: { status: ProductStatus }) {
  if (status === 'active') return null
  return <Badge>{status === 'draft' ? 'Draft' : 'Archived'}</Badge>
}

export default function ProductsPage() {
  const products = useProducts()
  const { can } = useOrg()
  const canWrite = can('catalogue.write')
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [q, setQ] = useState('')
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
      .sort((a, b) => a.product.name.localeCompare(b.product.name))
  }, [all, filter, q])

  const filterLabel = FILTERS.find((f) => f.id === filter)?.label.toLowerCase()

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue. Prices and stock here feed every new order."
        actions={
          canWrite && (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(null)}>
              Add product
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter by status" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors',
                filter === f.id ? 'bg-primary text-on-primary' : 'text-ink-2 hover:bg-sunken',
              )}
            >
              {f.label}
              <span className={cn('tnum text-xs', filter === f.id ? 'opacity-70' : 'text-ink-3')}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="relative block lg:w-72">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU or category" className="pl-9" />
        </label>
      </div>

      {!canWrite && products.isSuccess && products.data.length > 0 && (
        <p className="mb-4 text-xs text-ink-3">Your role can view the catalogue. Ask an owner, admin or manager to add or change products.</p>
      )}

      {products.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : products.isError ? (
        <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
      ) : rows.length === 0 ? (
        products.data.length === 0 ? (
          <EmptyState
            title="No products yet"
            body="Add what you sell with its price. Sizes and colours become variants, each with its own stock."
            action={
              canWrite ? (
                <Button variant="primary" onClick={() => setOpen(null)}>
                  Add product
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
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="hidden md:table-cell">Category</Th>
                  <Th align="right">Variants</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Available</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product.id} className="cursor-pointer hover:bg-sunken/60" onClick={() => setOpen(r.product)}>
                    <Td className="max-w-[280px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          className="truncate text-left font-medium text-ink hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen(r.product)
                          }}
                        >
                          {r.product.name}
                        </button>
                        <StatusTag status={r.product.status} />
                      </span>
                    </Td>
                    <Td className="hidden text-ink-2 md:table-cell">{r.product.category ?? <span className="text-ink-3">—</span>}</Td>
                    <Td align="right" className="text-ink-2">
                      {r.variantCount}
                    </Td>
                    <Td align="right">
                      <PriceText price={r.price} />
                    </Td>
                    <Td align="right">
                      <StockCell stock={r.stock} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {rows.map((r) => (
              <li key={r.product.id}>
                <button type="button" onClick={() => setOpen(r.product)} className="flex w-full items-start justify-between gap-3 py-3 text-left">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-ink">{r.product.name}</span>
                      <StatusTag status={r.product.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {[r.product.category, `${r.variantCount} ${r.variantCount === 1 ? 'variant' : 'variants'}`].filter(Boolean).join(' · ')}
                    </span>
                    <span className="mt-1.5 block text-xs text-ink-2">
                      <StockCell stock={r.stock} labelled />
                    </span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium text-ink">
                    <PriceText price={r.price} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open !== undefined && <ProductEditorSheet product={open ?? undefined} readOnly={!canWrite} onClose={() => setOpen(undefined)} />}
    </>
  )
}
