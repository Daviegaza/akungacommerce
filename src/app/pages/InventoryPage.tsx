import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { StockMovement } from '@/gateway/types'
import { ADJUSTMENT_REASON_LABEL, available, stockHealth, type StockHealth, type StockMovementKind } from '@/domain/inventory'
import { useMovements, useOrg, useProducts } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Section, Table, Td, Th } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Input, Skeleton, buttonClass } from '../ui/primitives'
import { StockAdjustSheet, type StockTarget } from '../components/StockAdjustSheet'
import { cn } from '@/lib/utils'

type HealthFilter = 'all' | 'low' | 'out'

const FILTERS: { id: HealthFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'low', label: 'Low' },
  { id: 'out', label: 'Out' },
]

const KIND_LABEL: Record<StockMovementKind, string> = {
  receipt: 'Received',
  adjustment: 'Adjustment',
  reservation: 'Reserved',
  release: 'Released',
  sale: 'Sold',
  return: 'Returned',
}

const MOVEMENTS_PAGE = 50

interface StockRow extends StockTarget {
  threshold: number
  available: number
  health: StockHealth
  inactive: boolean
}

function HealthBadge({ health }: { health: StockHealth }) {
  if (health === 'out') return <Badge tone="neg">Out</Badge>
  if (health === 'low') return <Badge tone="warn">Low</Badge>
  return <Badge tone="pos">In stock</Badge>
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-3">—</span>
  return <span className={cn('tnum font-medium', value > 0 ? 'text-pos' : 'text-neg')}>{value > 0 ? `+${value}` : `−${Math.abs(value)}`}</span>
}

function reasonText(m: StockMovement): string | null {
  const reason = m.reason ? (ADJUSTMENT_REASON_LABEL[m.reason as keyof typeof ADJUSTMENT_REASON_LABEL] ?? m.reason) : null
  return [reason, m.note].filter(Boolean).join(' · ') || null
}

function MovementOrderLink({ orderId }: { orderId: string | null }) {
  if (!orderId) return null
  return (
    <Link to={`/app/orders/${orderId}`} className="whitespace-nowrap text-ink underline-offset-2 hover:underline">
      View order
    </Link>
  )
}

