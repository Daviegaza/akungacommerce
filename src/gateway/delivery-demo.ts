/**
 * Demo implementation of deposits, failed deliveries and delivery handoff.
 * Shares the browser-local demo state with demo.ts and storefront-demo.ts and
 * enforces the same rules as supabase/migrations/20261120000030_deposits_handoff.sql,
 * using the pure functions in src/domain/delivery-policy.ts.
 *
 * Note: demoInternals is only read inside functions (never at module top level)
 * because demo.ts and this module import each other.
 */
import {
  DEFAULT_SHOP_POLICY,
  FAILED_REASONS,
  FAILED_REASON_LABEL,
  PolicyError,
  amountsDue,
  applyFailedDelivery,
  computeDeposit,
  isWellFormedRiderToken,
  maskPhone,
  planReturnToShop,
  riderLinkHours,
  riderLinkState,
  validateShopPolicy,
  type FailedReason,
  type ShopPolicy,
} from '@/domain/delivery-policy'
import { canTransition, holdsReservation, needsReturnFlow, type OrderStatus } from '@/domain/orders'
import { demoInternals, randomToken, type DemoState, type StoredOrder } from './demo'
import type {
  CheckoutOptions,
  CreatedRiderLink,
  DeliveryAdminGateway,
  DeliveryEvent,
  DeliveryEventKind,
  FailedDeliveryResult,
  Handoff,
  HandoffKind,
  OrderDelivery,
  PickupPoint,
  PickupPointInput,
  PickupPointSnapshot,
  RefundSuggestion,
  ReturnToShopResult,
  RiderAction,
  RiderJob,
  TrackedDelivery,
} from './delivery'

/* ───────────── Extension state (stored inside the demo state object) ───────────── */

interface OrderExt {
  depositDueMinor: number
  attempts: number
  forfeitedMinor: number
  agreedPolicy: ShopPolicy | null
  handoff: HandoffKind | null
  carrier: string | null
  pickupPoint: PickupPointSnapshot | null
  /** Set when the order came back to the shop (optional: older saved demo states lack it). */
  returnedAt?: string | null
}

interface StoredRefundSuggestion extends RefundSuggestion {
  orgId: string
  orderId: string
}

interface StoredEvent extends DeliveryEvent {
  orgId: string
  orderId: string
  idempotencyKey: string | null
}

interface StoredRiderLink {
  id: string
  orgId: string
  orderId: string
  /** The demo keeps the token itself (same browser); Supabase stores only its SHA-256. */
  token: string
  riderName: string | null
  expiresAt: string
  acceptedAt: string | null
  acceptedName: string | null
  revokedAt: string | null
  createdAt: string
}

interface DeliveryExt {
  v: 1
  policies: Record<string, ShopPolicy>
  pickupPoints: (PickupPoint & { orgId: string })[]
  orders: Record<string, OrderExt>
  events: StoredEvent[]
  riderLinks: StoredRiderLink[]
  /** Optional so demo states saved before "returned to shop" still load. */
  refundSuggestions?: StoredRefundSuggestion[]
}

type ExtState = DemoState & { deliveryExt?: DeliveryExt }

const I = () => demoInternals

function fail(message: string, code = 'invalid'): never {
  return I().fail(message, code)
}

/** Seed: a deposit rule for the Kenyan demo shop and generic pick-up points (no named network). */
function seedExt(s: DemoState): DeliveryExt {
  const ext: DeliveryExt = { v: 1, policies: {}, pickupPoints: [], orders: {}, events: [], riderLinks: [] }
  for (const org of s.orgs) {
    if (org.baseCurrency === 'KES') {
      ext.policies[org.id] = {
        ...DEFAULT_SHOP_POLICY,
        paymentMode: 'deposit',
        depositKind: 'percent',
        depositPercentBps: 3000,
        depositMinOrderMinor: 200_000,
        depositCoversDelivery: true,
        failedDeliveryPayer: 'buyer',
        maxDeliveryAttempts: 2,
      }
      const points: [string, string, string, number][] = [
        ['Pick-up point · CBD', 'Moi Avenue, Nairobi CBD', 'Mon–Sat 8am–7pm', 10_000],
        ['Pick-up point · Westlands', 'Near Sarit Centre', 'Mon–Sun 9am–8pm', 12_000],
        ['Pick-up point · Rongai', 'Rongai stage', 'Mon–Sat 8am–6pm', 15_000],
      ]
      points.forEach(([name, area, hours, feeMinor], i) =>
        ext.pickupPoints.push({ id: `pp-${i + 1}-${org.id}`, orgId: org.id, name, area, hours, feeMinor, active: true, position: i }),
      )
    } else {
      ext.pickupPoints.push({
        id: `pp-1-${org.id}`,
        orgId: org.id,
        name: 'Pick-up point · Kreuzberg',
        area: 'Oranienstraße',
        hours: 'Mo–Sa 10–19 Uhr',
        feeMinor: 390,
        active: true,
        position: 0,
      })
    }
  }
  return ext
}

