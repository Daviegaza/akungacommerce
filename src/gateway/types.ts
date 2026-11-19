import type { OrderStatus, TaxMode } from '@/domain/orders'
import type { PaymentStatus, PaymentVerification } from '@/domain/payments'
import type { Role } from '@/domain/permissions'
import type { AdjustmentReason, StockMovementKind } from '@/domain/inventory'

/** Shapes the UI works with. Both gateways (Supabase and demo) return these. */

export interface SessionUser {
  id: string
  email: string
}

export interface Organisation {
  id: string
  name: string
  legalName: string | null
  countryCode: string
  timezone: string
  locale: string
  baseCurrency: string
  businessType: string | null
  taxMode: TaxMode
  contactEmail: string | null
  contactPhone: string | null
  createdAt: string
}

export interface OrganisationWithRole extends Organisation {
  role: Role
}

export interface NewOrganisationInput {
  name: string
  countryCode: string
  timezone: string
  locale: string
  baseCurrency: string
  businessType: string | null
  taxMode: TaxMode
}

export type OrganisationPatch = Partial<
  Pick<Organisation, 'name' | 'legalName' | 'timezone' | 'locale' | 'businessType' | 'taxMode' | 'contactEmail' | 'contactPhone'>
>

export interface Member {
  userId: string
  email: string | null
  displayName: string | null
  role: Role
  createdAt: string
}

export type ProductStatus = 'active' | 'draft' | 'archived'

export interface Variant {
  id: string
  productId: string
  name: string
  sku: string | null
  priceMinor: number
  currency: string
  lowStockThreshold: number
  isActive: boolean
  onHand: number
  reserved: number
  /** Present only when the viewer may see cost prices. */
  costMinor: number | null
}

export interface Product {
  id: string
  name: string
  description: string | null
  category: string | null
  status: ProductStatus
  trackStock: boolean
  taxRateBps: number
  taxCode: string | null
  createdAt: string
  updatedAt: string
  variants: Variant[]
}

export interface VariantInput {
  id?: string
  name: string
  sku: string | null
  priceMinor: number
  lowStockThreshold: number
  isActive: boolean
  /** undefined = leave unchanged, null = clear */
  costMinor?: number | null
}

export interface ProductInput {
  id?: string
  name: string
  description: string | null
  category: string | null
  status: ProductStatus
  trackStock: boolean
  taxRateBps: number
  taxCode: string | null
  variants: VariantInput[]
}

export interface StockMovement {
  id: string
  variantId: string
  productName: string
  variantName: string
  kind: StockMovementKind
  onHandDelta: number
  reservedDelta: number
  reason: string | null
  note: string | null
  orderId: string | null
  createdAt: string
}

export interface StockAdjustmentInput {
  variantId: string
  delta: number
  reason: AdjustmentReason
  note: string | null
}

export interface Customer {
  id: string
  name: string
  phoneE164: string | null
  email: string | null
  countryCode: string | null
  marketingConsent: boolean
  tags: string[]
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomerInput {
  id?: string
  name: string
  phoneE164: string | null
  email: string | null
  countryCode: string | null
  marketingConsent: boolean
  tags: string[]
  notes: string | null
}

export const ORDER_CHANNELS = ['direct', 'whatsapp', 'instagram', 'facebook', 'tiktok', 'storefront', 'phone', 'walk_in', 'other'] as const
export type OrderChannel = (typeof ORDER_CHANNELS)[number]
export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  direct: 'Direct',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  storefront: 'Storefront',
  phone: 'Phone call',
  walk_in: 'Walk-in',
  other: 'Other',
}

export interface OrderSummary {
  id: string
  number: number
  status: OrderStatus
  channel: OrderChannel
  currency: string
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  deliveryFeeMinor: number
  totalMinor: number
  taxMode: TaxMode
  note: string | null
  createdAt: string
  updatedAt: string
  /** Sum of succeeded payments minus succeeded refunds. */
  netPaidMinor: number
  fulfilmentMethod: FulfilmentMethod
}

export interface OrderLine {
  id: string
  variantId: string | null
  productName: string
  variantName: string
  sku: string | null
  quantity: number
  returnedQuantity: number
  unitPriceMinor: number
  currency: string
  taxRateBps: number
  discountMinor: number
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'card' | 'cheque' | 'other'
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other',
}

export interface Payment {
  id: string
  orderId: string
  orderNumber: number | null
  provider: string
  method: PaymentMethod
  amountMinor: number
  currency: string
  status: PaymentStatus
  verification: PaymentVerification
  externalRef: string | null
  note: string | null
  receivedAt: string
  reversedReason: string | null
  createdAt: string
}

export interface Refund {
  id: string
  orderId: string
  orderNumber: number | null
  paymentId: string
  amountMinor: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed'
  verification: PaymentVerification
  reason: string
  createdAt: string
}

export type FulfilmentMethod = 'pickup' | 'delivery'

export interface Address {
  line1?: string
  line2?: string
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  instructions?: string
}

export interface Fulfilment {
  method: FulfilmentMethod
  recipientName: string | null
  recipientPhone: string | null
  address: Address
  assignee: string | null
  provider: string
  trackingRef: string | null
  proofOfDelivery: string | null
  deliveredAt: string | null
}

export type FulfilmentPatch = Partial<Omit<Fulfilment, 'deliveredAt' | 'provider'>>

export interface StatusChange {
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  note: string | null
  createdAt: string
}

export interface OrderDetail extends OrderSummary {
  lines: OrderLine[]
  payments: Payment[]
  refunds: Refund[]
  fulfilment: Fulfilment
  history: StatusChange[]
}

export interface NewOrderInput {
  status: 'draft' | 'pending_confirmation' | 'confirmed'
  channel: OrderChannel
  customerId: string | null
  note: string | null
  deliveryFeeMinor: number
  fulfilment: {
    method: FulfilmentMethod
    recipientName: string | null
    recipientPhone: string | null
    address: Address
  }
  lines: { variantId: string; quantity: number; discountMinor: number }[]
}

export interface ManualPaymentInput {
  orderId: string
  amountMinor: number
  currency: string
  method: PaymentMethod
  externalRef: string | null
  receivedAt: string
  note: string | null
}

export interface RefundInput {
  paymentId: string
  amountMinor: number
  currency: string
  reason: string
}

export interface ReturnItemsInput {
  orderId: string
  lines: { lineId: string; quantity: number }[]
  note: string | null
}

export interface AuditEntry {
  id: string
  entity: string
  entityId: string
  action: string
  actorId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

export type IntegrationKind = 'whatsapp' | 'email' | 'sms' | 'payment' | 'delivery' | 'accounting'
export type IntegrationLabel = 'connected_verified' | 'configured_unverified' | 'adapter_only' | 'not_implemented'

export interface IntegrationStatus {
  provider: string
  kind: IntegrationKind
  name: string
  label: IntegrationLabel
  detail: string
  lastTestedAt: string | null
}
