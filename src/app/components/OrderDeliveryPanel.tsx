import { useState } from 'react'
import { AlertTriangle, Check, Copy, Link2, Package, Truck, Bike } from 'lucide-react'
import { FAILED_REASONS, FAILED_REASON_LABEL, RIDER_LINK_DEFAULT_HOURS, riderLinkState, type FailedReason } from '@/domain/delivery-policy'
import { newIdempotencyKey } from '@/gateway/gateway'
import { HANDOFF_LABEL, type CreatedRiderLink, type HandoffKind, type OrderDelivery } from '@/gateway/delivery'
import type { OrderDetail } from '@/gateway/types'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import { useAction, useOrg, useOrgQuery } from '../context'
import { DefinitionList, ErrorNotice, Notice, Section, Sheet } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Badge, Button, Field, Input, Select, Skeleton, Textarea } from '../ui/primitives'

/** Deposit, handoff (own rider link / pick-up point / courier) and failed deliveries for one order. */
export function OrderDeliveryPanel({ order }: { order: OrderDetail }) {
  const query = useOrgQuery('order-delivery', (g, o) => g.getOrderDelivery(o, order.id), [order.id, order.updatedAt, order.history.length])
  if (query.isPending) return <Skeleton className="mb-8 h-40 w-full rounded-2xl" />
  if (query.isError) return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
  return <PanelBody order={order} d={query.data} />
}

function PanelBody({ order, d }: { order: OrderDetail; d: OrderDelivery }) {
  const { can } = useOrg()
  const canEdit = can('fulfilment.update') && !['delivered', 'cancelled', 'refunded'].includes(order.status)
  const delivery = order.fulfilment.method === 'delivery'
  const [failOpen, setFailOpen] = useState(false)
  const failedEvents = d.events.filter((e) => e.kind === 'failed')
  const outOfAttempts = d.attempts >= d.maxAttempts

  return (
    <Section
      title="Deposit and delivery"
      description={delivery ? 'Who carries the order, and what happens if a delivery fails.' : 'Deposit for this pickup order.'}
      actions={
        canEdit &&
        delivery &&
        order.status === 'dispatched' &&
        !outOfAttempts && (
          <Button size="sm" variant="ghost" icon={<AlertTriangle className="size-4" aria-hidden />} onClick={() => setFailOpen(true)}>
            Delivery failed
          </Button>
        )
      }
    >
      <DefinitionList
        items={[
          ...(d.depositDueMinor > 0
            ? [
                {
                  label: d.depositDueMinor >= d.totalMinor ? 'Due before dispatch' : 'Deposit due',
                  value: (
                    <span className="inline-flex items-center gap-2">
                      <Money minor={d.depositDueMinor} currency={d.currency} />
                      {d.depositPaidMinor >= d.depositDueMinor ? <Badge tone="pos">Received</Badge> : <Badge tone="warn">Not received</Badge>}
                    </span>
                  ),
                },
              ]
            : [{ label: 'Deposit', value: <span className="text-ink-3">None on this order</span> }]),
          { label: 'Balance due', value: <Money minor={d.balanceDueMinor} currency={d.currency} /> },
          ...(delivery ? [{ label: 'Delivery attempts', value: `${d.attempts} of ${d.maxAttempts}` }] : []),
          ...(d.forfeitedMinor > 0 ? [{ label: 'Kept for failed trips', value: <Money minor={d.forfeitedMinor} currency={d.currency} /> }] : []),
          ...(delivery && d.handoff.kind ? [{ label: 'Handoff', value: handoffText(d) }] : []),
        ]}
      />
      {!d.agreedPolicy && delivery && (
        <p className="mt-2 text-xs text-ink-3">Created by staff: no buyer policy was agreed, so nothing is kept from payments for a failed trip.</p>
      )}
      {d.depositDueMinor > d.depositPaidMinor && ['confirmed', 'preparing', 'ready'].includes(order.status) && (
        <div className="mt-3">
          <Notice tone="warn">The deposit has not been received. Riders on a Rafu link cannot mark this order picked up until it is.</Notice>
        </div>
      )}

      {failedEvents.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm" aria-label="Failed delivery attempts">
          {failedEvents.map((e) => (
            <li key={`${e.attempt}-${e.createdAt}`} className="rounded-xl bg-warn-soft px-3 py-2 text-ink">
              <span className="font-semibold">Attempt {e.attempt} failed</span> · {e.reason ? FAILED_REASON_LABEL[e.reason] : 'Other'}
              {e.actor === 'rider' && ' · reported by rider'}
              {e.forfeitedMinor > 0 && (
                <>
                  {' '}
                  · kept <Money minor={e.forfeitedMinor} currency={d.currency} />
                </>
              )}
              {e.note && <span className="block text-ink-2">{e.note}</span>}
              <span className="block text-xs text-ink-3">
                <When iso={e.createdAt} />
              </span>
            </li>
          ))}
          {outOfAttempts && order.status === 'dispatched' && (
            <li>
              <Notice tone="warn">
                No delivery attempts left. When the goods are back, use “Return items to stock”, then refund what is owed to the buyer
                {d.forfeitedMinor > 0 ? ' (the kept delivery fee is yours)' : ''}.
              </Notice>
            </li>
          )}
        </ul>
      )}

      {delivery && canEdit && <HandoffEditor order={order} d={d} />}
      {failOpen && <FailedSheet order={order} d={d} onClose={() => setFailOpen(false)} />}
    </Section>
  )
}