export default function InventoryPage() {
  const products = useProducts()
  const movements = useMovements()
  const { can } = useOrg()
  const canAdjust = can('inventory.adjust')
  const [filter, setFilter] = useState<HealthFilter>('all')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<StockTarget | null>(null)
  const [movementLimit, setMovementLimit] = useState(MOVEMENTS_PAGE)

  const allRows = useMemo(() => {
    const out: StockRow[] = []
    for (const p of products.data ?? []) {
      if (!p.trackStock) continue
      for (const v of p.variants) {
        out.push({
          variantId: v.id,
          productName: p.name,
          variantName: v.name,
          sku: v.sku,
          onHand: v.onHand,
          reserved: v.reserved,
          threshold: v.lowStockThreshold,
          available: available(v),
          health: stockHealth(v, v.lowStockThreshold),
          inactive: !v.isActive || p.status === 'archived',
        })
      }
    }
    return out.sort((a, b) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName))
  }, [products.data])

  const counts = useMemo(
    () => ({
      all: allRows.length,
      low: allRows.filter((r) => r.health === 'low').length,
      out: allRows.filter((r) => r.health === 'out').length,
    }),
    [allRows],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return allRows.filter(
      (r) =>
        (filter === 'all' || r.health === filter) &&
        (!needle ||
          r.productName.toLowerCase().includes(needle) ||
          r.variantName.toLowerCase().includes(needle) ||
          (r.sku ?? '').toLowerCase().includes(needle)),
    )
  }, [allRows, filter, q])

  const sortedMovements = useMemo(
    () => [...(movements.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [movements.data],
  )
  const visibleMovements = sortedMovements.slice(0, movementLimit)

  const toTarget = (r: StockRow): StockTarget => ({
    variantId: r.variantId,
    productName: r.productName,
    variantName: r.variantName,
    sku: r.sku,
    onHand: r.onHand,
    reserved: r.reserved,
  })

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock for every tracked variant. Available is on hand minus what open orders have reserved."
      />

      <Section>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by stock level" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
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
            <span className="sr-only">Search stock</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, variant or SKU" className="pl-9" />
          </label>
        </div>

        {!canAdjust && products.isSuccess && allRows.length > 0 && (
          <p className="mb-4 text-xs text-ink-3">Your role can view stock but not adjust it. Ask an owner, admin or manager to record changes.</p>
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
          allRows.length === 0 ? (
            <EmptyState
              title="No stock-tracked products"
              body="Turn on “Track stock” for a product to count units here. Services and made-to-order items can stay untracked."
              action={
                <Link to="/app/products" className={buttonClass('primary')}>
                  Go to products
                </Link>
              }
            />
          ) : (
            <EmptyState
              title={filter === 'all' ? 'Nothing matches' : filter === 'low' ? 'Nothing is running low' : 'Nothing is out of stock'}
              body={q.trim() ? `No variant matches “${q.trim()}” in this view.` : 'Every tracked variant is above its low-stock alert.'}
              action={
                <Button
                  onClick={() => {
                    setQ('')
                    setFilter('all')
                  }}
                >
                  Show all stock
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
                    <Th>Item</Th>
                    <Th className="hidden md:table-cell">SKU</Th>
                    <Th align="right">On hand</Th>
                    <Th align="right">Reserved</Th>
                    <Th align="right">Available</Th>
                    <Th align="right" className="hidden lg:table-cell">
                      Alert at
                    </Th>
                    <Th>Status</Th>
                    {canAdjust && (
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.variantId} className={cn(r.inactive && 'text-ink-3')}>
                      <Td className="max-w-[280px]">
                        <p className="truncate font-medium text-ink">{r.productName}</p>
                        <p className="truncate text-xs text-ink-3">
                          {r.variantName}
                          {r.inactive && ' · not for sale'}
                        </p>
                      </Td>
                      <Td className="tnum hidden text-ink-2 md:table-cell">{r.sku ?? <span className="text-ink-3">—</span>}</Td>
                      <Td align="right">{r.onHand}</Td>
                      <Td align="right" className="text-ink-2">
                        {r.reserved}
                      </Td>
                      <Td align="right" className="font-semibold text-ink">
                        {r.available}
                      </Td>
                      <Td align="right" className="hidden text-ink-3 lg:table-cell">
                        {r.threshold}
                      </Td>
                      <Td>
                        <HealthBadge health={r.health} />
                      </Td>
                      {canAdjust && (
                        <Td align="right">
                          <Button size="sm" onClick={() => setTarget(toTarget(r))} aria-label={`Adjust stock for ${r.productName}, ${r.variantName}`}>
                            Adjust
                          </Button>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <ul className="divide-y divide-line border-y border-line sm:hidden">
              {rows.map((r) => (
                <li key={r.variantId} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-ink">{r.productName}</p>
                    <p className="truncate text-xs text-ink-3">
                      {[r.variantName, r.sku, r.inactive ? 'not for sale' : null].filter(Boolean).join(' · ')}
                    </p>
                    <p className="tnum mt-1.5 text-xs text-ink-2">
                      <span className="font-semibold text-ink">{r.available}</span> available · {r.onHand} on hand · {r.reserved} reserved
                    </p>
                    <div className="mt-2">
                      <HealthBadge health={r.health} />
                    </div>
                  </div>
                  {canAdjust && (
                    <Button size="sm" onClick={() => setTarget(toTarget(r))} aria-label={`Adjust stock for ${r.productName}, ${r.variantName}`}>
                      Adjust
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Stock movements" description="Every change to on-hand and reserved stock, newest first.">
        {movements.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : movements.isError ? (
          <ErrorNotice error={movements.error} onRetry={() => movements.refetch()} />
        ) : sortedMovements.length === 0 ? (
          <EmptyState
            title="No stock movements yet"
            body="Receiving stock, manual adjustments and orders reserving or selling units will be listed here."
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Item</Th>
                    <Th>Type</Th>
                    <Th align="right">On hand</Th>
                    <Th align="right">Reserved</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.map((m) => (
                    <tr key={m.id}>
                      <Td className="text-ink-2">
                        <When iso={m.createdAt} />
                      </Td>
                      <Td className="max-w-[240px]">
                        <span className="block truncate">
                          {m.productName} <span className="text-ink-3">· {m.variantName}</span>
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">{KIND_LABEL[m.kind] ?? m.kind}</Td>
                      <Td align="right">
                        <Delta value={m.onHandDelta} />
                      </Td>
                      <Td align="right">
                        <Delta value={m.reservedDelta} />
                      </Td>
                      <Td className="max-w-[260px] text-ink-2">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          {reasonText(m) && <span className="break-words">{reasonText(m)}</span>}
                          <MovementOrderLink orderId={m.orderId} />
                          {!reasonText(m) && !m.orderId && <span className="text-ink-3">—</span>}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <ul className="divide-y divide-line border-y border-line sm:hidden">
              {visibleMovements.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {m.productName} <span className="font-normal text-ink-3">· {m.variantName}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {KIND_LABEL[m.kind] ?? m.kind} · <When iso={m.createdAt} />
                    </p>
                    {(reasonText(m) || m.orderId) && (
                      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-2">
                        {reasonText(m) && <span className="break-words">{reasonText(m)}</span>}
                        <MovementOrderLink orderId={m.orderId} />
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p>
                      <Delta value={m.onHandDelta} /> <span className="text-xs text-ink-3">on hand</span>
                    </p>
                    {m.reservedDelta !== 0 && (
                      <p className="mt-0.5">
                        <Delta value={m.reservedDelta} /> <span className="text-xs text-ink-3">reserved</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {sortedMovements.length > movementLimit && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="tnum text-xs text-ink-3">
                  Showing {visibleMovements.length} of {sortedMovements.length}
                </p>
                <Button size="sm" onClick={() => setMovementLimit((n) => n + MOVEMENTS_PAGE)}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </Section>

      {target && <StockAdjustSheet target={target} onClose={() => setTarget(null)} />}
    </>
  )
}
