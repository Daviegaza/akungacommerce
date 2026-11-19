import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import type { OrderSummary } from '@/gateway/types'
import { COUNTRY_PRESETS } from '@/domain/locale'
import { divRoundHalfUp } from '@/domain/money'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import { useCustomers, useOrders, useOrg } from '../context'
import { DefinitionList, EmptyState, ErrorNotice, PageHeader, Section, Stat, Table, Td, Th } from '../ui/layout'
import { Money, OrderStatusBadge, PaymentStateBadge, Phone, When, paymentStateOf } from '../ui/format'
import { Badge, Button, Skeleton, buttonClass } from '../ui/primitives'
import { CustomerFormSheet } from '../components/CustomerForm'

interface CurrencyTotal {
  currency: string
  totalMinor: number
  count: number
}

function BackLink() {
  return (
    <Link to="/app/customers" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden />
      Customers
    </Link>
  )
}

function safeWhatsappLink(e164: string, name: string): string | null {
  try {
    const first = name.trim().split(/\s+/)[0] ?? ''
    return whatsappChatLink(e164, first ? `Hi ${first}, ` : '')
  } catch {
    return null
  }
}

function countryName(code: string | null): string | null {
  if (!code) return null
  return COUNTRY_PRESETS.find((c) => c.code === code.toUpperCase())?.name ?? code.toUpperCase()
}

function showsPayment(o: OrderSummary) {
  return o.status !== 'draft' && o.status !== 'cancelled'
}

