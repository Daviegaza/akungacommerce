/**
 * In-browser demo gateway. Powers the clearly labelled demo workspace with
 * fictional data that lives only in this browser (localStorage, falling back to
 * memory). It enforces the same business rules as the Supabase backend
 * (supabase/migrations/20261119000003_business_operations.sql) by reusing the
 * shared domain functions, so the demo never behaves more permissively than
 * production.
 */
import { CurrencyMismatchError, MoneyError, assertCurrency } from '@/domain/money'
import {
  ORDER_STATUS_LABEL,
  canTransition,
  computeOrderTotals,
  holdsReservation,
  type OrderStatus,
} from '@/domain/orders'
import { summarisePayments, validateRefund } from '@/domain/payments'
import {
  ADJUSTMENT_REASONS,
  StockError,
  adjust,
  commit,
  release,
  reserve,
  type StockLevel,
  type StockMovementKind,
} from '@/domain/inventory'
import { ROLES, ROLE_LABEL, can, type Permission, type Role } from '@/domain/permissions'
import { isValidTimezone } from '@/domain/locale'
import { integrationStatuses } from '@/integrations/registry'
import { GatewayError, type CommerceGateway } from './gateway'
import { createDemoDeliveryAdmin } from './delivery-demo'
import {
  ORDER_CHANNELS,
  type Address,
  type AuditEntry,
  type Customer,
  type CustomerInput,
  type Fulfilment,
  type FulfilmentMethod,
  type FulfilmentPatch,
  type ManualPaymentInput,
  type Member,
  type NewOrderInput,
  type NewOrganisationInput,
  type OrderDetail,
  type OrderLine,
  type OrderSummary,
  type Organisation,
  type OrganisationPatch,
  type OrganisationWithRole,
  type Payment,
  type PaymentMethod,
  type Product,
  type ProductInput,
  type Refund,
  type RefundInput,
  type ReturnItemsInput,
  type SessionUser,
  type StatusChange,
  type StockAdjustmentInput,
  type StockMovement,
} from './types'
import type { DeliveryBand, PaymentChoice, ProductMerchandising, ShopSettings, VariantMerchandising } from './storefront'
import { dataUrlBytes } from '@/media/compress'
import { DEMO_DATA_URL_RE, DEMO_MAX_IMAGE_BYTES, DEMO_MAX_UPLOADED_IMAGES, blobToDataUrl } from '@/media/upload'
import { createDemoCollections, type DemoCollectionsState } from './collections-demo'

export const DEMO_NOTICE = 'Demo workspace · fictional data · stored only in this browser'

const STORAGE_KEY = 'akunga.demo.v2'
const STATE_VERSION = 2

export const DEMO_USER: SessionUser = { id: 'demo-user', email: 'owner@demo.akunga.test' }

/** Fictional accounts that "exist" in the demo, so adding a teammate can succeed. */
const DEMO_ACCOUNTS: { id: string; email: string; displayName: string }[] = [
  { id: 'demo-user-wanjiru', email: 'wanjiru@demo.akunga.test', displayName: 'Wanjiru Kamau' },
  { id: 'demo-user-brian', email: 'brian@demo.akunga.test', displayName: 'Brian Otieno' },
  { id: 'demo-user-achieng', email: 'achieng@demo.akunga.test', displayName: 'Achieng Odhiambo' },
  { id: 'demo-user-jonas', email: 'jonas@demo.akunga.test', displayName: 'Jonas Weber' },
]

const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const E164_RE = /^\+[1-9][0-9]{6,14}$/
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
/** Same as the shop_settings.slug check constraint. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

/** Mirrors save_shop_settings: increasing distances up to 500 km, non-negative whole fees. */
function validateBands(bands: DeliveryBand[] | null | undefined): DeliveryBand[] {
  let prev = 0
  const out: DeliveryBand[] = []
  for (const b of bands ?? []) {
    const km = b?.maxKm
    const fee = b?.feeMinor
    if (typeof km !== 'number' || !Number.isFinite(km) || km <= prev || km > 500 || !Number.isSafeInteger(fee) || fee < 0) {
      throw new GatewayError('Delivery bands must have increasing distances (up to 500 km) and non-negative fees', 'invalid')
    }
    prev = km
    out.push({ maxKm: km, feeMinor: fee })
  }
  return out
}

// ───────────────────────── Stored shapes ─────────────────────────

interface StoredOrg extends Organisation {
  nextOrderNumber: number
}
interface StoredMember extends Member {
  orgId: string
}
interface StoredProduct extends Omit<Product, 'variants'> {
  orgId: string
}
interface StoredVariant {
  id: string
  orgId: string
  productId: string
  name: string
  sku: string | null
  priceMinor: number
  currency: string
  lowStockThreshold: number
  isActive: boolean
  position: number
  createdAt: string
  updatedAt: string
  compareAtMinor: number | null
  swatch: string | null
}
interface StoredMovement extends Omit<StockMovement, 'productName' | 'variantName'> {
  orgId: string
  idempotencyKey: string | null
}
interface StoredCustomer extends Customer {
  orgId: string
}
interface StoredOrder extends Omit<OrderSummary, 'netPaidMinor' | 'fulfilmentMethod'> {
  orgId: string
  idempotencyKey: string
  /** Guest tracking link token (storefront orders only). */
  trackingToken: string | null
  paymentPreference: PaymentChoice | null
}
interface StoredLine extends OrderLine {
  orgId: string
  orderId: string
  trackStock: boolean
  position: number
}
interface StoredFulfilment extends Fulfilment {
  orgId: string
  orderId: string
}
interface StoredHistory extends StatusChange {
  id: string
  orgId: string
  orderId: string
}
interface StoredPayment extends Omit<Payment, 'orderNumber'> {
  orgId: string
  idempotencyKey: string
}
interface StoredRefund extends Omit<Refund, 'orderNumber'> {
  orgId: string
  idempotencyKey: string
}
interface StoredAudit extends AuditEntry {
  orgId: string
}
interface StoredShopSettings extends ShopSettings {
  orgId: string
  updatedAt: string
}
interface StoredReview {
  id: string
  orgId: string
  productId: string
  orderId: string
  rating: number
  body: string | null
  authorDisplay: string
  hidden: boolean
  createdAt: string
}

/** M-Pesa collections fields are optional so older saved demo states stay valid. */
interface DemoState extends DemoCollectionsState {
  version: number
  signedIn: boolean
  orgs: StoredOrg[]
  members: StoredMember[]
  products: StoredProduct[]
  variants: StoredVariant[]
  costs: Record<string, number>
  levels: Record<string, StockLevel>
  movements: StoredMovement[]
  customers: StoredCustomer[]
  orders: StoredOrder[]
  lines: StoredLine[]
  fulfilments: StoredFulfilment[]
  history: StoredHistory[]
  payments: StoredPayment[]
  refunds: StoredRefund[]
  audit: StoredAudit[]
  /** `${orgId}:${key}` for applied return requests. */
  returnKeys: string[]
  shopSettings: StoredShopSettings[]
  reviews: StoredReview[]
  /** Mirrors public.rate_limits (fixed window per key). */
  rateLimits: Record<string, { windowStart: string; hits: number }>
}

function emptyState(): DemoState {
  return {
    version: STATE_VERSION,
    signedIn: true,
    orgs: [],
    members: [],
    products: [],
    variants: [],
    costs: {},
    levels: {},
    movements: [],
    customers: [],
    orders: [],
    lines: [],
    fulfilments: [],
    history: [],
    payments: [],
    refunds: [],
    audit: [],
    returnKeys: [],
    shopSettings: [],
    reviews: [],
    rateLimits: {},
  }
}

// ───────────────────────── Persistence ─────────────────────────

let memoryRaw: string | null = null

function readRaw(): string | null {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (typeof v === 'string') return v
  } catch {
    // storage unavailable (private mode, node, blocked) — use memory
  }
  return memoryRaw
}

function writeRaw(raw: string): void {
  memoryRaw = raw
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, raw)
  } catch {
    // quota or blocked storage — memory copy still holds the state
  }
}

/** localStorage "full" across browsers (QuotaExceededError, legacy codes 22 / 1014). */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { name?: string; code?: number }
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014
}

/**
 * Like writeRaw, but a full localStorage is reported instead of silently kept
 * in memory (where it would vanish on reload). Used for writes that can grow
 * the state a lot, such as uploaded demo photos.
 */
function writeRawStrict(raw: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, raw)
  } catch (e) {
    if (isQuotaError(e)) {
      fail(
        'This browser has run out of space for demo photos. Remove some photos (or reset the demo in Settings), then save again.',
        'storage_full',
      )
    }
    // blocked storage (private mode, node) — memory copy below still holds the state
  }
  memoryRaw = raw
}

function isState(v: unknown): v is DemoState {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<DemoState>
  return (
    s.version === STATE_VERSION &&
    Array.isArray(s.orgs) &&
    Array.isArray(s.orders) &&
    Array.isArray(s.returnKeys) &&
    Array.isArray(s.shopSettings) &&
    Array.isArray(s.reviews) &&
    !!s.rateLimits &&
    typeof s.rateLimits === 'object'
  )
}

/** Each call returns a fresh copy, so a failed operation never leaks partial writes. */
function loadState(): DemoState {
  const raw = readRaw()
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isState(parsed)) return parsed
    } catch {
      // corrupt — reseed below
    }
  }
  const seeded = buildSeed()
  saveState(seeded)
  return JSON.parse(JSON.stringify(seeded)) as DemoState
}

function saveState(s: DemoState): void {
  writeRaw(JSON.stringify(s))
}

/** Wipe the demo workspace and restore the original fictional data. */
export function resetDemoWorkspace(): void {
  saveState(buildSeed())
  notifyAuth()
}

// ───────────────────────── Clock, errors, helpers ─────────────────────────

let clockOverride: Date | null = null
function now(): Date {
  return clockOverride ? new Date(clockOverride.getTime()) : new Date()
}
function nowIso(): string {
  return now().toISOString()
}
function uuid(): string {
  return crypto.randomUUID()
}

function fail(message: string, code?: string): never {
  throw new GatewayError(message, code)
}

function toGatewayError(e: unknown): GatewayError {
  if (e instanceof GatewayError) return e
  if (e instanceof StockError || e instanceof MoneyError || e instanceof CurrencyMismatchError) {
    return new GatewayError(e.message, 'invalid')
  }
  if (e instanceof Error) return new GatewayError(e.message)
  return new GatewayError('Something went wrong in the demo workspace')
}

function tx<T>(fn: (s: DemoState) => T): Promise<T> {
  try {
    const s = loadState()
    const result = fn(s)
    saveState(s)
    return Promise.resolve(result)
  } catch (e) {
    return Promise.reject(toGatewayError(e))
  }
}

/** tx() variant whose write fails loudly when localStorage is full; nothing is committed then. */
function txStrict<T>(fn: (s: DemoState) => T): Promise<T> {
  try {
    const s = loadState()
    const result = fn(s)
    writeRawStrict(JSON.stringify(s))
    return Promise.resolve(result)
  } catch (e) {
    return Promise.reject(toGatewayError(e))
  }
}

