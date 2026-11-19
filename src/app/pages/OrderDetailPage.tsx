import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle } from 'lucide-react'
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS, type OrderStatus } from '@/domain/orders'
import { summarisePayments, refundableMinor } from '@/domain/payments'
import { parseMajor, toMajorString, money } from '@/domain/money'
import { formatPhone, toE164 } from '@/domain/locale'
import type { CountryCode } from 'libphonenumber-js'
import { newIdempotencyKey } from '@/gateway/gateway'
import { CHANNEL_LABEL, PAYMENT_METHOD_LABEL, type FulfilmentPatch, type OrderDetail, type Payment, type PaymentMethod } from '@/gateway/types'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import { useAction, useOrder, useOrg } from '../context'
import { DefinitionList, EmptyState, ErrorNotice, Notice, PageHeader, Section, Sheet, Table, Td, Th } from '../ui/layout'
import { Money, OrderStatusBadge, PaymentStateBadge, Phone, VerificationBadge, When, useFormatMoney } from '../ui/format'
import { Badge, Button, Field, Input, Select, Skeleton, Textarea } from '../ui/primitives'

const FORWARD_LABEL: Partial<Record<OrderStatus, string>> = {
  pending_confirmation: 'Send for confirmation',
  confirmed: 'Confirm order',
  preparing: 'Start preparing',
  ready: 'Mark ready',
  dispatched: 'Dispatch',
  delivered: 'Mark delivered',
}