function ext(s: DemoState): DeliveryExt {
  const st = s as ExtState
  if (!st.deliveryExt || st.deliveryExt.v !== 1) st.deliveryExt = seedExt(s)
  return st.deliveryExt
}

function orderExt(s: DemoState, orderId: string): OrderExt {
  const e = ext(s)
  e.orders[orderId] ??= { depositDueMinor: 0, attempts: 0, forfeitedMinor: 0, agreedPolicy: null, handoff: null, carrier: null, pickupPoint: null }
  return e.orders[orderId]
}

/* ───────────── Shared helpers (also used by storefront-demo.ts) ───────────── */

export function demoPolicyFor(s: DemoState, orgId: string): ShopPolicy {
  return { ...(ext(s).policies[orgId] ?? DEFAULT_SHOP_POLICY) }
}

export function demoActivePickupPoints(s: DemoState, orgId: string): PickupPoint[] {
  return ext(s)
    .pickupPoints.filter((p) => p.orgId === orgId && p.active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map(({ orgId: _o, ...p }) => {
      void _o
      return p
    })
}

export function demoCheckoutOptions(s: DemoState, orgId: string): CheckoutOptions {
  return {
    policy: demoPolicyFor(s, orgId),
    pickupPoints: demoActivePickupPoints(s, orgId).map(({ active: _a, position: _p, ...p }) => {
      void _a
      void _p
      return p
    }),
  }
}

/** Called by the demo storefront right after a guest order is created. */
export function demoRecordCheckout(
  s: DemoState,
  orderId: string,
  data: { depositDueMinor: number; agreedPolicy: ShopPolicy; pickupPoint: PickupPointSnapshot | null },
): void {
  const o = orderExt(s, orderId)
  o.depositDueMinor = data.depositDueMinor
  o.agreedPolicy = { ...data.agreedPolicy }
  if (data.pickupPoint) {
    o.handoff = 'pickup_point'
    o.pickupPoint = { ...data.pickupPoint }
  }
}

function netPaid(s: DemoState, orderId: string): number {
  const paid = s.payments.filter((p) => p.orderId === orderId && p.status === 'succeeded').reduce((a, p) => a + p.amountMinor, 0)
  const refunded = s.refunds.filter((r) => r.orderId === orderId && r.status === 'succeeded').reduce((a, r) => a + r.amountMinor, 0)
  return paid - refunded
}

function maxAttemptsFor(s: DemoState, order: StoredOrder): number {
  const o = orderExt(s, order.id)
  return (o.agreedPolicy ?? demoPolicyFor(s, order.orgId)).maxDeliveryAttempts
}

function handoffOf(s: DemoState, orderId: string): Handoff {
  const o = orderExt(s, orderId)
  return { kind: o.handoff, carrier: o.carrier, pickupPoint: o.pickupPoint ? { ...o.pickupPoint } : null }
}

function eventsOf(s: DemoState, orderId: string): DeliveryEvent[] {
  return ext(s)
    .events.filter((e) => e.orderId === orderId)
    .map(({ orgId: _o, orderId: _id, idempotencyKey: _k, ...e }) => {
      void _o
      void _id
      void _k
      return e
    })
}

const BUYER_EVENT_KINDS: readonly DeliveryEventKind[] = ['failed', 'picked_up', 'delivered', 'returned']

function suggestionsOf(s: DemoState): StoredRefundSuggestion[] {
  const e = ext(s)
  e.refundSuggestions ??= []
  return e.refundSuggestions
}

function latestSuggestion(s: DemoState, orderId: string): StoredRefundSuggestion | null {
  const list = suggestionsOf(s).filter((x) => x.orderId === orderId)
  return list.length ? list[list.length - 1] : null
}

function publicSuggestion(x: StoredRefundSuggestion): RefundSuggestion {
  const { orgId: _o, orderId: _id, ...rest } = x
  void _o
  void _id
  return { ...rest }
}

export function demoTrackedDelivery(s: DemoState, order: StoredOrder): TrackedDelivery {
  const o = orderExt(s, order.id)
  const due = amountsDue({ totalMinor: order.totalMinor, depositDueMinor: o.depositDueMinor, netPaidMinor: netPaid(s, order.id) })
  return {
    depositDueMinor: Math.min(o.depositDueMinor, order.totalMinor),
    depositPaidMinor: due.depositPaidMinor,
    balanceDueMinor: due.balanceDueMinor,
    dueNowMinor: due.dueNowMinor,
    forfeitedMinor: o.forfeitedMinor,
    attempts: o.attempts,
    maxAttempts: maxAttemptsFor(s, order),
    agreedPolicy: o.agreedPolicy ? { ...o.agreedPolicy } : null,
    handoff: handoffOf(s, order.id),
    // Buyer view: no staff notes (same as storefront_track_delivery).
    events: eventsOf(s, order.id)
      .filter((e) => BUYER_EVENT_KINDS.includes(e.kind))
      .map((e) => ({ ...e, note: null })),
    returnedAt: o.returnedAt ?? null,
    refund: (() => {
      const x = latestSuggestion(s, order.id)
      return x ? { amountMinor: x.amountMinor, keptMinor: x.keptMinor, status: x.status } : null
    })(),
  }
}

function pushEvent(s: DemoState, order: StoredOrder, e: Omit<StoredEvent, 'orgId' | 'orderId' | 'createdAt'>): void {
  ext(s).events.push({ ...e, orgId: order.orgId, orderId: order.id, createdAt: I().nowIso() })
}

/** Mirrors public._transition_order_core: the status machine and stock rules, without a staff permission check. */
function transitionAsSystem(s: DemoState, order: StoredOrder, to: OrderStatus, note: string | null): void {
  const from = order.status
  if (!canTransition(from, to) || needsReturnFlow(from, to)) fail(`An order cannot move from ${from} to ${to}`)
  if (!holdsReservation(from) && holdsReservation(to)) I().orderStock(s, order, 'reserve')
  else if (holdsReservation(from) && to === 'cancelled') I().orderStock(s, order, 'release')
  else if (holdsReservation(from) && (to === 'dispatched' || to === 'delivered')) I().orderStock(s, order, 'commit')
  const ts = I().nowIso()
  order.status = to
  order.updatedAt = ts
  if (to === 'delivered') {
    const f = s.fulfilments.find((x) => x.orderId === order.id)
    if (f) f.deliveredAt = ts
  }
  s.history.push({ id: I().uuid(), orgId: order.orgId, orderId: order.id, fromStatus: from, toStatus: to, note, createdAt: ts })
}

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = String(v ?? '').trim()
  return t ? t.slice(0, max) : null
}