function read<T>(fn: (s: DemoState) => T): Promise<T> {
  try {
    return Promise.resolve(fn(loadState()))
  } catch (e) {
    return Promise.reject(toGatewayError(e))
  }
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

function maxLen(v: string | null, max: number, label: string): string | null {
  if (v !== null && v.length > max) fail(`${label} is too long (max ${max} characters)`, 'invalid')
  return v
}

function requireKey(key: string): void {
  if (typeof key !== 'string' || key.length < 8) fail('Missing idempotency key', 'invalid')
}

function isSafeNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

const PERMISSION_ACTION: Record<Permission, string> = {
  'org.manage': 'change business settings',
  'team.manage': 'manage the team',
  'integrations.manage': 'manage integrations',
  'catalogue.write': 'edit products',
  'cost.read': 'see cost prices',
  'customers.write': 'edit customers',
  'orders.create': 'create or cancel orders',
  'orders.transition': 'update order status',
  'inventory.adjust': 'adjust stock',
  'payments.record': 'record payments',
  'refunds.create': 'record refunds or returns',
  'fulfilment.update': 'update fulfilment details',
}

function requireSignedIn(s: DemoState): void {
  if (!s.signedIn) fail('Not signed in', 'auth')
}

function roleIn(s: DemoState, orgId: string): Role | null {
  return s.members.find((m) => m.orgId === orgId && m.userId === DEMO_USER.id)?.role ?? null
}

function requireMember(s: DemoState, orgId: string): Role {
  requireSignedIn(s)
  const role = roleIn(s, orgId)
  if (!role) fail('Business not found', 'not_found')
  return role
}

function requirePermission(s: DemoState, orgId: string, permission: Permission): Role {
  const role = requireMember(s, orgId)
  if (!can(role, permission)) {
    fail(`Your role (${ROLE_LABEL[role]}) cannot ${PERMISSION_ACTION[permission]}`, 'forbidden')
  }
  return role
}

function getOrg(s: DemoState, orgId: string): StoredOrg {
  return s.orgs.find((o) => o.id === orgId) ?? fail('Business not found', 'not_found')
}

function getOrderRow(s: DemoState, orgId: string, orderId: string): StoredOrder {
  return s.orders.find((o) => o.id === orderId && o.orgId === orgId) ?? fail('Order not found', 'not_found')
}

function writeAudit(
  s: DemoState,
  orgId: string,
  entity: string,
  entityId: string,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): void {
  s.audit.push({ id: uuid(), orgId, entity, entityId, action, actorId: DEMO_USER.id, before, after, createdAt: nowIso() })
}

function level(s: DemoState, variantId: string): StockLevel {
  return s.levels[variantId] ?? { onHand: 0, reserved: 0 }
}

function pushMovement(
  s: DemoState,
  m: {
    orgId: string
    variantId: string
    kind: StockMovementKind
    onHandDelta: number
    reservedDelta: number
    reason: string | null
    note: string | null
    orderId: string | null
    idempotencyKey: string | null
  },
): void {
  s.movements.push({ id: uuid(), createdAt: nowIso(), ...m })
}

/** Mirrors `_order_stock`: apply a stock action to every stock-tracked line. */
function orderStock(s: DemoState, order: StoredOrder, action: 'reserve' | 'release' | 'commit'): void {
  const lines = s.lines.filter((l) => l.orderId === order.id && l.trackStock && l.variantId).sort((a, b) => a.position - b.position)
  for (const line of lines) {
    const variantId = line.variantId as string
    const current = level(s, variantId)
    let next: StockLevel
    try {
      next =
        action === 'reserve'
          ? reserve(current, line.quantity)
          : action === 'release'
            ? release(current, line.quantity)
            : commit(current, line.quantity)
    } catch (e) {
      if (e instanceof StockError) fail(`${line.productName} (${line.variantName}): ${e.message}`, 'stock')
      throw e
    }
    s.levels[variantId] = next
    pushMovement(s, {
      orgId: order.orgId,
      variantId,
      kind: action === 'reserve' ? 'reservation' : action === 'release' ? 'release' : 'sale',
      onHandDelta: next.onHand - current.onHand,
      reservedDelta: next.reserved - current.reserved,
      reason: action === 'reserve' ? 'order' : action === 'release' ? 'order_cancelled' : 'order_fulfilled',
      note: null,
      orderId: order.id,
      idempotencyKey: null,
    })
  }
}

function cleanAddress(a: Address | undefined | null): Address {
  const out: Address = {}
  if (!a || typeof a !== 'object') return out
  const keys: (keyof Address)[] = ['line1', 'line2', 'city', 'region', 'postalCode', 'countryCode', 'instructions']
  for (const k of keys) {
    const v = a[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 300)
  }
  return out
}

function toPayment(s: DemoState, p: StoredPayment): Payment {
  const { orgId: _o, idempotencyKey: _k, ...rest } = p
  void _o
  void _k
  return { ...rest, orderNumber: s.orders.find((o) => o.id === p.orderId)?.number ?? null }
}

function toRefund(s: DemoState, r: StoredRefund): Refund {
  const { orgId: _o, idempotencyKey: _k, ...rest } = r
  void _o
  void _k
  return { ...rest, orderNumber: s.orders.find((o) => o.id === r.orderId)?.number ?? null }
}

function toSummary(s: DemoState, o: StoredOrder): OrderSummary {
  const payments = s.payments.filter((p) => p.orderId === o.id)
  const refunds = s.refunds.filter((r) => r.orderId === o.id)
  const summary = summarisePayments({ totalMinor: o.totalMinor, currency: o.currency }, payments, refunds)
  const fulfilment = s.fulfilments.find((f) => f.orderId === o.id)
  const { orgId: _o, idempotencyKey: _k, trackingToken: _t, paymentPreference: _p, ...rest } = o
  void _o
  void _k
  void _t
  void _p
  return { ...rest, netPaidMinor: summary.netPaidMinor, fulfilmentMethod: fulfilment?.method ?? 'pickup' }
}

// ───────────────────────── Operations (shared by gateway + seed) ─────────────────────────

/** Mirrors `_create_order_core`: no permission check (callers enforce it). */
function createOrderCore(s: DemoState, orgId: string, input: NewOrderInput, key: string): string {
  requireKey(key)
  const existing = s.orders.find((o) => o.orgId === orgId && o.idempotencyKey === key)
  if (existing) return existing.id

  const status = input.status ?? 'confirmed'
  if (!['draft', 'pending_confirmation', 'confirmed'].includes(status)) {
    fail('New orders start as draft, awaiting confirmation or confirmed', 'invalid')
  }
  const channel = input.channel ?? 'direct'
  if (!(ORDER_CHANNELS as readonly string[]).includes(channel)) fail('Choose a sales channel', 'invalid')
  const fee = input.deliveryFeeMinor ?? 0
  if (!Number.isSafeInteger(fee)) fail('Delivery fee must be a whole number of minor units', 'invalid')
  if (fee < 0) fail('Delivery fee cannot be negative', 'invalid')
  if (!Array.isArray(input.lines) || input.lines.length === 0) fail('An order needs at least one line', 'invalid')
  const note = maxLen(trimOrNull(input.note), 2000, 'Note')
  const method: FulfilmentMethod = input.fulfilment?.method ?? 'pickup'
  if (method !== 'pickup' && method !== 'delivery') fail('Choose pickup or delivery', 'invalid')

  const org = getOrg(s, orgId)
  let customer: StoredCustomer | null = null
  if (input.customerId) {
    customer = s.customers.find((c) => c.id === input.customerId && c.orgId === orgId) ?? fail('Customer not found', 'not_found')
  }

  // Prices, tax and totals come from the catalogue, never from the client.
  const resolved = input.lines.map((l) => {
    const qty = l.quantity
    const discount = l.discountMinor ?? 0
    if (!Number.isSafeInteger(qty) || qty <= 0) fail('Quantity must be at least 1', 'invalid')
    if (!Number.isSafeInteger(discount) || discount < 0) fail('Discount cannot be negative', 'invalid')
    const variant = s.variants.find((v) => v.id === l.variantId && v.orgId === orgId && v.isActive)
    const product = variant && s.products.find((p) => p.id === variant.productId && p.status === 'active')
    if (!variant || !product) fail('A product in this order is unavailable', 'not_found')
    if (variant.currency !== org.baseCurrency) fail(`Cannot mix ${variant.currency} and ${org.baseCurrency} in one order`, 'invalid')
    return { variant, product, qty, discount }
  })
  const totals = computeOrderTotals({
    currency: org.baseCurrency,
    taxMode: org.taxMode,
    deliveryFeeMinor: fee,
    lines: resolved.map((r) => ({
      unitPriceMinor: r.variant.priceMinor,
      quantity: r.qty,
      taxRateBps: r.product.taxRateBps,
      discountMinor: r.discount,
      currency: r.variant.currency,
    })),
  })

  const number = org.nextOrderNumber
  org.nextOrderNumber += 1
  const ts = nowIso()
  const order: StoredOrder = {
    id: uuid(),
    orgId,
    idempotencyKey: key,
    number,
    status,
    channel,
    currency: org.baseCurrency,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phoneE164 ?? null,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    deliveryFeeMinor: totals.deliveryFeeMinor,
    totalMinor: totals.totalMinor,
    taxMode: org.taxMode,
    note,
    createdAt: ts,
    updatedAt: ts,
    trackingToken: null,
    paymentPreference: null,
  }
  s.orders.push(order)
  resolved.forEach((r, position) => {
    const t = totals.lines[position]
    s.lines.push({
      id: uuid(),
      orgId,
      orderId: order.id,
      variantId: r.variant.id,
      productName: r.product.name,
      variantName: r.variant.name,
      sku: r.variant.sku,
      quantity: r.qty,
      returnedQuantity: 0,
      unitPriceMinor: r.variant.priceMinor,
      currency: r.variant.currency,
      taxRateBps: r.product.taxRateBps,
      discountMinor: r.discount,
      subtotalMinor: t.subtotalMinor,
      taxMinor: t.taxMinor,
      totalMinor: t.totalMinor,
      trackStock: r.product.trackStock,
      position,
    })
  })
  s.fulfilments.push({
    orgId,
    orderId: order.id,
    method,
    recipientName: trimOrNull(input.fulfilment?.recipientName),
    recipientPhone: trimOrNull(input.fulfilment?.recipientPhone),
    address: cleanAddress(input.fulfilment?.address),
    assignee: null,
    provider: 'manual',
    trackingRef: null,
    proofOfDelivery: null,
    deliveredAt: null,
  })
  s.history.push({ id: uuid(), orgId, orderId: order.id, fromStatus: null, toStatus: status, note: 'Order created', createdAt: ts })
  if (holdsReservation(status)) orderStock(s, order, 'reserve')
  writeAudit(s, orgId, 'orders', order.id, 'insert', null, { number, status, totalMinor: order.totalMinor, currency: order.currency })
  return order.id
}


const ops = {
  createOrganisation(s: DemoState, input: NewOrganisationInput): string {
    requireSignedIn(s)
    const owned = s.members.filter((m) => m.userId === DEMO_USER.id && m.role === 'owner').length
    if (owned >= 10) fail('Organisation limit reached', 'limit')
    const name = (input.name ?? '').trim()
    if (name.length < 1 || name.length > 120) fail('Business name must be 1–120 characters', 'invalid')
    const countryCode = (input.countryCode ?? '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(countryCode)) fail('Choose a country', 'invalid')
    const baseCurrency = assertCurrency((input.baseCurrency ?? '').toUpperCase())
    if (!isValidTimezone(input.timezone)) fail(`Unknown time zone: ${input.timezone}`, 'invalid')
    if (!LOCALE_RE.test(input.locale ?? '')) fail('Choose a valid locale', 'invalid')
    if (input.taxMode !== 'exclusive' && input.taxMode !== 'inclusive') fail('Choose a tax mode', 'invalid')
    const businessType = maxLen(trimOrNull(input.businessType), 60, 'Business type')
    const id = uuid()
    const createdAt = nowIso()
    s.orgs.push({
      id,
      name,
      legalName: null,
      countryCode,
      timezone: input.timezone,
      locale: input.locale,
      baseCurrency,
      businessType,
      taxMode: input.taxMode,
      contactEmail: null,
      contactPhone: null,
      createdAt,
      nextOrderNumber: 1001,
    })
    s.members.push({
      orgId: id,
      userId: DEMO_USER.id,
      email: DEMO_USER.email,
      displayName: DEMO_USER.email.split('@')[0],
      role: 'owner',
      createdAt,
    })
    return id
  },

  updateOrganisation(s: DemoState, orgId: string, patch: OrganisationPatch): Organisation {
    requirePermission(s, orgId, 'org.manage')
    const org = getOrg(s, orgId)
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const next: StoredOrg = { ...org }
    if (patch.name !== undefined) {
      const name = (patch.name ?? '').trim()
      if (name.length < 1 || name.length > 120) fail('Business name must be 1–120 characters', 'invalid')
      next.name = name
    }
    if (patch.legalName !== undefined) next.legalName = maxLen(trimOrNull(patch.legalName), 200, 'Legal name')
    if (patch.timezone !== undefined) {
      if (!isValidTimezone(patch.timezone)) fail(`Unknown time zone: ${patch.timezone}`, 'invalid')
      next.timezone = patch.timezone
    }
    if (patch.locale !== undefined) {
      if (!LOCALE_RE.test(patch.locale)) fail('Choose a valid locale', 'invalid')
      next.locale = patch.locale
    }
    if (patch.businessType !== undefined) next.businessType = maxLen(trimOrNull(patch.businessType), 60, 'Business type')
    if (patch.taxMode !== undefined) {
      if (patch.taxMode !== 'exclusive' && patch.taxMode !== 'inclusive') fail('Choose a tax mode', 'invalid')
      next.taxMode = patch.taxMode
    }
    if (patch.contactEmail !== undefined) {
      const email = trimOrNull(patch.contactEmail)
      if (email !== null && !EMAIL_RE.test(email)) fail('Enter a valid contact email', 'invalid')
      next.contactEmail = email
    }
    if (patch.contactPhone !== undefined) next.contactPhone = maxLen(trimOrNull(patch.contactPhone), 40, 'Contact phone')
    for (const k of Object.keys(patch) as (keyof OrganisationPatch)[]) {
      if (org[k] !== next[k]) {
        before[k] = org[k]
        after[k] = next[k]
      }
    }
    Object.assign(org, next)
    if (Object.keys(after).length) writeAudit(s, orgId, 'organisations', orgId, 'update', before, after)
    const { nextOrderNumber: _n, ...pub } = org
    void _n
    return pub
  },

  addMember(s: DemoState, orgId: string, email: string, role: Role): void {
    const myRole = requirePermission(s, orgId, 'team.manage')
    if (!ROLES.includes(role)) fail('Choose a role', 'invalid')
    if (role === 'owner' && myRole !== 'owner') fail('Only an owner can add another owner', 'forbidden')
    const normalised = (email ?? '').trim().toLowerCase()
    const account =
      normalised === DEMO_USER.email ? { id: DEMO_USER.id, email: DEMO_USER.email, displayName: 'Owner' } : DEMO_ACCOUNTS.find((a) => a.email === normalised)
    if (!account) fail('That person needs to create an Akunga account first, then you can add them.', 'not_found')
    if (s.members.some((m) => m.orgId === orgId && m.userId === account.id)) return // on conflict do nothing
    s.members.push({ orgId, userId: account.id, email: account.email, displayName: account.displayName, role, createdAt: nowIso() })
    writeAudit(s, orgId, 'memberships', account.id, 'insert', null, { role, email: account.email })
  },

  setMemberRole(s: DemoState, orgId: string, userId: string, role: Role): void {
    const myRole = requirePermission(s, orgId, 'team.manage')
    if (!ROLES.includes(role)) fail('Choose a role', 'invalid')
    const member = s.members.find((m) => m.orgId === orgId && m.userId === userId) ?? fail('Member not found', 'not_found')
    if ((member.role === 'owner' || role === 'owner') && myRole !== 'owner') fail('Only an owner can change owner access', 'forbidden')
    if (member.role === 'owner' && role !== 'owner' && s.members.filter((m) => m.orgId === orgId && m.role === 'owner').length === 1) {
      fail('A business must keep at least one owner', 'invalid')
    }
    if (member.role === role) return
    writeAudit(s, orgId, 'memberships', userId, 'role_changed', { role: member.role }, { role })
    member.role = role
  },

  removeMember(s: DemoState, orgId: string, userId: string): void {
    const myRole = requirePermission(s, orgId, 'team.manage')
    const member = s.members.find((m) => m.orgId === orgId && m.userId === userId) ?? fail('Member not found', 'not_found')
    if (member.role === 'owner' && myRole !== 'owner') fail('Only an owner can remove an owner', 'forbidden')
    if (member.role === 'owner' && s.members.filter((m) => m.orgId === orgId && m.role === 'owner').length === 1) {
      fail('A business must keep at least one owner', 'invalid')
    }
    s.members = s.members.filter((m) => m !== member)
    writeAudit(s, orgId, 'memberships', userId, 'delete', { role: member.role, email: member.email }, null)
  },

  saveProduct(s: DemoState, orgId: string, input: ProductInput): string {
    const role = requirePermission(s, orgId, 'catalogue.write')
    const org = getOrg(s, orgId)
    if (!Array.isArray(input.variants) || input.variants.length === 0) fail('A product needs at least one variant', 'invalid')
    const name = (input.name ?? '').trim()
    if (name.length < 1 || name.length > 160) fail('Product name must be 1–160 characters', 'invalid')
    const description = maxLen(trimOrNull(input.description), 5000, 'Description')
    const category = maxLen(trimOrNull(input.category), 80, 'Category')
    const taxCode = maxLen(trimOrNull(input.taxCode), 40, 'Tax code')
    if (!['active', 'draft', 'archived'].includes(input.status)) fail('Choose a product status', 'invalid')
    if (!isSafeNonNeg(input.taxRateBps) || input.taxRateBps > 10_000) fail('Tax rate must be between 0% and 100%', 'invalid')
    const ts = nowIso()

    let product: StoredProduct
    if (!input.id) {
      product = {
        id: uuid(),
        orgId,
        name,
        description,
        category,
        status: input.status,
        trackStock: input.trackStock ?? true,
        taxRateBps: input.taxRateBps,
        taxCode,
        createdAt: ts,
        updatedAt: ts,
        images: [],
        featured: false,
        availableFrom: null,
      }
      s.products.push(product)
      writeAudit(s, orgId, 'products', product.id, 'insert', null, { name, status: input.status })
    } else {
      product = s.products.find((p) => p.id === input.id && p.orgId === orgId) ?? fail('Product not found', 'not_found')
      const before = { name: product.name, status: product.status, taxRateBps: product.taxRateBps }
      Object.assign(product, {
        name,
        description,
        category,
        status: input.status,
        trackStock: input.trackStock ?? true,
        taxRateBps: input.taxRateBps,
        taxCode,
        updatedAt: ts,
      })
      const after = { name: product.name, status: product.status, taxRateBps: product.taxRateBps }
      if (JSON.stringify(before) !== JSON.stringify(after)) writeAudit(s, orgId, 'products', product.id, 'update', before, after)
    }

    const seenSkus = new Set<string>()
    input.variants.forEach((v, position) => {
      const vName = trimOrNull(v.name) ?? 'Default'
      if (vName.length > 120) fail('Variant name is too long (max 120 characters)', 'invalid')
      const sku = trimOrNull(v.sku)
      if (sku !== null && sku.length > 64) fail('SKU is too long (max 64 characters)', 'invalid')
      if (!isSafeNonNeg(v.priceMinor)) fail(`Price for "${vName}" must be zero or more`, 'invalid')
      const threshold = v.lowStockThreshold ?? 3
      if (!isSafeNonNeg(threshold)) fail('Low-stock threshold must be zero or more', 'invalid')
      if (sku !== null) {
        const lower = sku.toLowerCase()
        const clash =
          seenSkus.has(lower) ||
          s.variants.some((x) => x.orgId === orgId && x.sku?.toLowerCase() === lower && x.id !== v.id)
        if (clash) fail(`SKU "${sku}" is already used by another variant`, 'conflict')
        seenSkus.add(lower)
      }

      let variant: StoredVariant
      if (!v.id) {
        variant = {
          id: uuid(),
          orgId,
          productId: product.id,
          name: vName,
          sku,
          priceMinor: v.priceMinor,
          currency: org.baseCurrency,
          lowStockThreshold: threshold,
          isActive: v.isActive ?? true,
          position,
          createdAt: ts,
          updatedAt: ts,
          compareAtMinor: null,
          swatch: null,
        }
        s.variants.push(variant)
        s.levels[variant.id] = { onHand: 0, reserved: 0 }
        writeAudit(s, orgId, 'product_variants', variant.id, 'insert', null, { name: vName, priceMinor: v.priceMinor, currency: org.baseCurrency })
      } else {
        variant =
          s.variants.find((x) => x.id === v.id && x.productId === product.id && x.orgId === orgId) ??
          fail('Variant not found on this product', 'not_found')
        // Mirrors the compare_at_minor > price_minor check constraint.
        if (variant.compareAtMinor !== null && v.priceMinor >= variant.compareAtMinor) {
          fail(`"${vName}" has a compare-at price; the price must stay below it`, 'invalid')
        }
        if (variant.priceMinor !== v.priceMinor) {
          writeAudit(
            s,
            orgId,
            'product_variants',
            variant.id,
            'price_changed',
            { priceMinor: variant.priceMinor, currency: variant.currency },
            { priceMinor: v.priceMinor, currency: variant.currency },
          )
        }
        Object.assign(variant, { name: vName, sku, priceMinor: v.priceMinor, lowStockThreshold: threshold, isActive: v.isActive ?? true, position, updatedAt: ts })
      }

      // Cost prices are only written by roles that may see them (mirrors save_product).
      if (v.costMinor !== undefined && can(role, 'cost.read')) {
        if (v.costMinor === null) {
          delete s.costs[variant.id]
        } else {
          if (!isSafeNonNeg(v.costMinor)) fail('Cost must be zero or more', 'invalid')
          s.costs[variant.id] = v.costMinor
        }
      }
    })
    return product.id
  },

  adjustStock(s: DemoState, orgId: string, input: StockAdjustmentInput, key: string): void {
    requirePermission(s, orgId, 'inventory.adjust')
    if (!Number.isSafeInteger(input.delta) || input.delta === 0) fail('Adjustment must be non-zero', 'invalid')
    if (!(ADJUSTMENT_REASONS as readonly string[]).includes(input.reason)) fail('Choose a reason for this adjustment', 'invalid')
    requireKey(key)
    if (s.movements.some((m) => m.orgId === orgId && m.idempotencyKey === key)) return // already applied
    const variant = s.variants.find((v) => v.id === input.variantId && v.orgId === orgId) ?? fail('Stock level not found for this business', 'not_found')
    const note = maxLen(trimOrNull(input.note), 500, 'Note')
    const current = level(s, variant.id)
    const next = adjust(current, input.delta)
    s.levels[variant.id] = next
    const kind: StockMovementKind = input.reason === 'received_from_supplier' ? 'receipt' : 'adjustment'
    pushMovement(s, {
      orgId,
      variantId: variant.id,
      kind,
      onHandDelta: input.delta,
      reservedDelta: 0,
      reason: input.reason,
      note,
      orderId: null,
      idempotencyKey: key,
    })
    writeAudit(s, orgId, 'inventory_levels', variant.id, 'stock_adjusted', { onHand: current.onHand }, { onHand: next.onHand, reason: input.reason })
  },

  saveCustomer(s: DemoState, orgId: string, input: CustomerInput): string {
    requirePermission(s, orgId, 'customers.write')
    const name = (input.name ?? '').trim()
    if (name.length < 1 || name.length > 160) fail('Customer name must be 1–160 characters', 'invalid')
    const phone = trimOrNull(input.phoneE164)
    if (phone !== null && !E164_RE.test(phone)) fail('Phone must be in international format, e.g. +447700900123', 'invalid')
    const email = trimOrNull(input.email)
    if (email !== null && !EMAIL_RE.test(email)) fail('Enter a valid email address', 'invalid')
    const country = trimOrNull(input.countryCode)?.toUpperCase() ?? null
    if (country !== null && !/^[A-Z]{2}$/.test(country)) fail('Country must be a two-letter code', 'invalid')
    const notes = maxLen(trimOrNull(input.notes), 5000, 'Notes')
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))]
    const ts = nowIso()
    const fields = { name, phoneE164: phone, email, countryCode: country, marketingConsent: !!input.marketingConsent, tags, notes }
    if (input.id) {
      const c = s.customers.find((x) => x.id === input.id && x.orgId === orgId) ?? fail('Customer not found', 'not_found')
      Object.assign(c, fields, { updatedAt: ts })
      return c.id
    }
    const id = uuid()
    s.customers.push({ id, orgId, ...fields, createdAt: ts, updatedAt: ts })
    return id
  },

  createOrder(s: DemoState, orgId: string, input: NewOrderInput, key: string): string {
    requirePermission(s, orgId, 'orders.create')
    return createOrderCore(s, orgId, input, key)
  },

  /** Mirrors save_shop_settings + the shop_settings check constraints. */
  saveShopSettings(s: DemoState, orgId: string, input: ShopSettings): void {
    requirePermission(s, orgId, 'org.manage')
    getOrg(s, orgId)
    const bands = validateBands(input.deliveryBands)
    const slug = (input.slug ?? '').trim().toLowerCase()
    if (!SLUG_RE.test(slug)) {
      fail('Shop link must be 3–40 lowercase letters, numbers or dashes, starting and ending with a letter or number', 'invalid')
    }
    const https = (v: string | null | undefined, label: string) => {
      const t = trimOrNull(v)
      if (t !== null && !/^https:\/\//.test(t)) fail(`${label} must be an https:// link`, 'invalid')
      return t
    }
    const digits = (v: string | null | undefined, label: string) => {
      const t = trimOrNull(v)
      if (t !== null && !/^[0-9]{5,8}$/.test(t)) fail(`${label} must be 5–8 digits`, 'invalid')
      return t
    }
    const coord = (v: number | null | undefined, max: number, label: string) => {
      if (v === null || v === undefined) return null
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -max || v > max) fail(`${label} is out of range`, 'invalid')
      return v
    }
    const whatsapp = trimOrNull(input.whatsappE164)
    if (whatsapp !== null && !E164_RE.test(whatsapp)) fail('WhatsApp number must be in international format, e.g. +254712345678', 'invalid')
    const next: StoredShopSettings = {
      orgId,
      slug,
      published: !!input.published,
      tagline: maxLen(trimOrNull(input.tagline), 140, 'Tagline'),
      about: maxLen(trimOrNull(input.about), 2000, 'About'),
      coverUrl: https(input.coverUrl, 'Cover image'),
      logoUrl: https(input.logoUrl, 'Logo'),
      whatsappE164: whatsapp,
      registeredName: maxLen(trimOrNull(input.registeredName), 120, 'Registered name'),
      locationLat: coord(input.locationLat, 90, 'Latitude'),
      locationLng: coord(input.locationLng, 180, 'Longitude'),
      locationLabel: maxLen(trimOrNull(input.locationLabel), 160, 'Location label'),
      pickupEnabled: input.pickupEnabled ?? true,
      deliveryEnabled: input.deliveryEnabled ?? true,
      deliveryBands: bands,
      deliveryPromise: maxLen(trimOrNull(input.deliveryPromise), 80, 'Delivery promise'),
      codEnabled: !!input.codEnabled,
      mpesaTill: digits(input.mpesaTill, 'M-Pesa Till'),
      mpesaPaybill: digits(input.mpesaPaybill, 'M-Pesa Paybill'),
      returnPolicy: maxLen(trimOrNull(input.returnPolicy), 2000, 'Return policy'),
      updatedAt: nowIso(),
    }
    if (next.published && next.deliveryEnabled && (next.locationLat === null || next.locationLng === null)) {
      fail('Set your shop location before publishing with delivery', 'invalid')
    }
    if (s.shopSettings.some((x) => x.slug === slug && x.orgId !== orgId)) fail('That shop link is already taken', 'conflict')
    const i = s.shopSettings.findIndex((x) => x.orgId === orgId)
    const before = i >= 0 ? s.shopSettings[i] : null
    if (i >= 0) s.shopSettings[i] = next
    else s.shopSettings.push(next)
    writeAudit(
      s,
      orgId,
      'shop_settings',
      orgId,
      before ? 'update' : 'insert',
      before ? { slug: before.slug, published: before.published } : null,
      { slug: next.slug, published: next.published },
    )
  },

  setProductMerchandising(s: DemoState, orgId: string, productId: string, m: ProductMerchandising): void {
    requirePermission(s, orgId, 'catalogue.write')
    const images = Array.isArray(m.images) ? m.images : []
    let uploaded = 0
    for (const img of images) {
      if (typeof img?.url !== 'string') fail('Images must be https URLs or uploaded photos', 'invalid')
      if (img.url.startsWith('data:')) {
        // Demo-only: photos uploaded in this browser are stored inline as small data URLs.
        if (!DEMO_DATA_URL_RE.test(img.url)) fail('Uploaded photos must be JPG, PNG or WebP', 'invalid')
        if (dataUrlBytes(img.url) > DEMO_MAX_IMAGE_BYTES) fail('An uploaded photo is too large for the demo workspace', 'invalid')
        uploaded++
      } else if (!/^https:\/\//.test(img.url)) {
        fail('Images must be https URLs or uploaded photos', 'invalid')
      }
    }
    if (images.length > 12) fail('A product can have at most 12 images', 'invalid')
    if (uploaded > DEMO_MAX_UPLOADED_IMAGES) fail(`The demo workspace keeps at most ${DEMO_MAX_UPLOADED_IMAGES} uploaded photos per product`, 'invalid')
    let availableFrom: string | null = null
    if (m.availableFrom) {
      const d = new Date(m.availableFrom)
      if (Number.isNaN(d.getTime())) fail('Enter a valid drop date', 'invalid')
      availableFrom = d.toISOString()
    }
    const product = s.products.find((p) => p.id === productId && p.orgId === orgId) ?? fail('Product not found', 'not_found')
    product.images = images.map((img) => (img.alt ? { url: img.url, alt: img.alt } : { url: img.url }))
    product.featured = !!m.featured
    product.availableFrom = availableFrom
    product.updatedAt = nowIso()
  },

  setVariantMerchandising(s: DemoState, orgId: string, variantId: string, m: VariantMerchandising): void {
    requirePermission(s, orgId, 'catalogue.write')
    const variant = s.variants.find((v) => v.id === variantId && v.orgId === orgId) ?? fail('Variant not found', 'not_found')
    const compareAt = m.compareAtMinor ?? null
    if (compareAt !== null && (!Number.isSafeInteger(compareAt) || compareAt <= variant.priceMinor)) {
      fail('Compare-at price must be higher than the current price', 'invalid')
    }
    const swatch = trimOrNull(m.swatch)
    if (swatch !== null && !/^#[0-9a-fA-F]{6}$/.test(swatch)) fail('Swatch must be a hex colour like #1f2937', 'invalid')
    variant.compareAtMinor = compareAt
    variant.swatch = swatch
    variant.updatedAt = nowIso()
  },

  transitionOrder(s: DemoState, orgId: string, orderId: string, to: OrderStatus, note: string | null): void {
    requireMember(s, orgId)
    const order = getOrderRow(s, orgId, orderId)
    requirePermission(s, orgId, to === 'cancelled' ? 'orders.create' : 'orders.transition')
    const from = order.status
    if (!canTransition(from, to)) {
      fail(`An order cannot move from ${ORDER_STATUS_LABEL[from] ?? from} to ${ORDER_STATUS_LABEL[to] ?? to}`, 'invalid')
    }
    if (!holdsReservation(from) && holdsReservation(to)) orderStock(s, order, 'reserve')
    else if (holdsReservation(from) && to === 'cancelled') orderStock(s, order, 'release')
    else if (holdsReservation(from) && (to === 'dispatched' || to === 'delivered')) orderStock(s, order, 'commit')

    const ts = nowIso()
    order.status = to
    order.updatedAt = ts
    if (to === 'delivered') {
      const f = s.fulfilments.find((x) => x.orderId === order.id)
      if (f) f.deliveredAt = ts
    }
    s.history.push({ id: uuid(), orgId, orderId: order.id, fromStatus: from, toStatus: to, note: trimOrNull(note), createdAt: ts })
    writeAudit(s, orgId, 'orders', order.id, 'status_changed', { status: from }, { status: to })
  },

  updateFulfilment(s: DemoState, orgId: string, orderId: string, patch: FulfilmentPatch): void {
    requireMember(s, orgId)
    const order = getOrderRow(s, orgId, orderId)
    requirePermission(s, orgId, 'fulfilment.update')
    const f = s.fulfilments.find((x) => x.orderId === order.id) ?? fail('Order not found', 'not_found')
    if (patch.method !== undefined) {
      if (patch.method !== 'pickup' && patch.method !== 'delivery') fail('Choose pickup or delivery', 'invalid')
      f.method = patch.method
    }
    if ('recipientName' in patch) f.recipientName = trimOrNull(patch.recipientName)
    if ('recipientPhone' in patch) f.recipientPhone = trimOrNull(patch.recipientPhone)
    if ('address' in patch) f.address = cleanAddress(patch.address)
    if ('assignee' in patch) f.assignee = maxLen(trimOrNull(patch.assignee), 120, 'Assignee')
    if ('trackingRef' in patch) f.trackingRef = maxLen(trimOrNull(patch.trackingRef), 120, 'Tracking reference')
    if ('proofOfDelivery' in patch) f.proofOfDelivery = maxLen(trimOrNull(patch.proofOfDelivery), 1000, 'Proof of delivery')
    order.updatedAt = nowIso()
  },

  returnItems(s: DemoState, orgId: string, input: ReturnItemsInput, key: string): void {
    requireMember(s, orgId)
    const order = getOrderRow(s, orgId, input.orderId)
    requirePermission(s, orgId, 'refunds.create')
    requireKey(key)
    const marker = `${orgId}:${key}`
    if (s.returnKeys.includes(marker)) return
    if (!['dispatched', 'delivered', 'refunded'].includes(order.status)) {
      fail('Only shipped or delivered items can be returned to stock', 'invalid')
    }
    const note = maxLen(trimOrNull(input.note), 500, 'Note')
    let i = 0
    for (const item of input.lines ?? []) {
      const qty = item.quantity
      if (!Number.isSafeInteger(qty) || qty <= 0) continue
      const line = s.lines.find((l) => l.id === item.lineId && l.orderId === order.id) ?? fail('Order line not found', 'not_found')
      if (line.returnedQuantity + qty > line.quantity) fail(`Cannot return more of ${line.productName} than was sold`, 'invalid')
      line.returnedQuantity += qty
      if (line.trackStock && line.variantId) {
        const current = level(s, line.variantId)
        s.levels[line.variantId] = adjust(current, qty)
        pushMovement(s, {
          orgId,
          variantId: line.variantId,
          kind: 'return',
          onHandDelta: qty,
          reservedDelta: 0,
          reason: 'customer_return',
          note,
          orderId: order.id,
          idempotencyKey: `${key}:${i}`,
        })
      }
      i += 1
    }
    s.returnKeys.push(marker)
  },

  recordManualPayment(s: DemoState, orgId: string, input: ManualPaymentInput, key: string): string {
    requireMember(s, orgId)
    const order = getOrderRow(s, orgId, input.orderId)
    requirePermission(s, orgId, 'payments.record')
    requireKey(key)
    const existing = s.payments.find((p) => p.orgId === orgId && p.idempotencyKey === key)
    if (existing) return existing.id
    if (order.status === 'draft' || order.status === 'cancelled') {
      fail(`Payments cannot be recorded on a ${ORDER_STATUS_LABEL[order.status].toLowerCase()} order`, 'invalid')
    }
    const currency = (input.currency ?? '').toUpperCase()
    if (currency !== order.currency) {
      fail(`This order is in ${order.currency}; a ${currency} payment must be recorded separately after conversion`, 'invalid')
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) fail('Amount must be positive', 'invalid')
    if (!PAYMENT_METHODS.includes(input.method)) fail('Choose a payment method', 'invalid')
    const received = input.receivedAt ? new Date(input.receivedAt) : now()
    if (Number.isNaN(received.getTime())) fail('Enter a valid payment date', 'invalid')
    if (received.getTime() > now().getTime() + 5 * 60_000) fail('Payment date cannot be in the future', 'invalid')
    const id = uuid()
    const payment: StoredPayment = {
      id,
      orgId,
      orderId: order.id,
      idempotencyKey: key,
      provider: 'manual',
      method: input.method,
      amountMinor: input.amountMinor,
      currency: order.currency,
      status: 'succeeded',
      verification: 'manual_unverified',
      externalRef: maxLen(trimOrNull(input.externalRef), 120, 'Reference'),
      note: maxLen(trimOrNull(input.note), 500, 'Note'),
      receivedAt: received.toISOString(),
      reversedReason: null,
      createdAt: nowIso(),
    }
    s.payments.push(payment)
    writeAudit(s, orgId, 'payments', id, 'insert', null, {
      orderNumber: order.number,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
      verification: payment.verification,
    })
    return id
  },

  reversePayment(s: DemoState, orgId: string, paymentId: string, reason: string): void {
    requireMember(s, orgId)
    const p = s.payments.find((x) => x.id === paymentId && x.orgId === orgId) ?? fail('Payment not found', 'not_found')
    requirePermission(s, orgId, 'refunds.create')
    if (p.status !== 'succeeded') fail('Only a succeeded payment can be reversed', 'invalid')
    if (p.verification === 'provider_verified') fail('Provider-verified payments are reversed through a refund', 'invalid')
    if (s.refunds.some((r) => r.paymentId === p.id && r.status !== 'failed')) {
      fail('This payment already has refunds; record a refund instead', 'invalid')
    }
    const why = (reason ?? '').trim()
    if (!why) fail('A reason is required', 'invalid')
    if (why.length > 500) fail('Reason is too long (max 500 characters)', 'invalid')
    p.status = 'reversed'
    p.reversedReason = why
    writeAudit(s, orgId, 'payments', p.id, 'reversed', { status: 'succeeded' }, { status: 'reversed', reason: why })
  },

  recordRefund(s: DemoState, orgId: string, input: RefundInput, key: string): string {
    requireMember(s, orgId)
    const p = s.payments.find((x) => x.id === input.paymentId && x.orgId === orgId) ?? fail('Payment not found', 'not_found')
    requirePermission(s, orgId, 'refunds.create')
    requireKey(key)
    const existing = s.refunds.find((r) => r.orgId === orgId && r.idempotencyKey === key)
    if (existing) return existing.id
    if (p.status !== 'succeeded') fail('Only a succeeded payment can be refunded', 'invalid')
    const currency = (input.currency ?? '').toUpperCase()
    if (currency !== p.currency) fail(`Refund currency must match the payment currency (${p.currency})`, 'invalid')
    const reason = (input.reason ?? '').trim()
    if (reason.length < 1 || reason.length > 500) fail('A refund reason (up to 500 characters) is required', 'invalid')
    validateRefund(p, s.refunds.filter((r) => r.paymentId === p.id), input.amountMinor, currency)

    const id = uuid()
    s.refunds.push({
      id,
      orgId,
      orderId: p.orderId,
      paymentId: p.id,
      idempotencyKey: key,
      amountMinor: input.amountMinor,
      currency: p.currency,
      status: 'succeeded',
      verification: 'manual_unverified',
      reason,
      createdAt: nowIso(),
    })
    const order = getOrderRow(s, orgId, p.orderId)
    writeAudit(s, orgId, 'refunds', id, 'insert', null, { orderNumber: order.number, amountMinor: input.amountMinor, currency: p.currency, reason })

    // A shipped order whose payments are fully refunded becomes `refunded`.
    const paid = s.payments.filter((x) => x.orderId === order.id && x.status === 'succeeded').reduce((a, x) => a + x.amountMinor, 0)
    const refunded = s.refunds.filter((x) => x.orderId === order.id && x.status === 'succeeded').reduce((a, x) => a + x.amountMinor, 0)
    if (paid > 0 && refunded >= paid && (order.status === 'dispatched' || order.status === 'delivered')) {
      const from = order.status
      const ts = nowIso()
      order.status = 'refunded'
      order.updatedAt = ts
      s.history.push({ id: uuid(), orgId, orderId: order.id, fromStatus: from, toStatus: 'refunded', note: 'All payments refunded', createdAt: ts })
      writeAudit(s, orgId, 'orders', order.id, 'status_changed', { status: from }, { status: 'refunded' })
    }
    return id
  },
}