export default function OrderDetailPage() {
  const { orderId = '' } = useParams()
  const order = useOrder(orderId)

  if (order.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (order.isError) {
    return (
      <>
        <BackLink />
        <ErrorNotice error={order.error} onRetry={() => order.refetch()} />
      </>
    )
  }
  return <OrderView order={order.data} />
}

function BackLink() {
  return (
    <Link to="/app/orders" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Orders
    </Link>
  )
}

function OrderView({ order }: { order: OrderDetail }) {
  const { org } = useOrg()
  const summary = useMemo(() => summarisePayments(order, order.payments, order.refunds), [order])
  const fmt = useFormatMoney()

  const waText = `Hello${order.customerName ? ` ${order.customerName.split(' ')[0]}` : ''}, about your order #${order.number} from ${org.name}: total ${fmt(order.totalMinor, order.currency)}${summary.balanceDueMinor > 0 ? `, balance due ${fmt(summary.balanceDueMinor, order.currency)}` : ''}.`

  return (
    <>
      <PageHeader
        back={<BackLink />}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tnum">Order #{order.number}</span>
            <OrderStatusBadge status={order.status} />
          </span>
        }
        description={
          <>
            Placed <When iso={order.createdAt} /> · {CHANNEL_LABEL[order.channel]} · {order.fulfilmentMethod === 'delivery' ? 'Delivery' : 'Pickup'}
          </>
        }
        actions={<StatusActions order={order} />}
      />

      <div className="grid gap-x-12 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Section title="Items">
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right" className="hidden sm:table-cell">
                    Unit
                  </Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <p className="font-medium">{l.productName}</p>
                      <p className="text-xs text-ink-3">
                        {l.variantName !== 'Default' && `${l.variantName} · `}
                        {l.sku ?? 'No SKU'}
                        {l.discountMinor > 0 && <> · discount <Money minor={l.discountMinor} currency={l.currency} /></>}
                        {l.taxRateBps > 0 && ` · tax ${l.taxRateBps / 100}%`}
                        {l.returnedQuantity > 0 && ` · ${l.returnedQuantity} returned`}
                      </p>
                    </Td>
                    <Td align="right">{l.quantity}</Td>
                    <Td align="right" className="hidden sm:table-cell">
                      <Money minor={l.unitPriceMinor} currency={l.currency} />
                    </Td>
                    <Td align="right" className="font-medium">
                      <Money minor={l.totalMinor} currency={l.currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="mt-2 ml-auto max-w-xs text-sm">
              <TotalRow label="Subtotal" minor={order.subtotalMinor} currency={order.currency} />
              <TotalRow label={order.taxMode === 'inclusive' ? 'Tax included' : 'Tax'} minor={order.taxMinor} currency={order.currency} />
              {order.deliveryFeeMinor > 0 && <TotalRow label="Delivery" minor={order.deliveryFeeMinor} currency={order.currency} />}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>
                  <Money minor={order.totalMinor} currency={order.currency} />
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-3">Line prices are a permanent snapshot of the sale and do not change if catalogue prices change.</p>
            <ReturnItems order={order} />
          </Section>

          <PaymentsSection order={order} />
          <FulfilmentSection order={order} />

          <Section title="Timeline">
            <ol className="relative ml-1.5 border-l border-line">
              {[...order.history].reverse().map((h, i) => (
                <li key={i} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 border-canvas bg-ink-3" aria-hidden />
                  <p className="text-sm">
                    <span className="font-medium">{ORDER_STATUS_LABEL[h.toStatus]}</span>
                    {h.fromStatus && <span className="text-ink-3"> from {ORDER_STATUS_LABEL[h.fromStatus].toLowerCase()}</span>}
                  </p>
                  {h.note && <p className="text-sm text-ink-2">{h.note}</p>}
                  <p className="text-xs text-ink-3">
                    <When iso={h.createdAt} />
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="min-w-0">
          <Section title="Payment">
            <div className="mb-3 flex items-center gap-2">
              <PaymentStateBadge state={summary.state} />
            </div>
            <DefinitionList
              items={[
                { label: 'Order total', value: <Money minor={summary.totalMinor} currency={summary.currency} /> },
                { label: 'Recorded payments', value: <Money minor={summary.paidMinor} currency={summary.currency} /> },
                ...(summary.paidUnverifiedMinor > 0
                  ? [{ label: 'of which unverified', value: <Money minor={summary.paidUnverifiedMinor} currency={summary.currency} className="text-warn" /> }]
                  : []),
                ...(summary.refundedMinor > 0 ? [{ label: 'Refunded', value: <Money minor={-summary.refundedMinor} currency={summary.currency} /> }] : []),
                { label: 'Balance due', value: <Money minor={summary.balanceDueMinor} currency={summary.currency} className="font-semibold" /> },
              ]}
            />
          </Section>

          <Section title="Customer">
            {order.customerName || order.customerPhone ? (
              <div className="flex flex-col gap-2 text-sm">
                {order.customerId ? (
                  <Link to={`/app/customers/${order.customerId}`} className="font-medium hover:underline">
                    {order.customerName}
                  </Link>
                ) : (
                  <p className="font-medium">{order.customerName}</p>
                )}
                <Phone e164={order.customerPhone} />
                {order.customerPhone && (
                  <a
                    href={whatsappChatLink(order.customerPhone, waText)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <MessageCircle className="size-4" aria-hidden /> Open chat in WhatsApp
                  </a>
                )}
                <p className="text-xs text-ink-3">Opens your own WhatsApp with a prepared message. Nothing is sent automatically.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-3">Walk-in sale, no customer attached.</p>
            )}
          </Section>

          {order.note && (
            <Section title="Note">
              <p className="text-sm whitespace-pre-wrap text-ink-2">{order.note}</p>
            </Section>
          )}
        </aside>
      </div>
    </>
  )
}

function TotalRow({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  return (
    <div className="flex justify-between py-1">
      <dt className="text-ink-3">{label}</dt>
      <dd>
        <Money minor={minor} currency={currency} />
      </dd>
    </div>
  )
}

/* ───────────── Status changes ───────────── */
function StatusActions({ order }: { order: OrderDetail }) {
  const { can } = useOrg()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const transition = useAction((g, o, input: { to: OrderStatus; note: string | null }) => g.transitionOrder(o, order.id, input.to, input.note))

  const options = ORDER_TRANSITIONS[order.status]
  let forward = options.filter((s) => s !== 'cancelled')
  // For pickup orders "ready → delivered" means handed over; skip "dispatched".
  if (order.status === 'ready') forward = order.fulfilmentMethod === 'pickup' ? ['delivered'] : ['dispatched']
  if (order.status === 'confirmed') forward = ['preparing']
  const canCancel = options.includes('cancelled') && can('orders.create')
  if (!can('orders.transition') || options.length === 0) return null

  const label = (s: OrderStatus) => (order.fulfilmentMethod === 'pickup' && s === 'delivered' ? 'Mark collected' : FORWARD_LABEL[s] ?? ORDER_STATUS_LABEL[s])

  return (
    <>
      {transition.error && (
        <div className="w-full sm:w-auto">
          <ErrorNotice error={transition.error} />
        </div>
      )}
      {canCancel && (
        <Button variant="ghost" onClick={() => setCancelOpen(true)}>
          Cancel order
        </Button>
      )}
      {forward.map((s, i) => (
        <Button key={s} variant={i === 0 ? 'primary' : 'secondary'} loading={transition.isPending && transition.variables?.to === s} onClick={() => transition.mutate({ to: s, note: null })}>
          {label(s)}
        </Button>
      ))}
      <Sheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel order #${order.number}`}
        description="Reserved stock is released. Payments stay on record; refund them separately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={transition.isPending}
              onClick={async () => {
                await transition.mutateAsync({ to: 'cancelled', note: reason.trim() || null })
                setCancelOpen(false)
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        {transition.error && <ErrorNotice error={transition.error} />}
        <Field label="Reason" optional hint="Visible on the order timeline.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Sheet>
    </>
  )
}

/* ───────────── Payments ───────────── */
function PaymentsSection({ order }: { order: OrderDetail }) {
  const { can } = useOrg()
  const [recordOpen, setRecordOpen] = useState(false)
  const [refundFor, setRefundFor] = useState<Payment | null>(null)
  const [reverseFor, setReverseFor] = useState<Payment | null>(null)
  const canRecord = can('payments.record') && !['draft', 'cancelled'].includes(order.status)

  return (
    <Section
      title="Payments"
      description="Payments you record are marked manual and unverified until a connected provider confirms them."
      actions={
        canRecord && (
          <Button size="sm" variant="primary" onClick={() => setRecordOpen(true)}>
            Record payment
          </Button>
        )
      }
    >
      {order.payments.length === 0 ? (
        <EmptyState title="No payments recorded" body={order.status === 'draft' ? 'Confirm the order before recording payment.' : 'Record cash, transfer or mobile money once you have received it.'} />
      ) : (
        <ul className="divide-y divide-line">
          {order.payments.map((p) => {
            const refunds = order.refunds.filter((r) => r.paymentId === p.id)
            const refundable = refundableMinor(p, order.refunds)
            return (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Money minor={p.amountMinor} currency={p.currency} className={p.status === 'reversed' ? 'text-ink-3 line-through' : ''} />
                      <span className="ml-2 text-sm font-normal text-ink-2">{PAYMENT_METHOD_LABEL[p.method]}</span>
                    </p>
                    <p className="text-xs text-ink-3">
                      <When iso={p.receivedAt} />
                      {p.externalRef && <> · Ref <span className="font-mono">{p.externalRef}</span></>}
                      {p.note && <> · {p.note}</>}
                    </p>
                    {p.status === 'reversed' && <p className="mt-1 text-xs text-neg">Reversed: {p.reversedReason}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.status === 'reversed' ? <Badge>Reversed</Badge> : <VerificationBadge verification={p.verification} />}
                    {p.status === 'succeeded' && can('refunds.create') && refundable > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setRefundFor(p)}>
                        Refund
                      </Button>
                    )}
                    {p.status === 'succeeded' && p.verification === 'manual_unverified' && refunds.length === 0 && can('refunds.create') && (
                      <Button size="sm" variant="ghost" onClick={() => setReverseFor(p)}>
                        Reverse
                      </Button>
                    )}
                  </div>
                </div>
                {refunds.length > 0 && (
                  <ul className="mt-2 ml-3 border-l border-line pl-3 text-sm">
                    {refunds.map((r) => (
                      <li key={r.id} className="py-1">
                        <span className="text-neg">
                          Refund <Money minor={r.amountMinor} currency={r.currency} />
                        </span>
                        <span className="text-ink-3">
                          {' '}
                          · <When iso={r.createdAt} /> · {r.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {recordOpen && <RecordPaymentSheet order={order} onClose={() => setRecordOpen(false)} />}
      {refundFor && <RefundSheet order={order} payment={refundFor} onClose={() => setRefundFor(null)} />}
      {reverseFor && <ReverseSheet payment={reverseFor} onClose={() => setReverseFor(null)} />}
    </Section>
  )
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function RecordPaymentSheet({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const summary = summarisePayments(order, order.payments, order.refunds)
  const [key] = useState(newIdempotencyKey)
  const [amount, setAmount] = useState(summary.balanceDueMinor > 0 ? toMajorString(money(summary.balanceDueMinor, order.currency)) : '')
  const [method, setMethod] = useState<PaymentMethod>('mobile_money')
  const [ref, setRef] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()))
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const record = useAction<void>((g, o) =>
    g.recordManualPayment(
      o,
      {
        orderId: order.id,
        amountMinor: parseMajor(amount, order.currency).amountMinor,
        currency: order.currency,
        method,
        externalRef: ref.trim() || null,
        receivedAt: new Date(receivedAt).toISOString(),
        note: note.trim() || null,
      },
      key,
    ),
  )

  let amountError: string | null = null
  try {
    if (parseMajor(amount, order.currency).amountMinor <= 0) amountError = 'Enter an amount above zero'
  } catch (e) {
    amountError = (e as Error).message
  }
  const dateError = !receivedAt || Number.isNaN(new Date(receivedAt).getTime()) ? 'Enter a valid date and time' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (amountError || dateError) return
    await record.mutateAsync()
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record payment"
      description={`Order #${order.number} · ${order.currency}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="record-payment" loading={record.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="record-payment" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Notice tone="warn">
          This records money you say you received. It is saved as <strong>manual · unverified</strong> — Akunga has not confirmed it with any bank or provider. Check your
          statement before releasing goods on credit.
        </Notice>
        {record.error && <ErrorNotice error={record.error} />}
        <Field label={`Amount (${order.currency})`} error={touched ? amountError : null} hint={summary.balanceDueMinor > 0 ? 'Prefilled with the balance due.' : undefined}>
          {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
        </Field>
        <Field label="Method">
          {(p) => (
            <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reference" optional hint="Transaction code, slip number or receipt number.">
          {(p) => <Input {...p} value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} className="font-mono" />}
        </Field>
        <Field label="Received" hint="Your device's local time." error={touched ? dateError : null}>
          {(p) => <Input {...p} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />}
        </Field>
        <Field label="Note" optional>
          {(p) => <Textarea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
    </Sheet>
  )
}

function RefundSheet({ order, payment, onClose }: { order: OrderDetail; payment: Payment; onClose: () => void }) {
  const max = refundableMinor(payment, order.refunds)
  const [key] = useState(newIdempotencyKey)
  const [amount, setAmount] = useState(toMajorString(money(max, payment.currency)))
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const fmt = useFormatMoney()
  const refund = useAction<void>((g, o) =>
    g.recordRefund(o, { paymentId: payment.id, amountMinor: parseMajor(amount, payment.currency).amountMinor, currency: payment.currency, reason: reason.trim() }, key),
  )

  let amountError: string | null = null
  try {
    const m = parseMajor(amount, payment.currency).amountMinor
    if (m <= 0) amountError = 'Enter an amount above zero'
    else if (m > max) amountError = `At most ${fmt(max, payment.currency)} can be refunded on this payment`
  } catch (e) {
    amountError = (e as Error).message
  }
  const reasonError = reason.trim() ? null : 'A reason is required'

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record refund"
      description={`Against ${fmt(payment.amountMinor, payment.currency)} ${PAYMENT_METHOD_LABEL[payment.method].toLowerCase()} payment`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={refund.isPending}
            onClick={async () => {
              setTouched(true)
              if (amountError || reasonError) return
              await refund.mutateAsync()
              onClose()
            }}
          >
            Record refund
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="warn">Akunga records the refund; it does not send money. Return the funds through the original method, then record it here.</Notice>
        {refund.error && <ErrorNotice error={refund.error} />}
        <Field label={`Amount (${payment.currency})`} error={touched ? amountError : null} hint={`Up to ${fmt(max, payment.currency)}`}>
          {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Reason" error={touched ? reasonError : null}>
          {(p) => <Textarea {...p} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="text-xs text-ink-3">To put returned goods back on the shelf, use “Return items to stock” on the order.</p>
      </div>
    </Sheet>
  )
}

function ReverseSheet({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const reverse = useAction<void>((g, o) => g.reversePayment(o, payment.id, reason.trim()))
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reverse payment"
      description="For a payment recorded by mistake or one that bounced. It stays in the history, marked reversed."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={reverse.isPending}
            onClick={async () => {
              await reverse.mutateAsync()
              onClose()
            }}
          >
            Reverse payment
          </Button>
        </>
      }
    >
      {reverse.error && <ErrorNotice error={reverse.error} />}
      <Field label="Reason">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered twice, cheque bounced…" />}</Field>
    </Sheet>
  )
}

/* ───────────── Returns ───────────── */
function ReturnItems({ order }: { order: OrderDetail }) {
  const { can } = useOrg()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(newIdempotencyKey)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const returnable = order.lines.filter((l) => l.quantity - l.returnedQuantity > 0)
  const action = useAction<void>((g, o) =>
    g.returnItems(o, { orderId: order.id, note: note.trim() || null, lines: Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity })) }, key),
  )
  if (!['dispatched', 'delivered', 'refunded'].includes(order.status) || !can('refunds.create') || returnable.length === 0) return null
  const total = Object.values(qty).reduce((a, b) => a + b, 0)

  return (
    <>
      <Button size="sm" variant="ghost" className="mt-3 -ml-3" onClick={() => setOpen(true)}>
        Return items to stock
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Return items to stock"
        description="Adds returned units back to inventory. Record any money returned as a refund."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={total === 0}
              loading={action.isPending}
              onClick={async () => {
                await action.mutateAsync()
                setQty({})
                setNote('')
                setKey(newIdempotencyKey())
                setOpen(false)
              }}
            >
              Return {total || ''} {total === 1 ? 'item' : 'items'}
            </Button>
          </>
        }
      >
        {action.error && <ErrorNotice error={action.error} />}
        <ul className="divide-y divide-line">
          {returnable.map((l) => {
            const max = l.quantity - l.returnedQuantity
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.productName}</p>
                  <p className="text-xs text-ink-3">Up to {max}</p>
                </div>
                <Input
                  aria-label={`Quantity of ${l.productName} to return`}
                  inputMode="numeric"
                  className="w-20 text-center"
                  value={qty[l.id] ?? 0}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
                    setQty({ ...qty, [l.id]: Math.min(Math.max(v, 0), max) })
                  }}
                />
              </li>
            )
          })}
        </ul>
        <Field label="Note" optional className="mt-4">
          {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </Sheet>
    </>
  )
}

/* ───────────── Fulfilment ───────────── */
function FulfilmentSection({ order }: { order: OrderDetail }) {
  const { org, can } = useOrg()
  const f = order.fulfilment
  const [open, setOpen] = useState(false)
  const [assignee, setAssignee] = useState(f.assignee ?? '')
  const [tracking, setTracking] = useState(f.trackingRef ?? '')
  const [proof, setProof] = useState(f.proofOfDelivery ?? '')
  const [recipientPhone, setRecipientPhone] = useState(f.recipientPhone ? formatPhone(f.recipientPhone) : '')
  const update = useAction((g, o, patch: FulfilmentPatch) => g.updateFulfilment(o, order.id, patch))
  const phone = recipientPhone.trim() ? toE164(recipientPhone, org.countryCode as CountryCode) : null
  const a = f.address
  const addressText = [a.line1, a.line2, a.city, a.region, a.postalCode, a.countryCode].filter(Boolean).join(', ')

  return (
    <Section
      title="Fulfilment"
      actions={
        can('fulfilment.update') &&
        !['cancelled'].includes(order.status) && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Edit
          </Button>
        )
      }
    >
      <DefinitionList
        items={[
          { label: 'Method', value: f.method === 'delivery' ? 'Delivery' : 'Pickup' },
          ...(f.method === 'delivery'
            ? [
                { label: 'Recipient', value: f.recipientName ?? order.customerName ?? '—' },
                { label: 'Phone', value: <Phone e164={f.recipientPhone ?? order.customerPhone} /> },
                { label: 'Address', value: addressText || '—' },
                ...(a.instructions ? [{ label: 'Instructions', value: a.instructions }] : []),
              ]
            : []),
          { label: 'Assigned to', value: f.assignee ?? <span className="text-ink-3">Unassigned</span> },
          { label: 'Tracking ref', value: f.trackingRef ? <span className="font-mono">{f.trackingRef}</span> : '—' },
          { label: 'Proof of delivery', value: f.proofOfDelivery ?? '—' },
          { label: 'Delivered', value: f.deliveredAt ? <When iso={f.deliveredAt} /> : '—' },
        ]}
      />
      <p className="mt-2 text-xs text-ink-3">Courier tracking is recorded manually. No courier API is connected.</p>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Fulfilment details"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={update.isPending}
              disabled={phone ? !phone.ok : false}
              onClick={async () => {
                await update.mutateAsync({
                  assignee: assignee.trim() || null,
                  trackingRef: tracking.trim() || null,
                  proofOfDelivery: proof.trim() || null,
                  recipientPhone: phone?.ok ? phone.e164 : null,
                })
                setOpen(false)
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {update.error && <ErrorNotice error={update.error} />}
          <Field label="Assigned to" optional hint="Rider, driver or team member handling this order.">
            {(p) => <Input {...p} value={assignee} maxLength={120} onChange={(e) => setAssignee(e.target.value)} />}
          </Field>
          {f.method === 'delivery' && (
            <Field label="Recipient phone" optional error={phone && !phone.ok ? phone.error : null}>
              {(p) => <Input {...p} type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />}
            </Field>
          )}
          <Field label="Tracking reference" optional>
            {(p) => <Input {...p} value={tracking} maxLength={120} onChange={(e) => setTracking(e.target.value)} className="font-mono" />}
          </Field>
          <Field label="Proof of delivery" optional hint="Who received it, a signature note or photo reference.">
            {(p) => <Textarea {...p} rows={2} maxLength={1000} value={proof} onChange={(e) => setProof(e.target.value)} />}
          </Field>
        </div>
      </Sheet>
    </Section>
  )
}
