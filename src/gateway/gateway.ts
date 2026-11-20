import type { OrderStatus } from '@/domain/orders'
import type {
  AuditEntry,
  Customer,
  CustomerInput,
  FulfilmentPatch,
  IntegrationStatus,
  ManualPaymentInput,
  Member,
  NewOrderInput,
  NewOrganisationInput,
  OrderDetail,
  OrderSummary,
  Organisation,
  OrganisationPatch,
  OrganisationWithRole,
  Payment,
  Product,
  ProductInput,
  Refund,
  RefundInput,
  ReturnItemsInput,
  SessionUser,
  StockAdjustmentInput,
  StockMovement,
} from './types'
import type { Role } from '@/domain/permissions'
import type { ShopAdminGateway } from './storefront'
import type { CollectionsAdminGateway } from './collections'
import type { TrustAdminGateway } from './trust'

export type GatewayMode = 'supabase' | 'demo'

/**
 * The only boundary between UI and data. Every mutation that touches money or
 * stock takes an idempotency key so retries (double taps, flaky networks) are safe.
 */
export interface CommerceGateway extends ShopAdminGateway, CollectionsAdminGateway, TrustAdminGateway {
  readonly mode: GatewayMode

  // Session
  getUser(): Promise<SessionUser | null>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>
  signOut(): Promise<void>
  onAuthChange(cb: (user: SessionUser | null) => void): () => void

  // Organisations & team
  listOrganisations(): Promise<OrganisationWithRole[]>
  createOrganisation(input: NewOrganisationInput): Promise<string>
  updateOrganisation(orgId: string, patch: OrganisationPatch): Promise<Organisation>
  listMembers(orgId: string): Promise<Member[]>
  addMember(orgId: string, email: string, role: Role): Promise<void>
  setMemberRole(orgId: string, userId: string, role: Role): Promise<void>
  removeMember(orgId: string, userId: string): Promise<void>

  // Catalogue
  listProducts(orgId: string): Promise<Product[]>
  saveProduct(orgId: string, input: ProductInput): Promise<string>

  // Inventory
  listStockMovements(orgId: string, opts?: { variantId?: string; limit?: number }): Promise<StockMovement[]>
  adjustStock(orgId: string, input: StockAdjustmentInput, idempotencyKey: string): Promise<void>

  // Customers
  listCustomers(orgId: string): Promise<Customer[]>
  saveCustomer(orgId: string, input: CustomerInput): Promise<string>

  // Orders
  listOrders(orgId: string): Promise<OrderSummary[]>
  getOrder(orgId: string, orderId: string): Promise<OrderDetail>
  createOrder(orgId: string, input: NewOrderInput, idempotencyKey: string): Promise<string>
  transitionOrder(orgId: string, orderId: string, to: OrderStatus, note: string | null): Promise<void>
  updateFulfilment(orgId: string, orderId: string, patch: FulfilmentPatch): Promise<void>
  returnItems(orgId: string, input: ReturnItemsInput, idempotencyKey: string): Promise<void>

  // Payments
  listPayments(orgId: string): Promise<Payment[]>
  listRefunds(orgId: string): Promise<Refund[]>
  recordManualPayment(orgId: string, input: ManualPaymentInput, idempotencyKey: string): Promise<string>
  reversePayment(orgId: string, paymentId: string, reason: string): Promise<void>
  recordRefund(orgId: string, input: RefundInput, idempotencyKey: string): Promise<string>

  // Oversight
  listAudit(orgId: string, limit?: number): Promise<AuditEntry[]>
  listIntegrations(orgId: string): Promise<IntegrationStatus[]>
}

export class GatewayError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