// ───────────────────────── Reads ─────────────────────────

function listProductsIn(s: DemoState, orgId: string): Product[] {
  const role = requireMember(s, orgId)
  const showCost = can(role, 'cost.read')
  return s.products
    .filter((p) => p.orgId === orgId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const { orgId: _o, ...rest } = p
      void _o
      return {
        ...rest,
        variants: s.variants
          .filter((v) => v.productId === p.id)
          .sort((a, b) => a.position - b.position)
          .map((v) => {
            const lv = level(s, v.id)
            return {
              id: v.id,
              productId: v.productId,
              name: v.name,
              sku: v.sku,
              priceMinor: v.priceMinor,
              currency: v.currency,
              lowStockThreshold: v.lowStockThreshold,
              isActive: v.isActive,
              onHand: lv.onHand,
              reserved: lv.reserved,
              costMinor: showCost ? (s.costs[v.id] ?? null) : null,
              compareAtMinor: v.compareAtMinor,
              swatch: v.swatch,
            }
          }),
      }
    })
}

function orderDetail(s: DemoState, orgId: string, orderId: string): OrderDetail {
  requireMember(s, orgId)
  const o = getOrderRow(s, orgId, orderId)
  const f = s.fulfilments.find((x) => x.orderId === o.id)
  const fulfilment: Fulfilment = f
    ? (({ orgId: _o, orderId: _id, ...rest }) => {
        void _o
        void _id
        return rest
      })(f)
    : {
        method: 'pickup',
        recipientName: null,
        recipientPhone: null,
        address: {},
        assignee: null,
        provider: 'manual',
        trackingRef: null,
        proofOfDelivery: null,
        deliveredAt: null,
      }
  return {
    ...toSummary(s, o),
    lines: s.lines
      .filter((l) => l.orderId === o.id)
      .sort((a, b) => a.position - b.position)
      .map(({ orgId: _o, orderId: _id, trackStock: _t, position: _p, ...rest }) => {
        void _o
        void _id
        void _t
        void _p
        return rest
      }),
    payments: s.payments
      .filter((p) => p.orderId === o.id)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map((p) => toPayment(s, p)),
    refunds: s.refunds
      .filter((r) => r.orderId === o.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => toRefund(s, r)),
    fulfilment,
    history: s.history
      .filter((h) => h.orderId === o.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, note: h.note, createdAt: h.createdAt })),
  }
}