/** Mirrors public._apply_failed_delivery. */
function failDelivery(
  s: DemoState,
  order: StoredOrder,
  reason: FailedReason,
  note: string | null,
  actor: 'staff' | 'rider',
  idempotencyKey: string | null,
): FailedDeliveryResult {
  if (idempotencyKey) {
    const prior = ext(s).events.find((e) => e.orgId === order.orgId && e.idempotencyKey === idempotencyKey)
    if (prior) return { attempt: prior.attempt ?? 0, forfeitMinor: prior.forfeitedMinor, final: (prior.attempt ?? 0) >= maxAttemptsFor(s, order) }
  }
  if (!FAILED_REASONS.includes(reason)) fail('Choose why the delivery failed')
  if (order.status !== 'dispatched') fail('Only an order that is out for delivery can have a failed delivery')
  const f = s.fulfilments.find((x) => x.orderId === order.id)
  if (f?.method !== 'delivery') fail('Pickup orders are not delivered')
  const o = orderExt(s, order.id)
  const due = amountsDue({ totalMinor: order.totalMinor, depositDueMinor: o.depositDueMinor, netPaidMinor: netPaid(s, order.id) })
  let outcome
  try {
    outcome = applyFailedDelivery({
      agreedPolicy: o.agreedPolicy,
      maxAttempts: maxAttemptsFor(s, order),
      attemptsSoFar: o.attempts,
      reason,
      deliveryFeeMinor: order.deliveryFeeMinor,
      depositPaidMinor: due.depositPaidMinor,
      forfeitedSoFarMinor: o.forfeitedMinor,
    })
  } catch (e) {
    if (e instanceof PolicyError) fail(e.message)
    throw e
  }
  o.attempts = outcome.attempt
  o.forfeitedMinor += outcome.forfeitMinor
  const cleanNote = clip(note, 300)
  pushEvent(s, order, { kind: 'failed', actor, reason, note: cleanNote, attempt: outcome.attempt, forfeitedMinor: outcome.forfeitMinor, idempotencyKey })
  const historyNote =
    `Delivery attempt ${outcome.attempt} of ${maxAttemptsFor(s, order)} failed: ${FAILED_REASON_LABEL[reason]}` +
    (outcome.forfeitMinor > 0 ? `. Delivery fee kept from deposit per policy.` : '.') +
    (cleanNote ? ` ${cleanNote}` : '')
  // Same-status history row: the order stays "out for delivery" (goods are with the rider or on their way back).
  s.history.push({
    id: I().uuid(),
    orgId: order.orgId,
    orderId: order.id,
    fromStatus: order.status,
    toStatus: order.status,
    note: historyNote,
    createdAt: I().nowIso(),
  })
  order.updatedAt = I().nowIso()
  if (outcome.final) {
    for (const l of ext(s).riderLinks) if (l.orderId === order.id && !l.revokedAt) l.revokedAt = I().nowIso()
  }
  I().writeAudit(s, order.orgId, 'orders', order.id, 'delivery_failed', null, { attempt: outcome.attempt, reason, forfeitMinor: outcome.forfeitMinor })
  return outcome
}

