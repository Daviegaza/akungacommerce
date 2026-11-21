/**
 * Supabase side of deposits, failed deliveries and handoff. Row mappers are
 * shared by the staff gateway (supabase.ts) and the public storefront
 * (storefront-supabase.ts); only a type is imported from supabase-js so the
 * storefront bundle stays small.
 * RPCs: supabase/migrations/20261120000030_deposits_handoff.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SHOP_POLICY, FAILED_REASONS, PAYMENT_MODES, type FailedReason, type ShopPolicy } from '@/domain/delivery-policy'
import { GatewayError } from './gateway'
import type {
  CheckoutOptions,
  DeliveryAdminGateway,
  DeliveryEvent,
  Handoff,
  HandoffKind,
  OrderDelivery,
  PickupPoint,
  PickupPointSnapshot,
  RefundSuggestion,
  RefundSuggestionStatus,
  ReturnToShopResult,
  RiderJob,
  TrackedDelivery,
} from './delivery'

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null || v === '' ? null : String(v))
const n = (v: unknown) => Number(v ?? 0)
const nOrNull = (v: unknown) => (v == null ? null : Number(v))
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])

export function mapPolicy(v: unknown): ShopPolicy | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  const mode = String(r.payment_mode)
  return {
    paymentMode: (PAYMENT_MODES as readonly string[]).includes(mode) ? (mode as ShopPolicy['paymentMode']) : 'pay_on_delivery',
    depositKind: r.deposit_kind === 'fixed' ? 'fixed' : 'percent',
    depositPercentBps: n(r.deposit_percent_bps ?? DEFAULT_SHOP_POLICY.depositPercentBps),
    depositFixedMinor: n(r.deposit_fixed_minor),
    depositMinOrderMinor: n(r.deposit_min_order_minor),
    depositCoversDelivery: r.deposit_covers_delivery !== false,
    failedDeliveryPayer: r.failed_delivery_payer === 'buyer' ? 'buyer' : 'seller',
    maxDeliveryAttempts: n(r.max_delivery_attempts ?? DEFAULT_SHOP_POLICY.maxDeliveryAttempts),
  }
}

export function policyPayload(p: ShopPolicy): Row {
  return {
    payment_mode: p.paymentMode,
    deposit_kind: p.depositKind,
    deposit_percent_bps: p.depositPercentBps,
    deposit_fixed_minor: p.depositFixedMinor,
    deposit_min_order_minor: p.depositMinOrderMinor,
    deposit_covers_delivery: p.depositCoversDelivery,
    failed_delivery_payer: p.failedDeliveryPayer,
    max_delivery_attempts: p.maxDeliveryAttempts,
  }
}

export function mapPickupSnapshot(v: unknown): PickupPointSnapshot | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  return { id: String(r.id), name: String(r.name ?? ''), area: s(r.area), hours: s(r.hours), feeMinor: n(r.fee_minor) }
}

function mapPickupPoint(r: Row): PickupPoint {
  return { ...(mapPickupSnapshot(r) as PickupPointSnapshot), active: r.active !== false, position: n(r.position) }
}

function mapHandoff(v: unknown): Handoff {
  const r = (v ?? {}) as Row
  const kind = s(r.kind)
  return {
    kind: kind === 'own_rider' || kind === 'pickup_point' || kind === 'courier' ? (kind as HandoffKind) : null,
    carrier: s(r.carrier),
    pickupPoint: mapPickupSnapshot(r.pickup_point),
  }
}

function mapEvent(r: Row): DeliveryEvent {
  const reason = s(r.reason)
  return {
    kind: String(r.kind) as DeliveryEvent['kind'],
    actor: r.actor === 'rider' ? 'rider' : r.actor === 'system' ? 'system' : 'staff',
    reason: reason && (FAILED_REASONS as readonly string[]).includes(reason) ? (reason as FailedReason) : null,
    note: s(r.note),
    attempt: nOrNull(r.attempt),
    forfeitedMinor: n(r.forfeited_minor),
    createdAt: String(r.created_at),
  }
}

const SUGGESTION_STATUSES: readonly RefundSuggestionStatus[] = ['pending', 'confirmed', 'dismissed']
const suggestionStatus = (v: unknown): RefundSuggestionStatus =>
  (SUGGESTION_STATUSES as readonly string[]).includes(String(v)) ? (String(v) as RefundSuggestionStatus) : 'pending'

export function mapRefundSuggestion(v: unknown): RefundSuggestion | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  return {
    id: String(r.id),
    amountMinor: n(r.amount_minor),
    keptMinor: n(r.kept_minor),
    currency: String(r.currency ?? ''),
    reason: String(r.reason ?? ''),
    status: suggestionStatus(r.status),
    resolutionNote: s(r.resolution_note),
    createdAt: String(r.created_at),
    resolvedAt: s(r.resolved_at),
  }
}

function mapTrackedRefund(v: unknown): TrackedDelivery['refund'] {
  if (!v || typeof v !== 'object') return null
  const r = v as Row
  return { amountMinor: n(r.amount_minor), keptMinor: n(r.kept_minor), status: suggestionStatus(r.status) }
}

export function mapTrackedDelivery(r: Row): TrackedDelivery {
  return {
    returnedAt: s(r.returned_at),
    refund: mapTrackedRefund(r.refund),
    depositDueMinor: n(r.deposit_due_minor),
    depositPaidMinor: n(r.deposit_paid_minor),
    balanceDueMinor: n(r.balance_due_minor),
    dueNowMinor: n(r.due_now_minor),
    forfeitedMinor: n(r.forfeited_minor),
    attempts: n(r.attempts),
    maxAttempts: n(r.max_attempts),
    agreedPolicy: mapPolicy(r.agreed_policy),
    handoff: mapHandoff(r.handoff),
    events: rows(r.events).map(mapEvent),
  }
}

export function mapCheckoutOptions(r: Row): CheckoutOptions {
  return {
    policy: mapPolicy(r.policy) ?? { ...DEFAULT_SHOP_POLICY },
    pickupPoints: rows(r.pickup_points).map((p) => mapPickupSnapshot(p) as PickupPointSnapshot),
  }
}

export function mapRiderJob(r: Row): RiderJob {
  const pickup = (r.pickup ?? {}) as Row
  const drop = (r.drop ?? {}) as Row
  return {
    orderNumber: n(r.order_number),
    shopName: String(r.shop_name ?? ''),
    status: String(r.status),
    accepted: Boolean(r.accepted),
    riderName: s(r.rider_name),
    expiresAt: String(r.expires_at),
    pickup: { label: s(pickup.label), lat: nOrNull(pickup.lat), lng: nOrNull(pickup.lng), shopPhone: s(pickup.shop_phone) },
    drop: {
      lat: nOrNull(drop.lat),
      lng: nOrNull(drop.lng),
      landmark: s(drop.landmark),
      addressLine: s(drop.address_line),
      building: s(drop.building),
      instructions: s(drop.instructions),
      pickupPoint: mapPickupSnapshot(drop.pickup_point),
    },
    buyerName: String(r.buyer_name ?? 'Buyer'),
    buyerPhone: s(r.buyer_phone),
    phoneMasked: r.phone_masked !== false,
    itemCount: n(r.item_count),
    collectMinor: n(r.collect_minor),
    depositOutstandingMinor: n(r.deposit_outstanding_minor),
    currency: String(r.currency),
    locale: String(r.locale ?? 'en'),
    attempts: n(r.attempts),
    maxAttempts: n(r.max_attempts),
  }
}

export function mapReturnResult(r: Row): ReturnToShopResult {
  return {
    orderId: String(r.order_id),
    returnedAt: s(r.returned_at),
    keptMinor: n(r.kept_minor),
    refundMinor: n(r.refund_minor),
    refundSuggestionId: s(r.refund_suggestion_id),
    replayed: Boolean(r.replayed),
  }
}

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new GatewayError(res.error.message ?? 'Something went wrong', res.error.code)
  return res.data as T
}

export function createSupabaseDeliveryAdmin(sb: SupabaseClient): DeliveryAdminGateway {
  return {
    async getShopPolicy(orgId) {
      const row = check(await sb.from('shop_policies').select('*').eq('org_id', orgId).maybeSingle()) as Row | null
      return mapPolicy(row) ?? { ...DEFAULT_SHOP_POLICY }
    },
    async saveShopPolicy(orgId, policy) {
      check(await sb.rpc('save_shop_policy', { p_org: orgId, p_policy: policyPayload(policy) }))
    },
    async listPickupPoints(orgId) {
      const data = check(
        await sb.from('pickup_points').select('*').eq('org_id', orgId).order('active', { ascending: false }).order('position'),
      ) as Row[]
      return data.map(mapPickupPoint)
    },
    async savePickupPoint(orgId, input) {
      return String(
        check(
          await sb.rpc('save_pickup_point', {
            p_org: orgId,
            p_point: { id: input.id ?? null, name: input.name, area: input.area, hours: input.hours, fee_minor: input.feeMinor, active: input.active },
          }),
        ),
      )
    },
    async archivePickupPoint(orgId, pointId) {
      check(await sb.rpc('archive_pickup_point', { p_org: orgId, p_point: pointId }))
    },
    async getOrderDelivery(_orgId, orderId): Promise<OrderDelivery> {
      const [main, ret] = await Promise.all([sb.rpc('order_delivery', { p_order: orderId }), sb.rpc('order_return_state', { p_order: orderId })])
      const r = check(main) as Row
      const rs = (check(ret) ?? {}) as Row
      const t = mapTrackedDelivery(r)
      const link = r.rider_link as Row | null
      return {
        ...t,
        returnedAt: s(rs.returned_at),
        refundSuggestion: mapRefundSuggestion(rs.refund_suggestion),
        currency: String(r.currency),
        totalMinor: n(r.total_minor),
        deliveryFeeMinor: n(r.delivery_fee_minor),
        riderLink: link
          ? {
              riderName: s(link.rider_name),
              expiresAt: String(link.expires_at),
              acceptedAt: s(link.accepted_at),
              acceptedName: s(link.accepted_name),
              revokedAt: s(link.revoked_at),
              createdAt: String(link.created_at),
            }
          : null,
      }
    },
    async setOrderHandoff(_orgId, orderId, input) {
      check(
        await sb.rpc('set_order_handoff', {
          p_order: orderId,
          p_input: { kind: input.kind, pickup_point_id: input.pickupPointId ?? null, carrier: input.carrier ?? null, tracking_ref: input.trackingRef ?? null },
        }),
      )
    },
    async markDeliveryFailed(_orgId, orderId, input, idempotencyKey) {
      const r = check(
        await sb.rpc('mark_delivery_failed', { p_order: orderId, p_reason: input.reason, p_note: input.note, p_idempotency_key: idempotencyKey }),
      ) as Row
      return { attempt: n(r.attempt), forfeitMinor: n(r.forfeit_minor), final: Boolean(r.final) }
    },
    async createRiderLink(_orgId, orderId, opts) {
      const r = check(await sb.rpc('create_rider_link', { p_order: orderId, p_rider_name: opts.riderName, p_hours: opts.hours })) as Row
      return { token: String(r.token), expiresAt: String(r.expires_at) }
    },
    async revokeRiderLink(_orgId, orderId) {
      check(await sb.rpc('revoke_rider_link', { p_order: orderId }))
    },
    async returnToShop(_orgId, orderId, input, idempotencyKey) {
      const r = check(await sb.rpc('return_order_to_shop', { p_order: orderId, p_note: input.note, p_idempotency_key: idempotencyKey })) as Row
      return mapReturnResult(r)
    },
    async confirmRefundSuggestion(_orgId, suggestionId, idempotencyKey) {
      check(await sb.rpc('confirm_refund_suggestion', { p_suggestion: suggestionId, p_idempotency_key: idempotencyKey }))
    },
    async dismissRefundSuggestion(_orgId, suggestionId, reason) {
      check(await sb.rpc('dismiss_refund_suggestion', { p_suggestion: suggestionId, p_reason: reason }))
    },
  }
}