export default function CustomerDetailPage() {
  const { customerId = '' } = useParams()
  const customers = useCustomers()
  const orders = useOrders()
  const { can } = useOrg()
  const [editing, setEditing] = useState(false)

  const customer = customers.data?.find((c) => c.id === customerId)

  const history = useMemo(
    () => (orders.data ?? []).filter((o) => o.customerId === customerId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [orders.data, customerId],
  )

  const totals = useMemo(() => {
    const map = new Map<string, CurrencyTotal>()
    for (const o of history) {
      if (o.status === 'draft' || o.status === 'cancelled') continue
      const t = map.get(o.currency) ?? { currency: o.currency, totalMinor: 0, count: 0 }
      t.totalMinor += o.totalMinor
      t.count += 1
      map.set(o.currency, t)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [history])
  const countedOrders = totals.reduce((n, t) => n + t.count, 0)

  if (customers.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-8 h-8 w-64" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (customers.isError) {
    return (
      <>
        <PageHeader title="Customer" back={<BackLink />} />
        <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} />
      </>
    )
  }

  if (!customer) {
    return (
      <>
        <PageHeader title="Customer not found" back={<BackLink />} />
        <EmptyState
          title="This customer doesn’t exist in this business"
          body="The link may be wrong, or the customer belongs to another business you can switch to."
          action={
            <Link to="/app/customers" className={buttonClass('secondary')}>
              Back to customers
            </Link>
          }
        />
      </>
    )
  }

  const waLink = customer.phoneE164 ? safeWhatsappLink(customer.phoneE164, customer.name) : null
  const newOrderHref = `/app/orders/new?customer=${encodeURIComponent(customer.id)}`

  return (
    <>
      <PageHeader
        title={customer.name}
        back={<BackLink />}
        description={
          <>
            Customer since <When iso={customer.createdAt} dateOnly />
          </>
        }
        actions={
          <>
            {can('customers.write') && (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
            {can('orders.create') && (
              <Link to={newOrderHref} className={buttonClass('primary')}>
                <Plus className="size-4" aria-hidden /> New order for this customer
              </Link>
            )}
          </>
        }
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0">
          <Section title="Lifetime value" description="Order totals excluding drafts and cancelled orders. Each currency is kept separate.">
            {orders.isPending ? (
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : orders.isError ? (
              <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                <Stat label="Orders" value={countedOrders} foot={history.length > countedOrders ? `${history.length - countedOrders} draft or cancelled` : undefined} />
                {totals.length === 0 ? (
                  <Stat label="Spent" value={<span className="text-ink-3">—</span>} foot="No completed orders yet" />
                ) : (
                  totals.map((t) => (
                    <Stat
                      key={t.currency}
                      label={totals.length > 1 ? `Spent · ${t.currency}` : 'Spent'}
                      value={<Money minor={t.totalMinor} currency={t.currency} />}
                      foot={
                        <>
                          Average <Money minor={divRoundHalfUp(t.totalMinor, t.count)} currency={t.currency} /> over {t.count}{' '}
                          {t.count === 1 ? 'order' : 'orders'}
                        </>
                      }
                    />
                  ))
                )}
              </div>
            )}
          </Section>

          <Section title="Orders">
            {orders.isPending ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : orders.isError ? (
              <p className="text-sm text-ink-3">Order history is unavailable until orders load.</p>
            ) : history.length === 0 ? (
              <EmptyState
                title="No orders yet"
                body={`Orders placed for ${customer.name} will appear here.`}
                action={
                  can('orders.create') ? (
                    <Link to={newOrderHref} className={buttonClass('primary')}>
                      New order for this customer
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="hidden sm:block">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Order</Th>
                        <Th>Placed</Th>
                        <Th>Status</Th>
                        <Th>Payment</Th>
                        <Th align="right">Total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((o) => (
                        <tr key={o.id}>
                          <Td>
                            <Link to={`/app/orders/${o.id}`} className="tnum font-medium text-ink hover:underline">
                              #{o.number}
                            </Link>
                          </Td>
                          <Td className="text-ink-2">
                            <When iso={o.createdAt} />
                          </Td>
                          <Td>
                            <OrderStatusBadge status={o.status} />
                          </Td>
                          <Td>{showsPayment(o) && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}</Td>
                          <Td align="right" className="font-medium">
                            <Money minor={o.totalMinor} currency={o.currency} />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <ul className="divide-y divide-line border-y border-line sm:hidden">
                  {history.map((o) => (
                    <li key={o.id}>
                      <Link to={`/app/orders/${o.id}`} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="tnum text-[15px] font-medium text-ink">#{o.number}</p>
                          <p className="mt-0.5 text-xs text-ink-3">
                            <When iso={o.createdAt} />
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <OrderStatusBadge status={o.status} />
                            {showsPayment(o) && <PaymentStateBadge state={paymentStateOf(o.totalMinor, o.netPaidMinor)} />}
                          </div>
                        </div>
                        <Money minor={o.totalMinor} currency={o.currency} className="text-[15px] font-medium" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        </div>

        <div className="min-w-0">
          <Section title="Contact">
            <DefinitionList
              items={[
                {
                  label: 'Phone',
                  value: customer.phoneE164 ? (
                    <span className="flex flex-col items-end gap-1">
                      <Phone e164={customer.phoneE164} />
                      {waLink && (
                        <a href={waLink} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent hover:underline">
                          Message on WhatsApp<span className="sr-only"> (opens your WhatsApp in a new tab)</span>
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-3">Not set</span>
                  ),
                },
                {
                  label: 'Email',
                  value: customer.email ? (
                    <a href={`mailto:${customer.email}`} className="break-all hover:underline">
                      {customer.email}
                    </a>
                  ) : (
                    <span className="text-ink-3">Not set</span>
                  ),
                },
                { label: 'Country', value: countryName(customer.countryCode) ?? <span className="text-ink-3">Not set</span> },
                {
                  label: 'Marketing',
                  value: customer.marketingConsent ? <Badge tone="pos">Agreed</Badge> : <Badge>Not agreed</Badge>,
                },
                { label: 'Customer since', value: <When iso={customer.createdAt} dateOnly /> },
              ]}
            />
            {!customer.marketingConsent && (
              <p className="mt-2 text-xs text-ink-3">Don’t send promotions to this customer. Order updates are fine.</p>
            )}
          </Section>

          <Section title="Tags">
            {customer.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {customer.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-3">No tags.</p>
            )}
          </Section>

          <Section title="Notes">
            {customer.notes ? (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">{customer.notes}</p>
            ) : (
              <p className="text-sm text-ink-3">No notes.</p>
            )}
          </Section>
        </div>
      </div>

      {editing && <CustomerFormSheet customer={customer} onClose={() => setEditing(false)} />}
    </>
  )
}