/* ───────────── Rider link (account-free) ───────────── */

function linkByToken(s: DemoState, token: string): StoredRiderLink {
  if (!isWellFormedRiderToken(token)) fail('This rider link is not valid', 'not_found')
  const link = ext(s).riderLinks.find((l) => l.token === token)
  const state = riderLinkState(link, I().now())
  if (state === 'invalid') fail('This rider link is not valid', 'not_found')
  if (state === 'revoked') fail('The shop has cancelled this rider link', 'expired')
  if (state === 'expired') fail('This rider link has expired. Ask the shop for a new one.', 'expired')
  return link as StoredRiderLink
}

function riderJobFor(s: DemoState, link: StoredRiderLink): RiderJob {
  const order = s.orders.find((o) => o.id === link.orderId) ?? fail('Order not found', 'not_found')
  const org = I().getOrg(s, order.orgId)
  const shop = s.shopSettings.find((x) => x.orgId === order.orgId)
  const f = s.fulfilments.find((x) => x.orderId === order.id)
  const addr = (f?.address ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const o = orderExt(s, order.id)
  const due = amountsDue({ totalMinor: order.totalMinor, depositDueMinor: o.depositDueMinor, netPaidMinor: netPaid(s, order.id) })
  const accepted = Boolean(link.acceptedAt)
  const phone = f?.recipientPhone ?? order.customerPhone
  return {
    orderNumber: order.number,
    shopName: org.name,
    status: order.status,
    accepted,
    riderName: link.acceptedName ?? link.riderName,
    expiresAt: link.expiresAt,
    pickup: {
      label: shop?.locationLabel ?? null,
      lat: shop?.locationLat ?? null,
      lng: shop?.locationLng ?? null,
      shopPhone: shop?.whatsappE164 ?? null,
    },
    drop: {
      lat: num(addr.lat),
      lng: num(addr.lng),
      landmark: str(addr.landmark),
      addressLine: str(addr.line1),
      building: str(addr.building),
      instructions: str(addr.instructions),
      pickupPoint: o.pickupPoint ? { ...o.pickupPoint } : null,
    },
    buyerName: ((f?.recipientName ?? order.customerName ?? '').split(' ')[0] || 'Buyer'),
    buyerPhone: accepted ? phone : maskPhone(phone),
    phoneMasked: !accepted,
    itemCount: s.lines.filter((l) => l.orderId === order.id).reduce((a, l) => a + l.quantity, 0),
    collectMinor: due.balanceDueMinor,
    depositOutstandingMinor: due.depositOutstandingMinor,
    currency: order.currency,
    locale: org.locale,
    attempts: o.attempts,
    maxAttempts: maxAttemptsFor(s, order),
  }
}

export function demoRiderJob(s: DemoState, token: string): RiderJob {
  return riderJobFor(s, linkByToken(s, token))
}

export function demoRiderAccept(s: DemoState, token: string, name: string): RiderJob {
  const link = linkByToken(s, token)
  const clean = clip(name, 60)
  if (!clean || clean.length < 2) fail('Enter your name so the shop knows who has the order')
  if (!link.acceptedAt) {
    link.acceptedAt = I().nowIso()
    link.acceptedName = clean
    const order = s.orders.find((o) => o.id === link.orderId) ?? fail('Order not found', 'not_found')
    const f = s.fulfilments.find((x) => x.orderId === order.id)
    if (f) f.assignee = clean
    pushEvent(s, order, { kind: 'rider_accepted', actor: 'rider', reason: null, note: clean, attempt: null, forfeitedMinor: 0, idempotencyKey: null })
  }
  return riderJobFor(s, link)
}

export function demoRiderAction(s: DemoState, token: string, action: RiderAction, reason: string | null | undefined): RiderJob {
  const link = linkByToken(s, token)
  if (!link.acceptedAt) fail('Accept the job first')
  const order = s.orders.find((o) => o.id === link.orderId) ?? fail('Order not found', 'not_found')
  if (order.status === 'cancelled' || order.status === 'refunded') fail('The shop has cancelled this order')
  if (order.status === 'delivered' && action !== 'delivered') fail('This order has already been delivered')
  const o = orderExt(s, order.id)
  const toDispatched = () => {
    const due = amountsDue({ totalMinor: order.totalMinor, depositDueMinor: o.depositDueMinor, netPaidMinor: netPaid(s, order.id) })
    if (due.depositOutstandingMinor > 0) fail('The buyer’s deposit has not been received yet. Check with the shop before collecting.')
    if (order.status === 'pending_confirmation' || order.status === 'draft') fail('The shop has not confirmed this order yet')
    if (order.status === 'confirmed' || order.status === 'preparing') transitionAsSystem(s, order, 'ready', null)
    if (order.status === 'ready') transitionAsSystem(s, order, 'dispatched', `Picked up by rider ${link.acceptedName}`)
  }
  if (action === 'picked_up') {
    if (order.status !== 'dispatched') {
      toDispatched()
      pushEvent(s, order, { kind: 'picked_up', actor: 'rider', reason: null, note: null, attempt: null, forfeitedMinor: 0, idempotencyKey: null })
    }
  } else if (action === 'delivered') {
    if (order.status !== 'delivered') {
      if (order.status !== 'dispatched') toDispatched()
      transitionAsSystem(s, order, 'delivered', `Delivered by rider ${link.acceptedName}`)
      pushEvent(s, order, { kind: 'delivered', actor: 'rider', reason: null, note: null, attempt: null, forfeitedMinor: 0, idempotencyKey: null })
    }
  } else if (action === 'failed') {
    const r = (FAILED_REASONS as readonly string[]).includes(reason ?? '') ? (reason as FailedReason) : fail('Choose why the delivery failed')
    failDelivery(s, order, r, null, 'rider', null)
    // The link stays usable for another try unless that was the last attempt.
    if (link.revokedAt) return riderJobFor(s, { ...link, revokedAt: null })
  } else {
    fail('Unknown action')
  }
  return riderJobFor(s, link)
}

/* ───────────── Merchant gateway ───────────── */

function toSnapshot(p: PickupPoint): PickupPointSnapshot {
  return { id: p.id, name: p.name, area: p.area, hours: p.hours, feeMinor: p.feeMinor }
}

export function createDemoDeliveryAdmin(): DeliveryAdminGateway {
  return {
    getShopPolicy: (orgId) =>
      I().read((s) => {
        I().requireMember(s, orgId)
        return demoPolicyFor(s, orgId)
      }),

    saveShopPolicy: (orgId, policy) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'org.manage')
        const errors = validateShopPolicy(policy)
        const first = Object.values(errors)[0]
        if (first) fail(first)
        const clean: ShopPolicy = {
          paymentMode: policy.paymentMode,
          depositKind: policy.depositKind,
          depositPercentBps: policy.depositPercentBps,
          depositFixedMinor: policy.depositFixedMinor,
          depositMinOrderMinor: policy.depositMinOrderMinor,
          depositCoversDelivery: Boolean(policy.depositCoversDelivery),
          failedDeliveryPayer: policy.failedDeliveryPayer,
          maxDeliveryAttempts: policy.maxDeliveryAttempts,
        }
        const before = ext(s).policies[orgId] ?? null
        ext(s).policies[orgId] = clean
        I().writeAudit(s, orgId, 'shop_policies', orgId, before ? 'update' : 'insert', before ? { ...before } : null, { ...clean })
      }),

    listPickupPoints: (orgId) =>
      I().read((s) => {
        I().requireMember(s, orgId)
        return ext(s)
          .pickupPoints.filter((p) => p.orgId === orgId)
          .sort((a, b) => Number(b.active) - Number(a.active) || a.position - b.position)
          .map(({ orgId: _o, ...p }) => {
            void _o
            return p
          })
      }),

    savePickupPoint: (orgId, input: PickupPointInput) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'org.manage')
        const name = clip(input.name, 80)
        if (!name || name.length < 2) fail('Give the pick-up point a name')
        if (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0) fail('The fee must be zero or more')
        const e = ext(s)
        const fields = { name, area: clip(input.area, 120), hours: clip(input.hours, 120), feeMinor: input.feeMinor, active: input.active !== false }
        if (input.id) {
          const row = e.pickupPoints.find((p) => p.id === input.id && p.orgId === orgId) ?? fail('Pick-up point not found', 'not_found')
          Object.assign(row, fields)
          return row.id
        }
        if (e.pickupPoints.filter((p) => p.orgId === orgId).length >= 50) fail('A shop can list up to 50 pick-up points')
        const id = I().uuid()
        e.pickupPoints.push({ id, orgId, ...fields, position: e.pickupPoints.filter((p) => p.orgId === orgId).length })
        return id
      }),

    archivePickupPoint: (orgId, pointId) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'org.manage')
        const row = ext(s).pickupPoints.find((p) => p.id === pointId && p.orgId === orgId) ?? fail('Pick-up point not found', 'not_found')
        row.active = false
      }),

    getOrderDelivery: (orgId, orderId) =>
      I().read((s): OrderDelivery => {
        I().requireMember(s, orgId)
        const order = I().getOrderRow(s, orgId, orderId)
        const t = demoTrackedDelivery(s, order)
        const link = ext(s)
          .riderLinks.filter((l) => l.orderId === order.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        return {
          currency: order.currency,
          totalMinor: order.totalMinor,
          deliveryFeeMinor: order.deliveryFeeMinor,
          depositDueMinor: t.depositDueMinor,
          depositPaidMinor: t.depositPaidMinor,
          balanceDueMinor: t.balanceDueMinor,
          dueNowMinor: t.dueNowMinor,
          forfeitedMinor: t.forfeitedMinor,
          attempts: t.attempts,
          maxAttempts: t.maxAttempts,
          agreedPolicy: t.agreedPolicy,
          handoff: t.handoff,
          events: eventsOf(s, order.id),
          riderLink: link
            ? {
                riderName: link.riderName,
                expiresAt: link.expiresAt,
                acceptedAt: link.acceptedAt,
                acceptedName: link.acceptedName,
                revokedAt: link.revokedAt,
                createdAt: link.createdAt,
              }
            : null,
          returnedAt: orderExt(s, order.id).returnedAt ?? null,
          refundSuggestion: (() => {
            const x = latestSuggestion(s, order.id)
            return x ? publicSuggestion(x) : null
          })(),
        }
      }),

    setOrderHandoff: (orgId, orderId, input) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'fulfilment.update')
        const order = I().getOrderRow(s, orgId, orderId)
        if (['delivered', 'cancelled', 'refunded'].includes(order.status)) fail('This order is closed')
        const f = s.fulfilments.find((x) => x.orderId === order.id) ?? fail('Order not found', 'not_found')
        if (f.method !== 'delivery') fail('Handoff options are for delivery orders')
        const o = orderExt(s, order.id)
        if (input.kind === 'pickup_point') {
          const p = ext(s).pickupPoints.find((x) => x.id === input.pickupPointId && x.orgId === orgId && x.active) ?? fail('Choose an active pick-up point')
          o.pickupPoint = toSnapshot(p)
          o.carrier = null
        } else if (input.kind === 'courier') {
          const carrier = clip(input.carrier, 80)
          if (!carrier) fail('Enter the courier’s name')
          o.carrier = carrier
          o.pickupPoint = null
          f.trackingRef = clip(input.trackingRef, 120)
        } else if (input.kind === 'own_rider') {
          o.carrier = null
          o.pickupPoint = null
        } else {
          fail('Choose how the order is handed over')
        }
        o.handoff = input.kind
        pushEvent(s, order, { kind: 'handoff_set', actor: 'staff', reason: null, note: input.kind, attempt: null, forfeitedMinor: 0, idempotencyKey: null })
        order.updatedAt = I().nowIso()
      }),

    markDeliveryFailed: (orgId, orderId, input, idempotencyKey) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'fulfilment.update')
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) fail('Missing idempotency key')
        const order = I().getOrderRow(s, orgId, orderId)
        return failDelivery(s, order, input.reason, input.note, 'staff', idempotencyKey)
      }),

    createRiderLink: (orgId, orderId, opts) =>
      I().tx((s): CreatedRiderLink => {
        I().requirePermission(s, orgId, 'fulfilment.update')
        const order = I().getOrderRow(s, orgId, orderId)
        if (!['confirmed', 'preparing', 'ready', 'dispatched'].includes(order.status)) fail('Confirm the order before sending it with a rider')
        const f = s.fulfilments.find((x) => x.orderId === order.id)
        if (f?.method !== 'delivery') fail('Rider links are for delivery orders')
        const o = orderExt(s, order.id)
        if (o.attempts >= maxAttemptsFor(s, order)) fail('All delivery attempts for this order have been used')
        const ts = I().nowIso()
        for (const l of ext(s).riderLinks) if (l.orderId === order.id && !l.revokedAt) l.revokedAt = ts
        const token = randomToken(24)
        const expiresAt = new Date(I().now().getTime() + riderLinkHours(opts.hours) * 3_600_000).toISOString()
        ext(s).riderLinks.push({
          id: I().uuid(),
          orgId,
          orderId: order.id,
          token,
          riderName: clip(opts.riderName, 60),
          expiresAt,
          acceptedAt: null,
          acceptedName: null,
          revokedAt: null,
          createdAt: ts,
        })
        if (o.handoff !== 'pickup_point') o.handoff = 'own_rider'
        pushEvent(s, order, { kind: 'rider_link_created', actor: 'staff', reason: null, note: clip(opts.riderName, 60), attempt: null, forfeitedMinor: 0, idempotencyKey: null })
        return { token, expiresAt }
      }),

    revokeRiderLink: (orgId, orderId) =>
      I().tx((s) => {
        I().requirePermission(s, orgId, 'fulfilment.update')
        const order = I().getOrderRow(s, orgId, orderId)
        let any = false
        for (const l of ext(s).riderLinks) {
          if (l.orderId === order.id && !l.revokedAt) {
            l.revokedAt = I().nowIso()
            any = true
          }
        }
        if (any) pushEvent(s, order, { kind: 'rider_link_revoked', actor: 'staff', reason: null, note: null, attempt: null, forfeitedMinor: 0, idempotencyKey: null })
      }),

    returnToShop: (orgId, orderId, input, idempotencyKey) => I().tx((s) => returnOrderToShop(s, orgId, orderId, input.note, idempotencyKey)),

    confirmRefundSuggestion: (orgId, suggestionId, idempotencyKey) =>
      I().tx((s) => {
        I().requireMember(s, orgId)
        const x = suggestionsOf(s).find((r) => r.id === suggestionId && r.orgId === orgId) ?? fail('Refund not found', 'not_found')
        I().requirePermission(s, orgId, 'refunds.create')
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) fail('Missing idempotency key')
        if (x.status === 'confirmed') return
        if (x.status !== 'pending') fail('This refund was dismissed')
        // Newest payment first; each part is an ordinary refund record. All or nothing (tx discards on failure).
        let left = x.amountMinor
        const payments = s.payments
          .filter((p) => p.orderId === x.orderId && p.orgId === orgId && p.status === 'succeeded' && p.currency === x.currency)
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        let i = 0
        for (const p of payments) {
          if (left <= 0) break
          const already = s.refunds.filter((r) => r.paymentId === p.id && r.status !== 'failed').reduce((a, r) => a + r.amountMinor, 0)
          const amt = Math.min(left, p.amountMinor - already)
          if (amt <= 0) continue
          I().recordRefund(s, orgId, { paymentId: p.id, amountMinor: amt, currency: x.currency, reason: x.reason }, `${idempotencyKey}:${i}`)
          left -= amt
          i++
        }
        if (left > 0) fail('The payments on this order no longer cover this refund. Record what you refunded on Payments instead.')
        x.status = 'confirmed'
        x.resolvedAt = I().nowIso()
        const order = I().getOrderRow(s, orgId, x.orderId)
        s.history.push({
          id: I().uuid(),
          orgId,
          orderId: order.id,
          fromStatus: order.status,
          toStatus: order.status,
          note: 'Refund to the buyer recorded for the returned order.',
          createdAt: I().nowIso(),
        })
        I().writeAudit(s, orgId, 'refund_suggestions', x.id, 'update', { status: 'pending' }, { status: 'confirmed' })
      }),

    dismissRefundSuggestion: (orgId, suggestionId, reason) =>
      I().tx((s) => {
        I().requireMember(s, orgId)
        const x = suggestionsOf(s).find((r) => r.id === suggestionId && r.orgId === orgId) ?? fail('Refund not found', 'not_found')
        I().requirePermission(s, orgId, 'refunds.create')
        if (x.status !== 'pending') fail('This refund is already settled')
        const why = clip(reason, 300)
        if (!why) fail('Say why no refund is due')
        x.status = 'dismissed'
        x.resolutionNote = why
        x.resolvedAt = I().nowIso()
        const order = I().getOrderRow(s, orgId, x.orderId)
        s.history.push({
          id: I().uuid(),
          orgId,
          orderId: order.id,
          fromStatus: order.status,
          toStatus: order.status,
          note: `Suggested refund dismissed: ${why}`,
          createdAt: I().nowIso(),
        })
        I().writeAudit(s, orgId, 'refund_suggestions', x.id, 'update', { status: 'pending' }, { status: 'dismissed', reason: why })
      }),
  }
}

