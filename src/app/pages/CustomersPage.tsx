import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, MessageCircleHeart, Plus, Search } from 'lucide-react'
import type { Customer } from '@/gateway/types'
import { formatPhone } from '@/domain/locale'
import { canExportCustomers } from '@/domain/marketing'
import { customersCsv, downloadCsv } from '@/integrations/csv'
import { useCustomers, useGateway, useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Money, Phone, When } from '../ui/format'
import { Badge, Button, Input, Skeleton, buttonClass } from '../ui/primitives'
import { cn } from '@/lib/utils'
import { CustomerFormSheet } from '../components/CustomerForm'

interface OrderStats {
  count: number
  lastAt: string | null
  /** Order totals per currency. Different currencies are never added together. */
  spent: Map<string, number>
}

const EMPTY_STATS: OrderStats = { count: 0, lastAt: null, spent: new Map() }

function ConsentBadge({ consent }: { consent: boolean }) {
  return consent ? (
    <Badge tone="pos" dot>
      Agreed to offers
    </Badge>
  ) : (
    <span className="text-[13px] whitespace-nowrap text-ink-3">No offers</span>
  )
}

/** One line per currency, base currency first. */
function SpentCell({ spent, baseCurrency, className }: { spent: Map<string, number>; baseCurrency: string; className?: string }) {
  if (spent.size === 0) return <span className="text-ink-3">—</span>
  const entries = [...spent.entries()].sort(([a], [b]) => (a === baseCurrency ? -1 : b === baseCurrency ? 1 : a.localeCompare(b)))
  return (
    <span className={cn('inline-flex flex-col items-end', className)}>
      {entries.map(([currency, minor]) => (
        <Money key={currency} minor={minor} currency={currency} className="whitespace-nowrap" />
      ))}
    </span>
  )
}

function TagList({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t}>{t}</Badge>
      ))}
      {tags.length > max && <span className="self-center text-xs text-ink-3">+{tags.length - max}</span>}
    </span>
  )
}

function matchesSearch(c: Customer, needle: string): boolean {
  if (!needle) return true
  const digits = needle.replace(/[\s()-]/g, '')
  return (
    c.name.toLowerCase().includes(needle) ||
    (c.email ?? '').toLowerCase().includes(needle) ||
    (digits.length > 0 && /^\+?\d+$/.test(digits) && (c.phoneE164 ?? '').includes(digits.replace(/^0+/, ''))) ||
    c.tags.some((t) => t.toLowerCase().includes(needle))
  )
}