// ───────────────────────── Auth listeners ─────────────────────────

const authListeners = new Set<(user: SessionUser | null) => void>()

function currentUser(): SessionUser | null {
  try {
    return loadState().signedIn ? { ...DEMO_USER } : null
  } catch {
    return null
  }
}

function notifyAuth(): void {
  const user = currentUser()
  for (const cb of authListeners) {
    try {
      cb(user)
    } catch {
      // a broken listener must not break the others
    }
  }
}

// ───────────────────────── Gateway ─────────────────────────

export function createDemoGateway(): CommerceGateway {
  return {
    mode: 'demo',

    getUser: () => Promise.resolve(currentUser()),
    signIn: async () => {
      await tx((s) => {
        s.signedIn = true
      })
      notifyAuth()
    },
    signUp: async () => {
      await tx((s) => {
        s.signedIn = true
      })
      notifyAuth()
      return { needsEmailConfirmation: false }
    },
    signOut: async () => {
      await tx((s) => {
        s.signedIn = false
      })
      notifyAuth()
    },
    onAuthChange(cb) {
      authListeners.add(cb)
      return () => {
        authListeners.delete(cb)
      }
    },

    listOrganisations: () =>
      read((s) => {
        requireSignedIn(s)
        return s.members
          .filter((m) => m.userId === DEMO_USER.id)
          .flatMap((m): OrganisationWithRole[] => {
            const org = s.orgs.find((o) => o.id === m.orgId)
            if (!org) return []
            const { nextOrderNumber: _n, ...pub } = org
            void _n
            return [{ ...pub, role: m.role }]
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }),
    createOrganisation: (input) => tx((s) => ops.createOrganisation(s, input)),
    updateOrganisation: (orgId, patch) => tx((s) => ops.updateOrganisation(s, orgId, patch)),
    listMembers: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return s.members
          .filter((m) => m.orgId === orgId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(({ orgId: _o, ...rest }) => {
            void _o
            return rest
          })
      }),
    addMember: (orgId, email, role) => tx((s) => ops.addMember(s, orgId, email, role)),
    setMemberRole: (orgId, userId, role) => tx((s) => ops.setMemberRole(s, orgId, userId, role)),
    removeMember: (orgId, userId) => tx((s) => ops.removeMember(s, orgId, userId)),

    listProducts: (orgId) => read((s) => listProductsIn(s, orgId)),
    saveProduct: (orgId, input) => tx((s) => ops.saveProduct(s, orgId, input)),

    listStockMovements: (orgId, opts) =>
      read((s) => {
        requireMember(s, orgId)
        const limit = opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : 200
        return s.movements
          .filter((m) => m.orgId === orgId && (!opts?.variantId || m.variantId === opts.variantId))
          .map((m, i) => ({ m, i }))
          .sort((a, b) => b.m.createdAt.localeCompare(a.m.createdAt) || b.i - a.i)
          .slice(0, limit)
          .map(({ m }) => {
            const variant = s.variants.find((v) => v.id === m.variantId)
            const product = variant && s.products.find((p) => p.id === variant.productId)
            const { orgId: _o, idempotencyKey: _k, ...rest } = m
            void _o
            void _k
            return { ...rest, productName: product?.name ?? 'Unknown product', variantName: variant?.name ?? '' }
          })
      }),
    adjustStock: (orgId, input, key) => tx((s) => ops.adjustStock(s, orgId, input, key)),

    listCustomers: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return s.customers
          .filter((c) => c.orgId === orgId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ orgId: _o, ...rest }) => {
            void _o
            return rest
          })
      }),
    saveCustomer: (orgId, input) => tx((s) => ops.saveCustomer(s, orgId, input)),

    listOrders: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return s.orders
          .filter((o) => o.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number)
          .map((o) => toSummary(s, o))
      }),
    getOrder: (orgId, orderId) => read((s) => orderDetail(s, orgId, orderId)),
    createOrder: (orgId, input, key) => tx((s) => ops.createOrder(s, orgId, input, key)),
    transitionOrder: (orgId, orderId, to, note) => tx((s) => ops.transitionOrder(s, orgId, orderId, to, note)),
    updateFulfilment: (orgId, orderId, patch) => tx((s) => ops.updateFulfilment(s, orgId, orderId, patch)),
    returnItems: (orgId, input, key) => tx((s) => ops.returnItems(s, orgId, input, key)),

    listPayments: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return s.payments
          .filter((p) => p.orgId === orgId)
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          .map((p) => toPayment(s, p))
      }),
    listRefunds: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return s.refunds
          .filter((r) => r.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => toRefund(s, r))
      }),
    recordManualPayment: (orgId, input, key) => tx((s) => ops.recordManualPayment(s, orgId, input, key)),
    reversePayment: (orgId, paymentId, reason) => tx((s) => ops.reversePayment(s, orgId, paymentId, reason)),
    recordRefund: (orgId, input, key) => tx((s) => ops.recordRefund(s, orgId, input, key)),

    listAudit: (orgId, limit = 100) =>
      read((s) => {
        requireMember(s, orgId)
        return s.audit
          .filter((a) => a.orgId === orgId)
          .map((a, i) => ({ a, i }))
          .sort((x, y) => y.a.createdAt.localeCompare(x.a.createdAt) || y.i - x.i)
          .slice(0, Math.max(1, Math.floor(limit)))
          .map(({ a }) => {
            const { orgId: _o, ...rest } = a
            void _o
            return rest
          })
      }),
    listIntegrations: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        return integrationStatuses()
      }),

    getShopSettings: (orgId) =>
      read((s) => {
        requireMember(s, orgId)
        const row = s.shopSettings.find((x) => x.orgId === orgId)
        if (!row) return null
        const { orgId: _o, updatedAt: _u, ...settings } = row
        void _o
        void _u
        return { ...settings, deliveryBands: settings.deliveryBands.map((b) => ({ ...b })) }
      }),
    saveShopSettings: (orgId, settings) => tx((s) => ops.saveShopSettings(s, orgId, settings)),
    setProductMerchandising: (orgId, productId, m) => txStrict((s) => ops.setProductMerchandising(s, orgId, productId, m)),
    setVariantMerchandising: (orgId, variantId, m) => tx((s) => ops.setVariantMerchandising(s, orgId, variantId, m)),
    uploadProductImage: async (orgId, image, opts) => {
      await read((s) => requirePermission(s, orgId, 'catalogue.write'))
      if (!['image/webp', 'image/jpeg', 'image/png'].includes(image.type)) fail('Uploaded photos must be JPG, PNG or WebP', 'invalid')
      if (image.size > DEMO_MAX_IMAGE_BYTES) fail('This photo is too large for the demo workspace', 'invalid')
      if (opts?.signal?.aborted) fail('Upload cancelled', 'aborted')
      const url = await blobToDataUrl(image)
      opts?.onProgress?.(1)
      return url
    },

    ...createDemoCollections(demoInternals),

    // Deposits, failed deliveries and handoff (delivery-demo.ts).
    ...createDemoDeliveryAdmin(),
  }
}