/** Mirrors public.return_order_to_shop. */
function returnOrderToShop(s: DemoState, orgId: string, orderId: string, note: string | null, idempotencyKey: string): ReturnToShopResult {
  I().requireMember(s, orgId)
  const order = I().getOrderRow(s, orgId, orderId)
  I().requirePermission(s, orgId, 'refunds.create')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) fail('Missing idempotency key')
  const o = orderExt(s, order.id)
  const result = (replayed: boolean): ReturnToShopResult => {
    const x = latestSuggestion(s, order.id)
    const plan = planReturnToShop({ netPaidMinor: netPaid(s, order.id), forfeitedMinor: o.forfeitedMinor })
    return {
      orderId: order.id,
      returnedAt: o.returnedAt ?? null,
      keptMinor: x ? x.keptMinor : plan.keptMinor,
      refundMinor: x ? x.amountMinor : 0,
      refundSuggestionId: x ? x.id : null,
      replayed,
    }
  }
  if (ext(s).events.some((e) => e.orgId === orgId && e.idempotencyKey === idempotencyKey)) return result(true)
  if (order.status !== 'dispatched') fail('Only an order that is out for delivery can be returned to the shop')
  const f = s.fulfilments.find((x) => x.orderId === order.id)
  if (f?.method !== 'delivery') fail('Pickup orders are not delivered')
  const cleanNote = clip(note, 300)

  // 1. Everything not yet returned goes back on the shelf (same rules as "Return items to stock").
  const lines = s.lines
    .filter((l) => l.orderId === order.id && l.quantity > l.returnedQuantity)
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ lineId: l.id, quantity: l.quantity - l.returnedQuantity }))
  if (lines.length) I().returnItems(s, orgId, { orderId: order.id, note: cleanNote ?? 'Returned to shop after delivery', lines }, idempotencyKey)

  // 2. dispatched -> cancelled: the one place this transition is allowed.
  if (!canTransition(order.status, 'cancelled')) fail(`An order cannot move from ${order.status} to cancelled`)
  const ts = I().nowIso()
  order.status = 'cancelled'
  order.updatedAt = ts
  o.returnedAt = ts
  s.history.push({
    id: I().uuid(),
    orgId,
    orderId: order.id,
    fromStatus: 'dispatched',
    toStatus: 'cancelled',
    note: `Returned to shop after ${o.attempts} failed delivery attempt${o.attempts === 1 ? '' : 's'}. Items back in stock.${cleanNote ? ` ${cleanNote}` : ''}`,
    createdAt: ts,
  })
  for (const l of ext(s).riderLinks) if (l.orderId === order.id && !l.revokedAt) l.revokedAt = ts

  // 3. Money: the kept delivery fee stays with the shop; the rest is suggested as a refund, never moved.
  const plan = planReturnToShop({ netPaidMinor: netPaid(s, order.id), forfeitedMinor: o.forfeitedMinor })
  if (plan.refundMinor > 0) {
    suggestionsOf(s).push({
      id: I().uuid(),
      orgId,
      orderId: order.id,
      amountMinor: plan.refundMinor,
      keptMinor: plan.keptMinor,
      currency: order.currency,
      reason:
        plan.keptMinor > 0
          ? 'Order returned to shop. Delivery fee kept per the agreed policy; the rest is refundable.'
          : 'Order returned to shop. Everything the buyer paid is refundable.',
      status: 'pending',
      resolutionNote: null,
      createdAt: ts,
      resolvedAt: null,
    })
  }
  pushEvent(s, order, { kind: 'returned', actor: 'staff', reason: null, note: cleanNote, attempt: o.attempts, forfeitedMinor: 0, idempotencyKey })
  I().writeAudit(s, orgId, 'orders', order.id, 'returned_to_shop', { status: 'dispatched' }, { status: 'cancelled', refundMinor: plan.refundMinor, keptMinor: plan.keptMinor })
  return result(false)
}

/** Deposit for a quote (exported for storefront-demo.ts). */
export function demoDepositFor(policy: ShopPolicy, totalMinor: number, deliveryFeeMinor: number, currency: string) {
  return computeDeposit(policy, { totalMinor, deliveryFeeMinor, currency })
}