export default function CustomersPage() {
  const customers = useCustomers()
  const orders = useOrders()
  const { can, org } = useOrg()
  const gateway = useGateway()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<unknown>(null)
  const canWrite = can('customers.write')
  const canExport = canExportCustomers(org.role)

  async function exportList() {
    setExporting(true)
    setExportError(null)
    try {
      const rows = await gateway.exportCustomers(org.id)
      const day = new Date().toISOString().slice(0, 10)
      downloadCsv(`customers-${day}.csv`, customersCsv(rows))
    } catch (e) {
      setExportError(e)
    } finally {
      setExporting(false)
    }
  }

  const stats = useMemo(() => {
    const map = new Map<string, OrderStats>()
    for (const o of orders.data ?? []) {
      if (!o.customerId || o.status === 'draft' || o.status === 'cancelled') continue
      const s = map.get(o.customerId) ?? { count: 0, lastAt: null, spent: new Map<string, number>() }
      s.count += 1
      if (!s.lastAt || o.createdAt > s.lastAt) s.lastAt = o.createdAt
      s.spent.set(o.currency, (s.spent.get(o.currency) ?? 0) + o.totalMinor)
      map.set(o.customerId, s)
    }
    return map
  }, [orders.data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (customers.data ?? []).filter((c) => matchesSearch(c, needle)).sort((a, b) => a.name.localeCompare(b.name))
  }, [customers.data, q])

  const statFor = (id: string): OrderStats => stats.get(id) ?? EMPTY_STATS
  const ordersKnown = orders.isSuccess

  return (
    <>
      <PageHeader
        title="Customers"
        description="People who buy from you, with their order history and marketing consent."
        actions={
          <>
            {canWrite && (
              <Link to="/app/customers/reach-out" className={buttonClass('secondary')}>
                <MessageCircleHeart className="size-4" aria-hidden /> Reach out
              </Link>
            )}
            {canExport && (
              <Button icon={<Download className="size-4" aria-hidden />} onClick={() => void exportList()} loading={exporting}>
                Export CSV
              </Button>
            )}
            {canWrite && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
                Add customer
              </Button>
            )}
          </>
        }
      />

      {exportError != null && (
        <div className="mb-4">
          <ErrorNotice error={exportError} />
        </div>
      )}

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-80">
          <span className="sr-only">Search customers</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email or tag" className="pl-9" />
        </label>
        {customers.isSuccess && customers.data.length > 0 && (
          <p className="tnum text-xs text-ink-3" aria-live="polite">
            {rows.length === customers.data.length ? `${rows.length} customers` : `${rows.length} of ${customers.data.length} customers`}
          </p>
        )}
      </div>

      {orders.isError && (
        <div className="mb-4">
          <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
        </div>
      )}

      {customers.isPending ? (
        <div className="divide-y divide-line border-y border-line" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      ) : customers.isError ? (
        <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />
      ) : rows.length === 0 ? (
        customers.data.length === 0 ? (
          <EmptyState
            title="No customers yet"
            body="Add the people you sell to, or create them while taking an order. Their orders and spend collect here."
            action={
              canWrite ? (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add customer
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            title="Nothing matches"
            body={`No customer matches “${q.trim()}”.`}
            action={
              <Button variant="secondary" onClick={() => setQ('')}>
                Clear search
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="hidden lg:block">
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Spent</Th>
                  <Th align="right">Last order</Th>
                  <Th>Marketing</Th>
                  <Th className="hidden xl:table-cell">Tags</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = statFor(c.id)
                  return (
                    <tr key={c.id} className="cursor-pointer transition-colors hover:bg-sunken/60" onClick={() => navigate(`/app/customers/${c.id}`)}>
                      <Td className="max-w-[260px]">
                        <Link
                          to={`/app/customers/${c.id}`}
                          className="block truncate font-medium text-ink hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.name}
                        </Link>
                        {c.email && <span className="mt-0.5 block truncate text-xs text-ink-3">{c.email}</span>}
                      </Td>
                      <Td className="tnum whitespace-nowrap text-ink-2">
                        <span onClick={(e) => e.stopPropagation()}>
                          <Phone e164={c.phoneE164} />
                        </span>
                      </Td>
                      <Td align="right">{ordersKnown ? s.count : '—'}</Td>
                      <Td align="right" className="font-medium text-ink">
                        {ordersKnown ? <SpentCell spent={s.spent} baseCurrency={org.baseCurrency} /> : '—'}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-ink-2">
                        {s.lastAt ? <When iso={s.lastAt} dateOnly /> : <span className="text-ink-3">—</span>}
                      </Td>
                      <Td>
                        <ConsentBadge consent={c.marketingConsent} />
                      </Td>
                      <Td className="hidden xl:table-cell">
                        {c.tags.length ? <TagList tags={c.tags} /> : <span className="text-ink-3">—</span>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>

          <ul className="-mx-4 divide-y divide-line border-y border-line px-4 sm:mx-0 sm:px-0 lg:hidden">
            {rows.map((c) => {
              const s = statFor(c.id)
              return (
                <li key={c.id}>
                  <Link to={`/app/customers/${c.id}`} className="flex min-h-14 items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-ink">{c.name}</p>
                      <p className="tnum mt-0.5 truncate text-xs text-ink-3">
                        {[c.phoneE164 ? formatPhone(c.phoneE164) : null, c.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <ConsentBadge consent={c.marketingConsent} />
                        <TagList tags={c.tags} max={2} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[14px]">
                      {ordersKnown && s.spent.size > 0 && <SpentCell spent={s.spent} baseCurrency={org.baseCurrency} className="tnum font-medium text-ink" />}
                      <p className="tnum mt-0.5 text-xs text-ink-3">
                        {ordersKnown ? `${s.count} ${s.count === 1 ? 'order' : 'orders'}` : '—'}
                        {s.lastAt && (
                          <>
                            {' · '}
                            <When iso={s.lastAt} dateOnly />
                          </>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {adding && <CustomerFormSheet onClose={() => setAdding(false)} onSaved={(id) => navigate(`/app/customers/${id}`)} />}
    </>
  )
}
