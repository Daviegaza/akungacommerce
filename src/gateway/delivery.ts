/**
 * Deposits, failed deliveries and delivery handoff (own rider link, pickup
 * point, courier). Mirrors supabase/migrations/20261120000030_deposits_handoff.sql.
 * Fungua brokers delivery: it never runs a fleet, and no courier or pickup-point
 * network is connected (see src/integrations/registry.ts).
 */
import type { FailedReason, ShopPolicy } from '@/domain/delivery-policy'

export type { FailedReason, PaymentMode, ShopPolicy } from '@/domain/delivery-policy'

export type HandoffKind = 'own_rider' | 'pickup_point' | 'courier'

export const HANDOFF_LABEL: Record<HandoffKind, string> = {
  own_rider: 'Your own rider',
  pickup_point: 'Pick-up point',
  courier: 'Courier',
}

export interface PickupPoint {
  id: string
  name: string
  area: string | null
  hours: string | null
  feeMinor: number
  active: boolean
  position: number
}

export interface PickupPointInput {
  id?: string
  name: string
  area: string | null
  hours: string | null
  feeMinor: number
  active: boolean
}

/** What a buyer sees for a pickup point. */
export type PublicPickupPoint = Omit<PickupPoint, 'active' | 'position'>

/** Snapshot stored on the order so later edits to the point do not change it. */
export interface PickupPointSnapshot {
  id: string
  name: string
  area: string | null
  hours: string | null
  feeMinor: number
}

export type DeliveryEventKind =
  | 'failed'
  | 'picked_up'
  | 'delivered'
  | 'rider_accepted'
  | 'rider_link_created'
  | 'rider_link_revoked'
  | 'handoff_set'
  | 'returned'

export interface DeliveryEvent {
  kind: DeliveryEventKind
  actor: 'staff' | 'rider' | 'system'
  reason: FailedReason | null
  note: string | null
  attempt: number | null
  forfeitedMinor: number
  createdAt: string
}

export interface RiderLinkInfo {
  riderName: string | null
  expiresAt: string
  acceptedAt: string | null
  acceptedName: string | null
  revokedAt: string | null
  createdAt: string
}

export interface Handoff {
  kind: HandoffKind | null
  carrier: string | null
  pickupPoint: PickupPointSnapshot | null
}

/** Merchant view of an order's deposit and delivery state. */
export interface OrderDelivery {
  currency: string
  totalMinor: number
  deliveryFeeMinor: number
  depositDueMinor: number
  depositPaidMinor: number
  balanceDueMinor: number
  dueNowMinor: number
  forfeitedMinor: number
  attempts: number
  maxAttempts: number
  /** Policy the buyer agreed to at checkout; null for staff-created orders. */
  agreedPolicy: ShopPolicy | null
  handoff: Handoff
  events: DeliveryEvent[]
  /** Most recent rider link (the token itself is only shown once, when created). */
  riderLink: RiderLinkInfo | null
  /** When the order came back to the shop (status cancelled); null otherwise. */
  returnedAt?: string | null
  /** What the shop owes the buyer after a return (latest suggestion). */
  refundSuggestion?: RefundSuggestion | null
}

export type RefundSuggestionStatus = 'pending' | 'confirmed' | 'dismissed'

/** A refund the merchant should make after a return. Fungua never moves money: confirming records a refund. */
export interface RefundSuggestion {
  id: string
  amountMinor: number
  /** Delivery fee kept under the agreed policy. */
  keptMinor: number
  currency: string
  reason: string
  status: RefundSuggestionStatus
  resolutionNote: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface ReturnToShopResult {
  orderId: string
  returnedAt: string | null
  keptMinor: number
  refundMinor: number
  refundSuggestionId: string | null
  replayed: boolean
}

export interface HandoffInput {
  kind: HandoffKind
  pickupPointId?: string | null
  carrier?: string | null
  trackingRef?: string | null
}

export interface FailedDeliveryInput {
  reason: FailedReason
  note: string | null
}

export interface FailedDeliveryResult {
  attempt: number
  forfeitMinor: number
  final: boolean
}

export interface CreatedRiderLink {
  token: string
  expiresAt: string
}

/** Merchant-side operations (implemented on CommerceGateway). */
export interface DeliveryAdminGateway {
  getShopPolicy(orgId: string): Promise<ShopPolicy>
  saveShopPolicy(orgId: string, policy: ShopPolicy): Promise<void>
  listPickupPoints(orgId: string): Promise<PickupPoint[]>
  savePickupPoint(orgId: string, input: PickupPointInput): Promise<string>
  archivePickupPoint(orgId: string, pointId: string): Promise<void>
  getOrderDelivery(orgId: string, orderId: string): Promise<OrderDelivery>
  setOrderHandoff(orgId: string, orderId: string, input: HandoffInput): Promise<void>
  markDeliveryFailed(orgId: string, orderId: string, input: FailedDeliveryInput, idempotencyKey: string): Promise<FailedDeliveryResult>
  createRiderLink(orgId: string, orderId: string, opts: { riderName: string | null; hours: number }): Promise<CreatedRiderLink>
  revokeRiderLink(orgId: string, orderId: string): Promise<void>
  /** Out for delivery -> returned to shop: stock back, order cancelled, refund suggested (never paid out). */
  returnToShop(orgId: string, orderId: string, input: { note: string | null }, idempotencyKey: string): Promise<ReturnToShopResult>
  /** The merchant refunded the buyer outside Fungua: record it against the order's payments. */
  confirmRefundSuggestion(orgId: string, suggestionId: string, idempotencyKey: string): Promise<void>
  dismissRefundSuggestion(orgId: string, suggestionId: string, reason: string): Promise<void>
}

/* ───────────── Shopper / rider side (implemented on StorefrontGateway) ───────────── */

export interface CheckoutOptions {
  policy: ShopPolicy
  pickupPoints: PublicPickupPoint[]
}

/** Extra tracking data for the buyer's tracking page. */
export interface TrackedDelivery {
  depositDueMinor: number
  depositPaidMinor: number
  balanceDueMinor: number
  dueNowMinor: number
  forfeitedMinor: number
  attempts: number
  maxAttempts: number
  agreedPolicy: ShopPolicy | null
  handoff: Handoff
  /** Buyer-relevant events only (failed / picked up / delivered / returned). */
  events: DeliveryEvent[]
  /** Set when the order went back to the shop after delivery failed. */
  returnedAt?: string | null
  /** Money owed back to the buyer after a return (no staff notes). */
  refund?: { amountMinor: number; keptMinor: number; status: RefundSuggestionStatus } | null
}

export type RiderAction = 'picked_up' | 'delivered' | 'failed'

/** What the rider link shows. The buyer phone is masked until the rider accepts. */
export interface RiderJob {
  orderNumber: number
  shopName: string
  status: string
  accepted: boolean
  riderName: string | null
  expiresAt: string
  pickup: { label: string | null; lat: number | null; lng: number | null; shopPhone: string | null }
  drop: {
    lat: number | null
    lng: number | null
    landmark: string | null
    addressLine: string | null
    building: string | null
    instructions: string | null
    pickupPoint: PickupPointSnapshot | null
  }
  buyerName: string
  buyerPhone: string | null
  phoneMasked: boolean
  itemCount: number
  /** Balance the rider should collect on delivery (0 = already paid). */
  collectMinor: number
  depositOutstandingMinor: number
  currency: string
  locale: string
  attempts: number
  maxAttempts: number
}