/**
 * Internals shared with the demo storefront (storefront-demo.ts) so both read
 * and write the same browser-local state under the same rules. Not for UI use.
 */
export const demoInternals = {
  tx,
  read,
  fail,
  uuid,
  now,
  nowIso,
  level,
  getOrg,
  orderStock,
  createOrderCore,
  toSummary,
  requireMember,
  requirePermission,
  getOrderRow,
  writeAudit,
}
export type {
  DemoState,
  StoredOrder,
  StoredProduct,
  StoredVariant,
  StoredShopSettings,
  StoredReview,
  StoredCustomer,
  StoredFulfilment,
}

/** URL-safe random token (crypto), same alphabet as the SQL tracking token. */
export function randomToken(bytes = 18): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Test helper: switch the demo user's role in one organisation so permission
 * rules can be exercised. Not used by the app.
 */
export function __setDemoRole(orgId: string, role: Role): void {
  const s = loadState()
  const m = s.members.find((x) => x.orgId === orgId && x.userId === DEMO_USER.id)
  if (!m) throw new GatewayError('Business not found', 'not_found')
  m.role = role
  saveState(s)
}

// ───────────────────────── Seed (fictional) ─────────────────────────

interface SeedVariant {
  name: string
  sku: string
  price: number // major units
  cost?: number
  stock: number
  low?: number
  /** Genuinely higher "was" price, major units. */
  compareAt?: number
  swatch?: string
}
interface SeedProduct {
  name: string
  category: string
  description: string
  taxRateBps: number
  trackStock?: boolean
  status?: 'active' | 'archived'
  variants: SeedVariant[]
  /** Unsplash photo ids (see unsplash()) with alt text. */
  images?: [photoId: string, alt: string][]
  featured?: boolean
  /** Scheduled drop: becomes purchasable this many days after seeding. */
  dropInDays?: number
}
/** A verified review left on a delivered seed order (index into the org's order list). */
interface SeedReview {
  order: number
  product: string
  rating: number
  body: string | null
}
interface SeedExtras {
  shop: ShopSettings
  reviews: SeedReview[]
}

