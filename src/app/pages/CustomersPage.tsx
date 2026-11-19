import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import type { Customer } from '@/gateway/types'
import { formatPhone } from '@/domain/locale'
import { useCustomers, useOrders, useOrg } from '../context'
import { EmptyState, ErrorNotice, PageHeader, Table, Td, Th } from '../ui/layout'
import { Phone, When } from '../ui/format'
import { Badge, Button, Input, Skeleton } from '../ui/primitives'
import { CustomerFormSheet } from '../components/CustomerForm'

interface OrderStats {
  count: number
  lastAt: string | null
}

function ConsentBadge({ consent }: { consent: boolean }) {
  return consent ? <Badge tone="pos">Marketing ok</Badge> : <Badge>No marketing</Badge>
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
  const { can } = useOrg()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const canWrite = can('customers.write')

  const stats = useMemo(() => {
    const map = new Map<string, OrderStats>()
    for (const o of orders.data ?? []) {
      if (!o.customerId || o.status === 'draft' || o.status === 'cancelled') continue
      const s = map.get(o.customerId) ?? { count: 0, lastAt: null }
      s.count += 1
      if (!s.lastAt || o.createdAt > s.lastAt) s.lastAt = o.createdAt
      map.set(o.customerId, s)
    }
    return map
  }, [orders.data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (customers.data ?? []).filter((c) => matchesSearch(c, needle)).sort((a, b) => a.name.localeCompare(b.name))
  }, [customers.data, q])

  const statFor = (id: string): OrderStats => stats.get(id) ?? { count: 0, lastAt: null }
  const ordersKnown = orders.isSuccess

  return (
    <>
      <PageHeader
        title="Customers"
        description="People who buy from you, with their order history and marketing consent."
        actions={
          canWrite && (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
              Add customer
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
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
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th className="hidden md:table-cell">Email</Th>
                  <Th className="hidden lg:table-cell">Tags</Th>
                  <Th>Marketing</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Last order</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = statFor(c.id)
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-sunken/60" onClick={() => navigate(`/app/customers/${c.id}`)}>
                      <Td className="max-w-[220px]">
                        <Link
                          to={`/app/customers/${c.id}`}
                          className="block truncate font-medium text-ink hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.name}
                        </Link>
                      </Td>
                      <Td>
                        <span onClick={(e) => e.stopPropagation()}>
                          <Phone e164={c.phoneE164} />
                        </span>
                      </Td>
                      <Td className="hidden max-w-[220px] truncate text-ink-2 md:table-cell">{c.email ?? <span className="text-ink-3">—</span>}</Td>
                      <Td className="hidden lg:table-cell">
                        {c.tags.length ? <TagList tags={c.tags} /> : <span className="text-ink-3">—</span>}
                      </Td>
                      <Td>
                        <ConsentBadge consent={c.marketingConsent} />
                      </Td>
                      <Td align="right">{ordersKnown ? s.count : '—'}</Td>
                      <Td align="right" className="text-ink-2">
                        {s.lastAt ? <When iso={s.lastAt} dateOnly /> : <span className="text-ink-3">—</span>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>

          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {rows.map((c) => {
              const s = statFor(c.id)
              return (
                <li key={c.id}>
                  <Link to={`/app/customers/${c.id}`} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-ink">{c.name}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-3">
                        {[c.phoneE164 ? formatPhone(c.phoneE164) : null, c.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <ConsentBadge consent={c.marketingConsent} />
                        <TagList tags={c.tags} max={2} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-[15px] font-medium text-ink">
                        {ordersKnown ? `${s.count} ${s.count === 1 ? 'order' : 'orders'}` : '—'}
                      </p>
                      {s.lastAt && (
                        <p className="mt-0.5 text-xs text-ink-3">
                          <When iso={s.lastAt} dateOnly />
                        </p>
                      )}
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