function handoffText(d: OrderDelivery): string {
  if (d.handoff.kind === 'pickup_point') return `${HANDOFF_LABEL.pickup_point}: ${d.handoff.pickupPoint?.name ?? '—'}`
  if (d.handoff.kind === 'courier') return `${HANDOFF_LABEL.courier}: ${d.handoff.carrier ?? '—'}`
  if (d.handoff.kind === 'own_rider') return d.riderLink?.acceptedName ? `Own rider: ${d.riderLink.acceptedName}` : HANDOFF_LABEL.own_rider
  return '—'
}

function HandoffEditor({ order, d }: { order: OrderDetail; d: OrderDelivery }) {
  const [kind, setKind] = useState<HandoffKind>(d.handoff.kind ?? 'own_rider')
  return (
    <div className="mt-4 rounded-2xl border border-line p-3">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">How does it go out?</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {(
            [
              ['own_rider', <Bike key="b" className="size-4" aria-hidden />],
              ['pickup_point', <Package key="p" className="size-4" aria-hidden />],
              ['courier', <Truck key="t" className="size-4" aria-hidden />],
            ] as const
          ).map(([k, icon]) => (
            <label
              key={k}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-xs font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand sm:text-sm ${
                kind === k ? 'border-brand bg-brand-soft/60 text-ink' : 'border-line-strong text-ink-2 hover:bg-sunken'
              }`}
            >
              <input type="radio" name={`handoff-${order.id}`} className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              {icon}
              {HANDOFF_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        {kind === 'own_rider' && <RiderLinkBox order={order} d={d} />}
        {kind === 'pickup_point' && <PickupPointChooser order={order} d={d} />}
        {kind === 'courier' && <CourierForm order={order} d={d} />}
      </div>
    </div>
  )
}

function RiderLinkBox({ order, d }: { order: OrderDetail; d: OrderDelivery }) {
  const [riderName, setRiderName] = useState('')
  const [created, setCreated] = useState<CreatedRiderLink | null>(null)
  const [copied, setCopied] = useState(false)
  const create = useAction<void, CreatedRiderLink>((g, o) => g.createRiderLink(o, order.id, { riderName: riderName.trim() || null, hours: RIDER_LINK_DEFAULT_HOURS }))
  const revoke = useAction<void>((g, o) => g.revokeRiderLink(o, order.id))
  const link = d.riderLink
  const state = link ? riderLinkState(link, new Date()) : null
  const url = created ? `${window.location.origin}/r/${created.token}` : null
  const outOfAttempts = d.attempts >= d.maxAttempts
  const tooEarly = ['draft', 'pending_confirmation'].includes(order.status)

  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-2">
        Send your rider a link. No app or account: they see the pickup and drop-off, accept, and tap picked up, delivered or failed. The buyer’s number stays hidden until they accept.
      </p>
      {link && state === 'active' && !created && (
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={link.acceptedAt ? 'pos' : 'info'} dot>
            {link.acceptedAt ? `Accepted by ${link.acceptedName}` : 'Link sent, not accepted yet'}
          </Badge>
          <span className="text-xs text-ink-3">
            Expires <When iso={link.expiresAt} />
          </span>
        </p>
      )}
      {url && (
        <div className="rounded-xl bg-brand-soft p-3">
          <p className="text-xs font-medium text-ink-2">Rider link (shown once; works for {RIDER_LINK_DEFAULT_HOURS} hours)</p>
          <p className="mt-1 break-all font-mono text-xs text-ink select-all">{url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="brand"
              icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-sunken"
              href={`https://wa.me/?text=${encodeURIComponent(`Delivery for order #${order.number}: ${url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Link2 className="size-4" aria-hidden /> Send on WhatsApp
            </a>
          </div>
        </div>
      )}
      {(create.error || revoke.error) && <ErrorNotice error={create.error ?? revoke.error} />}
      {outOfAttempts ? (
        <p className="text-xs text-ink-3">All delivery attempts are used, so no new rider link can be made.</p>
      ) : tooEarly ? (
        <p className="text-xs text-ink-3">Confirm the order first.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Rider name" optional className="min-w-40 flex-1">
            {(p) => <Input {...p} value={riderName} maxLength={60} onChange={(e) => setRiderName(e.target.value)} placeholder="e.g. Otieno" />}
          </Field>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (r) => setCreated(r) })}>
            {link && state === 'active' ? 'Make a new link' : 'Create rider link'}
          </Button>
          {link && state === 'active' && (
            <Button
              variant="ghost"
              loading={revoke.isPending}
              onClick={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => setCreated(null),
                })
              }
            >
              Cancel link
            </Button>
          )}
        </div>
      )}
      {order.customerPhone && url && (
        <a className="text-xs font-medium text-ink-2 underline underline-offset-2" href={whatsappChatLink(order.customerPhone, `Your order #${order.number} is on its way with our rider.`)} target="_blank" rel="noopener noreferrer">
          Tell the buyer it’s on the way (WhatsApp)
        </a>
      )}
    </div>
  )
}