const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`

interface SeedOrder {
  daysAgo: number
  hour: number
  channel: NewOrderInput['channel']
  customer: string | null
  lines: [product: string, variant: string, qty: number, discountMajor?: number][]
  status: NewOrderInput['status']
  /** Statuses walked through after creation, in order. */
  path?: OrderStatus[]
  deliveryFee?: number
  delivery?: Address
  note?: string
  payments?: { method: PaymentMethod; amount: number | 'full' | 'half'; ref?: string; note?: string }[]
  refund?: { amount: number | 'full'; reason: string; returnAll?: boolean }
  cancelNote?: string
}

function buildSeed(): DemoState {
  const s = emptyState()
  const realNow = new Date()
  const at = (daysAgo: number, hour: number, minute = 0): Date => {
    const d = new Date(realNow.getTime() - daysAgo * 86_400_000)
    d.setUTCHours(hour, minute, 0, 0)
    // never in the future
    return d.getTime() > realNow.getTime() ? new Date(realNow.getTime() - 20 * 60_000) : d
  }
  const setClock = (d: Date) => {
    clockOverride = d
  }
  try {
    seedOrg(
      s,
      at,
      setClock,
      {
        name: 'Mto Home & Living',
        countryCode: 'KE',
        timezone: 'Africa/Nairobi',
        locale: 'en-KE',
        baseCurrency: 'KES',
        businessType: 'Homeware',
        taxMode: 'exclusive',
      },
      {
        contactEmail: 'hello@mto-home.demo.akunga.test',
        contactPhone: '+254711000201',
        legalName: 'Mto Home & Living Ltd (fictional)',
      },
      [
        { userId: 'demo-user-wanjiru', role: 'manager' },
        { userId: 'demo-user-brian', role: 'fulfilment' },
      ],
      MTO_PRODUCTS,
      MTO_CUSTOMERS,
      MTO_ORDERS,
      100,
      { shop: MTO_SHOP, reviews: MTO_REVIEWS },
    )
    seedOrg(
      s,
      at,
      setClock,
      {
        name: 'Atelier Lumen',
        countryCode: 'DE',
        timezone: 'Europe/Berlin',
        locale: 'de-DE',
        baseCurrency: 'EUR',
        businessType: 'Lighting & ceramics',
        taxMode: 'inclusive',
      },
      { contactEmail: 'studio@atelier-lumen.demo.akunga.test', contactPhone: null, legalName: 'Atelier Lumen GmbH (fiktiv)' },
      [{ userId: 'demo-user-jonas', role: 'sales' }],
      LUMEN_PRODUCTS,
      LUMEN_CUSTOMERS,
      LUMEN_ORDERS,
      100,
      { shop: LUMEN_SHOP, reviews: LUMEN_REVIEWS },
    )
  } finally {
    clockOverride = null
  }
  return s
}

function seedOrg(
  s: DemoState,
  at: (daysAgo: number, hour: number, minute?: number) => Date,
  setClock: (d: Date) => void,
  orgInput: NewOrganisationInput,
  orgPatch: OrganisationPatch,
  team: { userId: string; role: Role }[],
  products: SeedProduct[],
  customers: CustomerInput[],
  orders: SeedOrder[],
  minorPerMajor: number,
  extras: SeedExtras,
): void {
  setClock(at(60, 7))
  const orgId = ops.createOrganisation(s, orgInput)
  ops.updateOrganisation(s, orgId, orgPatch)
  for (const t of team) {
    const acct = DEMO_ACCOUNTS.find((a) => a.id === t.userId)
    if (acct) ops.addMember(s, orgId, acct.email, t.role)
  }
  ops.saveShopSettings(s, orgId, extras.shop)

  setClock(at(45, 8))
  const variantIds = new Map<string, string>()
  const productIds = new Map<string, string>()
  for (const p of products) {
    const productId = ops.saveProduct(s, orgId, {
      name: p.name,
      description: p.description,
      category: p.category,
      status: p.status ?? 'active',
      trackStock: p.trackStock ?? true,
      taxRateBps: p.taxRateBps,
      taxCode: p.taxRateBps > 0 ? 'STANDARD' : null,
      variants: p.variants.map((v) => ({
        name: v.name,
        sku: v.sku,
        priceMinor: Math.round(v.price * minorPerMajor),
        lowStockThreshold: v.low ?? 3,
        isActive: true,
        costMinor: v.cost === undefined ? undefined : Math.round(v.cost * minorPerMajor),
      })),
    })
    const stored = s.variants.filter((v) => v.productId === productId)
    for (const v of stored) variantIds.set(`${p.name}|${v.name}`, v.id)
    productIds.set(p.name, productId)

    // Storefront merchandising goes through the same validated operations as the UI.
    let availableFrom: string | null = null
    if (p.dropInDays) {
      const d = new Date(Date.now() + p.dropInDays * 86_400_000)
      d.setUTCHours(6, 0, 0, 0)
      availableFrom = d.toISOString()
    }
    if (p.images?.length || p.featured || availableFrom) {
      ops.setProductMerchandising(s, orgId, productId, {
        images: (p.images ?? []).map(([id, alt]) => ({ url: unsplash(id), alt })),
        featured: !!p.featured,
        availableFrom,
      })
    }
    for (const v of p.variants) {
      if (v.compareAt === undefined && v.swatch === undefined) continue
      ops.setVariantMerchandising(s, orgId, variantIds.get(`${p.name}|${v.name}`) as string, {
        compareAtMinor: v.compareAt === undefined ? null : Math.round(v.compareAt * minorPerMajor),
        swatch: v.swatch ?? null,
      })
    }
  }

  // Opening stock arrives from suppliers.
  setClock(at(44, 9))
  for (const p of products) {
    if (p.trackStock === false) continue
    for (const v of p.variants) {
      if (v.stock > 0) {
        ops.adjustStock(
          s,
          orgId,
          { variantId: variantIds.get(`${p.name}|${v.name}`) as string, delta: v.stock, reason: 'received_from_supplier', note: 'Opening stock' },
          uuid(),
        )
      }
    }
  }

  setClock(at(40, 10))
  const customerIds = new Map<string, string>()
  for (const c of customers) customerIds.set(c.name, ops.saveCustomer(s, orgId, c))

  const orderIds: string[] = []
  for (const o of orders) {
    let t = at(o.daysAgo, o.hour)
    const tick = (minutes: number) => {
      t = new Date(Math.min(t.getTime() + minutes * 60_000, Date.now() - 60_000))
      setClock(t)
    }
    setClock(t)
    const customerId = o.customer ? (customerIds.get(o.customer) ?? null) : null
    const customer = customers.find((c) => c.name === o.customer)
    const orderId = ops.createOrder(
      s,
      orgId,
      {
        status: o.status,
        channel: o.channel,
        customerId,
        note: o.note ?? null,
        deliveryFeeMinor: Math.round((o.deliveryFee ?? 0) * minorPerMajor),
        fulfilment: {
          method: o.delivery ? 'delivery' : 'pickup',
          recipientName: o.delivery ? (customer?.name ?? null) : null,
          recipientPhone: o.delivery ? (customer?.phoneE164 ?? null) : null,
          address: o.delivery ?? {},
        },
        lines: o.lines.map(([product, variant, qty, discount]) => ({
          variantId: variantIds.get(`${product}|${variant}`) as string,
          quantity: qty,
          discountMinor: Math.round((discount ?? 0) * minorPerMajor),
        })),
      },
      uuid(),
    )
    const order = s.orders.find((x) => x.id === orderId) as StoredOrder
    orderIds.push(orderId)
    if (o.channel === 'storefront') {
      // Storefront orders carry a guest tracking link, like storefront_place_order.
      order.trackingToken = randomToken()
      order.paymentPreference = o.payments?.[0]?.method === 'mobile_money' ? 'mpesa' : o.payments?.[0]?.method === 'card' ? 'card' : 'bank_transfer'
    }

    const payments = o.payments ?? []
    const pay = () => {
      for (const p of payments) {
        tick(25)
        const amount =
          p.amount === 'full' ? order.totalMinor : p.amount === 'half' ? Math.round(order.totalMinor / 2) : Math.round(p.amount * minorPerMajor)
        ops.recordManualPayment(
          s,
          orgId,
          {
            orderId,
            amountMinor: amount,
            currency: order.currency,
            method: p.method,
            externalRef: p.ref ?? null,
            receivedAt: t.toISOString(),
            note: p.note ?? null,
          },
          uuid(),
        )
      }
    }
    let paid = order.status === 'draft' // drafts cannot take payments
    for (const step of o.path ?? []) {
      tick(step === 'delivered' ? 300 : 90)
      ops.transitionOrder(s, orgId, orderId, step, step === 'cancelled' ? (o.cancelNote ?? null) : null)
      if (!paid && step !== 'cancelled' && order.status !== 'draft') {
        pay()
        paid = true
      }
    }
    if (!paid && order.status !== 'cancelled') pay()

    if (o.refund) {
      tick(60 * 24)
      const payment = s.payments.find((p) => p.orderId === orderId && p.status === 'succeeded')
      if (payment) {
        if (o.refund.returnAll) {
          ops.returnItems(
            s,
            orgId,
            {
              orderId,
              lines: s.lines.filter((l) => l.orderId === orderId).map((l) => ({ lineId: l.id, quantity: l.quantity })),
              note: o.refund.reason,
            },
            uuid(),
          )
        }
        ops.recordRefund(
          s,
          orgId,
          {
            paymentId: payment.id,
            amountMinor: o.refund.amount === 'full' ? payment.amountMinor : Math.round(o.refund.amount * minorPerMajor),
            currency: payment.currency,
            reason: o.refund.reason,
          },
          uuid(),
        )
      }
    }
  }

  // Verified reviews: only on delivered orders, once per product, author = first name.
  for (const r of extras.reviews) {
    const order = s.orders.find((x) => x.id === orderIds[r.order])
    const productId = productIds.get(r.product)
    if (!order || order.status !== 'delivered' || !productId) throw new Error(`Seed review needs a delivered order: ${r.product}`)
    const inOrder = s.lines.some(
      (l) => l.orderId === order.id && s.variants.some((v) => v.id === l.variantId && v.productId === productId),
    )
    if (!inOrder || s.reviews.some((x) => x.orderId === order.id && x.productId === productId)) {
      throw new Error(`Seed review product not in order or duplicated: ${r.product}`)
    }
    const deliveredAt = s.fulfilments.find((f) => f.orderId === order.id)?.deliveredAt ?? order.updatedAt
    const createdAt = new Date(Math.min(new Date(deliveredAt).getTime() + 26 * 3_600_000, Date.now() - 60_000)).toISOString()
    s.reviews.push({
      id: uuid(),
      orgId,
      productId,
      orderId: order.id,
      rating: r.rating,
      body: r.body,
      authorDisplay: (order.customerName ?? '').split(' ')[0] || 'Customer',
      hidden: false,
      createdAt,
    })
  }
}

// Fictional catalogue, customers and orders. No real brands, people or businesses.

const MTO_PRODUCTS: SeedProduct[] = [
  {
    name: 'Stoneware Mug',
    category: 'Kitchen & dining',
    description: 'Hand-thrown stoneware mug, 350 ml, food-safe glaze.',
    taxRateBps: 1600,
    variants: [
      { name: 'Sand', sku: 'MTO-MUG-SND', price: 1200, cost: 450, stock: 24, low: 5, swatch: '#D8C3A5' },
      { name: 'Charcoal', sku: 'MTO-MUG-CHR', price: 1200, cost: 450, stock: 12, low: 5, swatch: '#36454F' },
      { name: 'Sage', sku: 'MTO-MUG-SGE', price: 1200, cost: 450, stock: 3, low: 5, swatch: '#9CAF88' },
    ],
    images: [
      ['1514228742587-6b1558fcca3d', 'Stoneware mug on a light table'],
      ['1495474472287-4d71bcdd2085', 'Mug of coffee in morning light'],
      ['1509042239860-f550ce710b93', 'Coffee served in a ceramic cup'],
    ],
  },
  {
    name: 'Woven Sisal Basket',
    category: 'Storage',
    description: 'Hand-woven sisal basket with leather handles.',
    taxRateBps: 1600,
    variants: [
      { name: 'Small', sku: 'MTO-BSK-S', price: 1800, cost: 900, stock: 10, low: 3 },
      { name: 'Medium', sku: 'MTO-BSK-M', price: 2600, cost: 1300, stock: 8, low: 3 },
      { name: 'Large', sku: 'MTO-BSK-L', price: 3400, cost: 1700, stock: 0, low: 2 },
    ],
    images: [
      ['1524758631624-e2822e304c36', 'Bright room with plants and woven storage'],
      ['1586023492125-27b2c045efd7', 'Living room styled with natural textures'],
    ],
  },
  {
    name: 'Linen Throw',
    category: 'Textiles',
    description: 'Stonewashed linen throw, 130 × 170 cm.',
    taxRateBps: 1600,
    variants: [
      { name: 'Oat', sku: 'MTO-THR-OAT', price: 6500, cost: 3200, stock: 7, low: 2, compareAt: 7800, swatch: '#DCD0B9' },
      { name: 'Rust', sku: 'MTO-THR-RST', price: 6500, cost: 3200, stock: 4, low: 2, compareAt: 7800, swatch: '#B7410E' },
    ],
    images: [
      ['1522771739844-6a9f6d5f14af', 'Linen bedding in soft daylight'],
      ['1505693416388-ac5ce068fe85', 'Bedroom styled with a linen throw'],
      ['1493663284031-b7e3aefcae8e', 'Sofa corner with layered textiles'],
    ],
    featured: true,
  },
  {
    name: 'Soy Candle 200 g',
    category: 'Fragrance',
    description: 'Hand-poured soy wax candle in a reusable amber jar. Around 40 hours burn time.',
    taxRateBps: 1600,
    variants: [
      { name: 'Cedar & Lemongrass', sku: 'MTO-CND-CED', price: 1500, cost: 550, stock: 30, low: 6 },
      { name: 'Vanilla & Fig', sku: 'MTO-CND-VAN', price: 1500, cost: 550, stock: 18, low: 6 },
    ],
    images: [
      ['1603006905003-be475563bc59', 'Lit soy candle in a glass jar'],
      ['1572726729207-a78d6feb18d7', 'Candles glowing on a shelf'],
    ],
    featured: true,
  },
  {
    name: 'Olive Wood Serving Board',
    category: 'Kitchen & dining',
    description: 'Hand-carved serving board, each grain pattern unique.',
    taxRateBps: 1600,
    variants: [{ name: 'Default', sku: 'MTO-BRD-OLV', price: 4200, cost: 2100, stock: 5, low: 2 }],
    images: [
      ['1556909114-f6e7ad7d3136', 'Kitchen counter with wooden boards'],
      ['1484101403633-562f891dc89a', 'Table set for a shared meal'],
    ],
  },
  {
    name: 'Glazed Ceramic Vase',
    category: 'Decor',
    description: 'Reactive-glaze vase, watertight.',
    taxRateBps: 1600,
    variants: [
      { name: 'Tall', sku: 'MTO-VAS-T', price: 3800, cost: 1600, stock: 5, low: 2, compareAt: 4500 },
      { name: 'Short', sku: 'MTO-VAS-S', price: 2900, cost: 1200, stock: 9, low: 2 },
    ],
    images: [
      ['1578500494198-246f612d3b3d', 'Glazed ceramic vase'],
      ['1485955900006-10f4d324d411', 'Potted plant beside ceramics'],
      ['1565193566173-7a0ee3dbe261', 'Handmade ceramic pieces'],
    ],
    featured: true,
  },
  {
    name: 'Cotton Cushion Cover',
    category: 'Textiles',
    description: 'Striped handloom cotton cover, 45 × 45 cm, insert not included.',
    taxRateBps: 1600,
    variants: [{ name: 'Default', sku: 'MTO-CSH-STR', price: 2200, cost: 900, stock: 15, low: 4, compareAt: 2600 }],
    images: [
      ['1584100936595-c0654b55a2e2', 'Striped cotton cushions on a sofa'],
      ['1555041469-a586c61ea9bc', 'Sofa with cushions'],
    ],
  },
  {
    name: 'Brass Tea Light Holders (set of 3)',
    category: 'Decor',
    description: 'Hammered brass holders in three heights.',
    taxRateBps: 1600,
    variants: [{ name: 'Default', sku: 'MTO-TLH-3', price: 2400, stock: 12, low: 3 }],
    images: [['1602874801007-bd458bb1b8b6', 'Tea lights glowing in metal holders']],
  },
  {
    name: 'Gift Wrapping',
    category: 'Services',
    description: 'Recycled kraft paper, twine and a handwritten card.',
    taxRateBps: 0,
    trackStock: false,
    variants: [{ name: 'Standard', sku: 'MTO-GIFT', price: 300, stock: 0, low: 0 }],
    images: [['1513885535751-8b9238bd345a', 'Gift wrapped in kraft paper and twine']],
  },
  {
    name: 'Banana-Fibre Pendant Shade',
    category: 'Lighting',
    description: 'Hand-woven banana-fibre lampshade, 40 cm across, fits a standard E27 pendant. Small first batch.',
    taxRateBps: 1600,
    variants: [{ name: 'Natural', sku: 'MTO-PND-BAN', price: 5400, cost: 2300, stock: 12, low: 3, swatch: '#C8A97E' }],
    images: [['1507473885765-e6ed057f782c', 'Woven pendant lamp shade']],
    dropInDays: 3,
  },
  {
    name: 'Recycled Glass Tumblers (set of 4)',
    category: 'Kitchen & dining',
    description: 'Discontinued line, kept for order history.',
    taxRateBps: 1600,
    status: 'archived',
    variants: [{ name: 'Default', sku: 'MTO-TMB-4', price: 2000, cost: 800, stock: 2, low: 2 }],
  },
]

const MTO_CUSTOMERS: CustomerInput[] = [
  { name: 'Amina Wekesa', phoneE164: '+254712000101', email: 'amina.w@example.com', countryCode: 'KE', marketingConsent: true, tags: ['repeat', 'whatsapp'], notes: 'Prefers pickup on Saturdays.' },
  { name: 'Kevin Mutua', phoneE164: '+254722000102', email: null, countryCode: 'KE', marketingConsent: false, tags: ['whatsapp'], notes: null },
  { name: 'Grace Njoroge', phoneE164: '+254733000103', email: 'grace.n@example.com', countryCode: 'KE', marketingConsent: true, tags: ['instagram', 'vip'], notes: null },
  { name: 'David Kiprop', phoneE164: '+254701000104', email: null, countryCode: 'KE', marketingConsent: false, tags: [], notes: null },
  { name: 'Fatuma Ali', phoneE164: '+254745000105', email: 'fatuma.a@example.com', countryCode: 'KE', marketingConsent: true, tags: ['whatsapp'], notes: 'Office in Westlands, deliver before 5 pm.' },
  { name: 'Njeri Wambui', phoneE164: '+254757000106', email: null, countryCode: 'KE', marketingConsent: false, tags: ['instagram'], notes: null },
  { name: 'Sophie Turner-Hale', phoneE164: '+447700900123', email: 'sophie.th@example.co.uk', countryCode: 'GB', marketingConsent: true, tags: ['international'], notes: 'Ships to a Nairobi address while visiting.' },
  { name: 'Michael Brooks', phoneE164: '+12025550143', email: 'm.brooks@example.com', countryCode: 'US', marketingConsent: false, tags: ['international'], notes: null },
]

const NAIROBI_A: Address = { line1: 'Apartment 4B, Cedar Court', line2: 'Riverside Drive', city: 'Nairobi', countryCode: 'KE' }
const NAIROBI_B: Address = { line1: 'Suite 12, 3rd floor, Parkview Plaza', city: 'Nairobi', region: 'Westlands', countryCode: 'KE', instructions: 'Leave with reception' }
const NAIROBI_C: Address = { line1: 'House 27, Jacaranda Close', city: 'Nairobi', region: 'Karen', countryCode: 'KE', instructions: 'Call on arrival' }
const MOMBASA: Address = { line1: 'Plot 9, Coral Lane', city: 'Mombasa', region: 'Nyali', countryCode: 'KE' }

const MTO_ORDERS: SeedOrder[] = [
  { daysAgo: 29, hour: 8, channel: 'walk_in', customer: 'Amina Wekesa', status: 'confirmed', lines: [['Stoneware Mug', 'Sand', 2], ['Soy Candle 200 g', 'Cedar & Lemongrass', 1]], path: ['ready', 'delivered'], payments: [{ method: 'cash', amount: 'full' }] },
  { daysAgo: 27, hour: 10, channel: 'whatsapp', customer: 'Kevin Mutua', status: 'confirmed', lines: [['Woven Sisal Basket', 'Medium', 1]], deliveryFee: 300, delivery: NAIROBI_A, path: ['preparing', 'ready', 'dispatched', 'delivered'], payments: [{ method: 'mobile_money', amount: 'full', ref: 'SJK4H7Q2P1' }] },
  { daysAgo: 25, hour: 12, channel: 'instagram', customer: 'Grace Njoroge', status: 'pending_confirmation', lines: [['Linen Throw', 'Oat', 1]], deliveryFee: 300, delivery: NAIROBI_C, path: ['confirmed', 'preparing', 'ready', 'dispatched', 'delivered'], payments: [{ method: 'mobile_money', amount: 'full', ref: 'SJM8T2R5K9' }], refund: { amount: 1000, reason: 'Small stain on the hem; customer kept the throw with a partial refund' } },
  { daysAgo: 22, hour: 9, channel: 'storefront', customer: 'Sophie Turner-Hale', status: 'confirmed', lines: [['Soy Candle 200 g', 'Vanilla & Fig', 3], ['Gift Wrapping', 'Standard', 1]], deliveryFee: 450, delivery: NAIROBI_B, path: ['preparing', 'ready', 'dispatched', 'delivered'], payments: [{ method: 'bank_transfer', amount: 'full', ref: 'TRF-20931' }] },
  { daysAgo: 20, hour: 14, channel: 'phone', customer: 'David Kiprop', status: 'confirmed', lines: [['Glazed Ceramic Vase', 'Tall', 1]], deliveryFee: 600, delivery: MOMBASA, path: ['ready', 'dispatched', 'delivered'], payments: [{ method: 'mobile_money', amount: 'full', ref: 'SJP3W6N1D4' }], refund: { amount: 'full', reason: 'Arrived cracked in transit; returned and refunded in full', returnAll: true } },
  { daysAgo: 18, hour: 11, channel: 'whatsapp', customer: 'Fatuma Ali', status: 'confirmed', lines: [['Olive Wood Serving Board', 'Default', 1]], delivery: NAIROBI_B, path: ['cancelled'], cancelNote: 'Customer changed her mind before preparation' },
  { daysAgo: 15, hour: 16, channel: 'instagram', customer: 'Kevin Mutua', status: 'confirmed', lines: [['Stoneware Mug', 'Charcoal', 4, 200]], deliveryFee: 300, delivery: NAIROBI_A, path: ['preparing', 'ready', 'dispatched', 'delivered'], payments: [{ method: 'mobile_money', amount: 'full', ref: 'SJR7Y4C8B2' }] },
  { daysAgo: 12, hour: 13, channel: 'walk_in', customer: null, status: 'confirmed', lines: [['Soy Candle 200 g', 'Vanilla & Fig', 2]], path: ['ready', 'delivered'], payments: [{ method: 'cash', amount: 'full' }] },
  { daysAgo: 9, hour: 10, channel: 'storefront', customer: 'Michael Brooks', status: 'confirmed', lines: [['Linen Throw', 'Rust', 1], ['Cotton Cushion Cover', 'Default', 2]], deliveryFee: 450, delivery: NAIROBI_C, path: ['preparing', 'ready', 'dispatched'], payments: [{ method: 'bank_transfer', amount: 'full', ref: 'TRF-21877' }] },
  { daysAgo: 6, hour: 9, channel: 'whatsapp', customer: 'Amina Wekesa', status: 'confirmed', lines: [['Woven Sisal Basket', 'Small', 2]], path: ['preparing', 'ready'], payments: [{ method: 'mobile_money', amount: 'half', ref: 'SJT2K9V5M7', note: 'Deposit; balance on pickup' }] },
  { daysAgo: 4, hour: 15, channel: 'phone', customer: 'Grace Njoroge', status: 'confirmed', lines: [['Brass Tea Light Holders (set of 3)', 'Default', 1], ['Soy Candle 200 g', 'Cedar & Lemongrass', 2]], deliveryFee: 300, delivery: NAIROBI_C, path: ['preparing'] },
  { daysAgo: 2, hour: 11, channel: 'whatsapp', customer: 'Fatuma Ali', status: 'confirmed', lines: [['Glazed Ceramic Vase', 'Short', 1]], deliveryFee: 300, delivery: NAIROBI_B },
  { daysAgo: 1, hour: 17, channel: 'instagram', customer: 'Njeri Wambui', status: 'pending_confirmation', lines: [['Stoneware Mug', 'Sage', 1]], note: 'Asked whether a second Sage mug is coming back in stock' },
  { daysAgo: 0, hour: 6, channel: 'storefront', customer: 'Sophie Turner-Hale', status: 'draft', lines: [['Cotton Cushion Cover', 'Default', 2]] },
]

const LUMEN_PRODUCTS: SeedProduct[] = [
  {
    name: 'Messing-Kerzenständer',
    category: 'Leuchten',
    description: 'Gedrehter Kerzenständer aus Messing.',
    taxRateBps: 1900,
    variants: [
      { name: 'Klein', sku: 'ALU-KRZ-K', price: 34, cost: 14, stock: 14, low: 3 },
      { name: 'Groß', sku: 'ALU-KRZ-G', price: 48, cost: 19, stock: 6, low: 3 },
    ],
    images: [
      ['1572726729207-a78d6feb18d7', 'Kerzen im Abendlicht'],
      ['1603006905003-be475563bc59', 'Brennende Kerze'],
    ],
    featured: true,
  },
  {
    name: 'Keramikschale Ascheglasur',
    category: 'Keramik',
    description: 'Handgedrehte Schale, Ø 18 cm.',
    taxRateBps: 1900,
    variants: [{ name: 'Default', sku: 'ALU-SCH-18', price: 39, cost: 15, stock: 9, low: 2 }],
    images: [
      ['1610701596007-11502861dcfa', 'Handgedrehte Keramik'],
      ['1565193566173-7a0ee3dbe261', 'Keramikschalen auf einem Regal'],
    ],
  },
  {
    name: 'Leinen-Tischläufer',
    category: 'Textilien',
    description: 'Gewaschenes Leinen, 40 × 150 cm.',
    taxRateBps: 1900,
    variants: [
      { name: 'Natur', sku: 'ALU-TL-NAT', price: 29.9, cost: 11, stock: 11, low: 3, compareAt: 34.9, swatch: '#E8E0D0' },
      { name: 'Salbei', sku: 'ALU-TL-SAL', price: 29.9, cost: 11, stock: 2, low: 3, compareAt: 34.9, swatch: '#A3B18A' },
    ],
    images: [['1484101403633-562f891dc89a', 'Gedeckter Tisch mit Leinen']],
  },
  {
    name: 'Duftkerze Feige',
    category: 'Duft',
    description: 'Rapswachs-Kerze im Keramikbecher.',
    taxRateBps: 1900,
    variants: [{ name: 'Default', sku: 'ALU-DK-FG', price: 24.5, cost: 8, stock: 20, low: 5 }],
    images: [['1602874801007-bd458bb1b8b6', 'Duftkerze im Keramikbecher']],
  },
]

const LUMEN_CUSTOMERS: CustomerInput[] = [
  { name: 'Lena Hoffmann', phoneE164: '+4915112345678', email: 'lena.h@example.de', countryCode: 'DE', marketingConsent: true, tags: ['stammkundin'], notes: null },
  { name: 'Paul Schreiber', phoneE164: '+4917623456789', email: null, countryCode: 'DE', marketingConsent: false, tags: [], notes: null },
  { name: 'Camille Laurent', phoneE164: '+33612345678', email: 'camille.l@example.fr', countryCode: 'FR', marketingConsent: false, tags: ['international'], notes: null },
]

const LUMEN_ORDERS: SeedOrder[] = [
  { daysAgo: 21, hour: 9, channel: 'storefront', customer: 'Lena Hoffmann', status: 'confirmed', lines: [['Messing-Kerzenständer', 'Groß', 2], ['Duftkerze Feige', 'Default', 1]], deliveryFee: 4.9, delivery: { line1: 'Lindenstraße 14', postalCode: '10969', city: 'Berlin', countryCode: 'DE' }, path: ['preparing', 'ready', 'dispatched', 'delivered'], payments: [{ method: 'bank_transfer', amount: 'full', ref: 'SEPA-4471' }] },
  { daysAgo: 11, hour: 13, channel: 'instagram', customer: 'Camille Laurent', status: 'confirmed', lines: [['Keramikschale Ascheglasur', 'Default', 1]], deliveryFee: 9.9, delivery: { line1: '8 rue des Tanneurs', postalCode: '69001', city: 'Lyon', countryCode: 'FR' }, path: ['ready', 'dispatched'], payments: [{ method: 'card', amount: 'full', ref: 'POS-88213' }] },
  { daysAgo: 5, hour: 10, channel: 'walk_in', customer: 'Paul Schreiber', status: 'confirmed', lines: [['Leinen-Tischläufer', 'Natur', 1]] },
  { daysAgo: 1, hour: 15, channel: 'phone', customer: 'Lena Hoffmann', status: 'pending_confirmation', lines: [['Leinen-Tischläufer', 'Salbei', 1], ['Duftkerze Feige', 'Default', 2]] },
]

// Storefront settings (fictional business, numbers and coordinates).
const MTO_SHOP: ShopSettings = {
  slug: 'mto-home',
  published: true,
  tagline: 'Handmade homeware from Kenyan makers',
  about:
    'Mto Home & Living is a small Westlands studio selling stoneware, sisal and linen made by workshops around Nairobi. Every piece is checked by hand before it leaves the shop.',
  coverUrl: unsplash('1586023492125-27b2c045efd7'),
  logoUrl: null,
  whatsappE164: '+254711000202',
  registeredName: 'MTO HOME AND LIVING',
  locationLat: -1.2676,
  locationLng: 36.8108,
  locationLabel: 'Westlands, Nairobi',
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryBands: [
    { maxKm: 3, feeMinor: 15000 },
    { maxKm: 8, feeMinor: 30000 },
    { maxKm: 15, feeMinor: 50000 },
  ],
  deliveryPromise: 'Same-day in Nairobi before 2pm',
  codEnabled: true,
  mpesaTill: '5123456',
  mpesaPaybill: null,
  returnPolicy:
    'Changed your mind? Return unused items within 7 days of delivery for a refund or exchange. Breakages in transit are replaced free: send us a photo on WhatsApp within 24 hours.',
}

const LUMEN_SHOP: ShopSettings = {
  slug: 'atelier-lumen',
  published: true,
  tagline: 'Licht, Keramik und Leinen aus Kreuzberg',
  about: 'Atelier Lumen ist eine kleine Werkstatt in Berlin-Kreuzberg für Messingleuchter, handgedrehte Keramik und gewaschenes Leinen.',
  coverUrl: unsplash('1507473885765-e6ed057f782c'),
  logoUrl: null,
  whatsappE164: null,
  registeredName: 'Atelier Lumen GmbH',
  locationLat: 52.4986,
  locationLng: 13.403,
  locationLabel: 'Kreuzberg, Berlin',
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryBands: [
    { maxKm: 5, feeMinor: 490 },
    { maxKm: 12, feeMinor: 790 },
    { maxKm: 25, feeMinor: 1290 },
  ],
  deliveryPromise: 'Kurierlieferung in Berlin am nächsten Werktag',
  codEnabled: false,
  mpesaTill: null,
  mpesaPaybill: null,
  returnPolicy: '14 Tage Rückgaberecht für unbenutzte Artikel. Bruchschäden beim Versand ersetzen wir kostenlos.',
}

// Indices refer to MTO_ORDERS / LUMEN_ORDERS; every one is a delivered order.
const MTO_REVIEWS: SeedReview[] = [
  { order: 0, product: 'Stoneware Mug', rating: 5, body: 'Lovely weight in the hand, and the Sand glaze is even nicer in person.' },
  { order: 0, product: 'Soy Candle 200 g', rating: 4, body: 'Burns evenly. I wish the cedar scent were a little stronger.' },
  { order: 1, product: 'Woven Sisal Basket', rating: 5, body: 'Sturdy and beautifully finished. The rider called ahead.' },
  { order: 2, product: 'Linen Throw', rating: 4, body: 'Soft after the first wash. There was a small mark on the hem, and the shop sorted it out quickly.' },
  { order: 3, product: 'Soy Candle 200 g', rating: 5, body: 'Vanilla & Fig smells amazing, and the gift wrap was beautiful.' },
  { order: 6, product: 'Stoneware Mug', rating: 5, body: null },
]

const LUMEN_REVIEWS: SeedReview[] = [
  { order: 0, product: 'Messing-Kerzenständer', rating: 5, body: 'Wunderschön verarbeitet, schwerer als gedacht.' },
  { order: 0, product: 'Duftkerze Feige', rating: 4, body: 'Toller Duft, brennt sauber ab.' },
]