function PickupPointChooser({ order, d }: { order: OrderDetail; d: OrderDelivery }) {
  const points = useOrgQuery('pickup-points', (g, o) => g.listPickupPoints(o))
  const active = (points.data ?? []).filter((p) => p.active)
  const [id, setId] = useState(d.handoff.pickupPoint?.id ?? '')
  const save = useAction<void>((g, o) => g.setOrderHandoff(o, order.id, { kind: 'pickup_point', pickupPointId: id }))
  if (points.isPending) return <Skeleton className="h-10 w-full" />
  if (active.length === 0) return <p className="text-sm text-ink-3">No pick-up points yet. Add them under My shop → Pick-up points.</p>
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Pick-up point" className="min-w-48 flex-1">
        {(p) => (
          <Select {...p} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose…</option>
            {active.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.name}
                {pt.area ? ` (${pt.area})` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button variant="primary" disabled={!id} loading={save.isPending} onClick={() => save.mutate()}>
        Save
      </Button>
      {save.error && <div className="w-full"><ErrorNotice error={save.error} /></div>}
    </div>
  )
}

function CourierForm({ order, d }: { order: OrderDetail; d: OrderDelivery }) {
  const [carrier, setCarrier] = useState(d.handoff.carrier ?? '')
  const [ref, setRef] = useState(order.fulfilment.trackingRef ?? '')
  const save = useAction<void>((g, o) => g.setOrderHandoff(o, order.id, { kind: 'courier', carrier: carrier.trim(), trackingRef: ref.trim() || null }))
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Courier">
          {(p) => <Input {...p} value={carrier} maxLength={80} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. G4S, Wells Fargo, a matatu sacco" />}
        </Field>
        <Field label="Tracking number" optional>
          {(p) => <Input {...p} value={ref} maxLength={120} className="font-mono" onChange={(e) => setRef(e.target.value)} />}
        </Field>
      </div>
      <p className="text-xs text-ink-3">Recorded by hand and shown to the buyer. No courier system is connected.</p>
      {save.error && <ErrorNotice error={save.error} />}
      <Button variant="primary" size="sm" disabled={!carrier.trim()} loading={save.isPending} onClick={() => save.mutate()}>
        Save courier
      </Button>
    </div>
  )
}

function FailedSheet({ order, d, onClose }: { order: OrderDetail; d: OrderDelivery; onClose(): void }) {
  const [reason, setReason] = useState<FailedReason>('buyer_unreachable')
  const [note, setNote] = useState('')
  const [key] = useState(newIdempotencyKey)
  const mark = useAction<void>((g, o) => g.markDeliveryFailed(o, order.id, { reason, note: note.trim() || null }, key))
  const buyerFault = ['buyer_unreachable', 'buyer_refused', 'wrong_address', 'buyer_rescheduled'].includes(reason)
  const keeps = d.agreedPolicy?.failedDeliveryPayer === 'buyer' && buyerFault
  const remaining = Math.max(0, d.depositPaidMinor - d.forfeitedMinor)
  const keepMinor = keeps ? Math.min(d.deliveryFeeMinor, remaining) : 0

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delivery failed · order #${order.number}`}
      description={`Attempt ${d.attempts + 1} of ${d.maxAttempts}. The buyer sees this on their tracking page.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={mark.isPending} onClick={async () => {
            await mark.mutateAsync()
            onClose()
          }}>
            Record failed delivery
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mark.error && <ErrorNotice error={mark.error} />}
        <Field label="What happened?">
          {(p) => (
            <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as FailedReason)}>
              {FAILED_REASONS.map((r) => (
                <option key={r} value={r}>
                  {FAILED_REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Note for your team" optional hint="Not shown to the buyer.">
          {(p) => <Textarea {...p} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Notice tone={keepMinor > 0 ? 'warn' : 'info'}>
          {keepMinor > 0 ? (
            <>
              Per the policy the buyer agreed to, <Money minor={keepMinor} currency={d.currency} /> of their deposit is kept for this trip.
            </>
          ) : !d.agreedPolicy ? (
            'No buyer policy on this order, so nothing is kept.'
          ) : buyerFault ? (
            d.agreedPolicy.failedDeliveryPayer === 'seller' ? 'Your policy: you pay for the return trip. Nothing is kept.' : 'No paid deposit is left to keep from.'
          ) : (
            'Not the buyer’s fault, so nothing is kept from their payment.'
          )}
          {d.attempts + 1 >= d.maxAttempts && ' This is the last attempt; open rider links will be cancelled.'}
        </Notice>
      </div>
    </Sheet>
  )
}
