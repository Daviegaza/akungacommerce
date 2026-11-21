import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { OrderStatus } from '@/domain/orders'
import type { Role } from '@/domain/permissions'
import { integrationStatuses } from '@/integrations/registry'
import { GatewayError, type CommerceGateway } from './gateway'
import type {
  Address,
  AuditEntry,
  Customer,
  Fulfilment,
  Member,
  OrderDetail,
  OrderLine,
  OrderSummary,
  Organisation,
  OrganisationWithRole,
  Payment,
  Product,
  Refund,
  StockMovement,
  Variant,
} from './types'
import type { ShopSettings } from './storefront'
import { mapBands, mapImages } from './storefront-supabase'
import { PRODUCT_IMAGES_BUCKET, UploadError, productImagePathFromUrl, uploadProductImageToStorage } from '@/media/upload'
import { createSupabaseCollections } from './collections-supabase'
import { createSupabaseDeliveryAdmin } from './delivery-supabase'
import { createSupabaseTrust } from './trust-supabase'
import { CONSENT_SOURCES } from '@/domain/marketing'
import { createSupabaseExpansion } from './expansion-supabase'

/* Row shapes returned by PostgREST (snake_case). Only the columns we select. */
type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? null : String(v))
const n = (v: unknown) => Number(v ?? 0)
const nOrNull = (v: unknown) => (v == null ? null : Number(v))

export function mapShopSettings(r: Row): ShopSettings {
  return {
    slug: String(r.slug),
    published: Boolean(r.published),
    tagline: s(r.tagline),
    about: s(r.about),
    coverUrl: s(r.cover_url),
    logoUrl: s(r.logo_url),
    whatsappE164: s(r.whatsapp_e164),
    registeredName: s(r.registered_name),
    locationLat: nOrNull(r.location_lat),
    locationLng: nOrNull(r.location_lng),
    locationLabel: s(r.location_label),
    pickupEnabled: Boolean(r.pickup_enabled),
    deliveryEnabled: Boolean(r.delivery_enabled),
    deliveryBands: mapBands(r.delivery_bands),
    deliveryPromise: s(r.delivery_promise),
    codEnabled: Boolean(r.cod_enabled),
    mpesaTill: s(r.mpesa_till),
    mpesaPaybill: s(r.mpesa_paybill),
    returnPolicy: s(r.return_policy),
    trackingLinkDays: r.tracking_link_days == null ? 90 : Number(r.tracking_link_days),
  }
}

/** ShopSettings -> the snake_case JSON save_shop_settings expects. */
export function shopSettingsPayload(x: ShopSettings): Row {
  return {
    slug: x.slug.trim().toLowerCase(),
    published: x.published,
    tagline: x.tagline,
    about: x.about,
    cover_url: x.coverUrl,
    logo_url: x.logoUrl,
    whatsapp_e164: x.whatsappE164,
    registered_name: x.registeredName,
    location_lat: x.locationLat,
    location_lng: x.locationLng,
    location_label: x.locationLabel,
    pickup_enabled: x.pickupEnabled,
    delivery_enabled: x.deliveryEnabled,
    delivery_bands: x.deliveryBands.map((b) => ({ max_km: b.maxKm, fee_minor: b.feeMinor })),
    delivery_promise: x.deliveryPromise,
    cod_enabled: x.codEnabled,
    mpesa_till: x.mpesaTill,
    mpesa_paybill: x.mpesaPaybill,
    return_policy: x.returnPolicy,
  }
}

function fail(error: { message: string; code?: string } | null): never {
  throw new GatewayError(error?.message ?? 'Something went wrong', error?.code)
}

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) fail(res.error)
  return res.data as T
}

function mapOrg(r: Row): Organisation {
  return {
    id: String(r.id),
    name: String(r.name),
    legalName: s(r.legal_name),
    countryCode: String(r.country_code),
    timezone: String(r.timezone),
    locale: String(r.locale),
    baseCurrency: String(r.base_currency),
    businessType: s(r.business_type),
    taxMode: r.tax_mode as Organisation['taxMode'],
    contactEmail: s(r.contact_email),
    contactPhone: s(r.contact_phone),
    createdAt: String(r.created_at),
  }
}

function mapVariant(r: Row): Variant {
  const levels = (r.inventory_levels as Row[] | null) ?? []
  const cost = r.variant_costs as Row | Row[] | null
  const costRow = Array.isArray(cost) ? cost[0] : cost
  return {
    id: String(r.id),
    productId: String(r.product_id),
    name: String(r.name),
    sku: s(r.sku),
    priceMinor: n(r.price_minor),
    currency: String(r.currency),
    lowStockThreshold: n(r.low_stock_threshold),
    isActive: Boolean(r.is_active),
    onHand: levels.reduce((a, l) => a + n(l.on_hand), 0),
    reserved: levels.reduce((a, l) => a + n(l.reserved), 0),
    costMinor: costRow ? n(costRow.cost_minor) : null,
    compareAtMinor: nOrNull(r.compare_at_minor),
    swatch: s(r.swatch),
  }
}

function mapPayment(r: Row): Payment {
  const order = r.orders as Row | null
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: order ? n(order.number) : null,
    provider: String(r.provider),
    method: r.method as Payment['method'],
    amountMinor: n(r.amount_minor),
    currency: String(r.currency),
    status: r.status as Payment['status'],
    verification: r.verification as Payment['verification'],
    externalRef: s(r.external_ref),
    note: s(r.note),
    receivedAt: String(r.received_at),
    reversedReason: s(r.reversed_reason),
    createdAt: String(r.created_at),
  }
}

function mapRefund(r: Row): Refund {
  const order = r.orders as Row | null
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: order ? n(order.number) : null,
    paymentId: String(r.payment_id),
    amountMinor: n(r.amount_minor),
    currency: String(r.currency),
    status: r.status as Refund['status'],
    verification: r.verification as Refund['verification'],
    reason: String(r.reason),
    createdAt: String(r.created_at),
  }
}

function mapOrderSummary(r: Row): OrderSummary {
  const payments = (r.payments as Row[] | null) ?? []
  const refunds = (r.refunds as Row[] | null) ?? []
  const fulfilment = (Array.isArray(r.fulfilments) ? r.fulfilments[0] : r.fulfilments) as Row | null
  const paid = payments.filter((p) => p.status === 'succeeded').reduce((a, p) => a + n(p.amount_minor), 0)
  const refunded = refunds.filter((x) => x.status === 'succeeded').reduce((a, x) => a + n(x.amount_minor), 0)
  return {
    id: String(r.id),
    number: n(r.number),
    status: r.status as OrderStatus,
    channel: r.channel as OrderSummary['channel'],
    currency: String(r.currency),
    customerId: s(r.customer_id),
    customerName: s(r.customer_name),
    customerPhone: s(r.customer_phone),
    subtotalMinor: n(r.subtotal_minor),
    discountMinor: n(r.discount_minor),
    taxMinor: n(r.tax_minor),
    deliveryFeeMinor: n(r.delivery_fee_minor),
    totalMinor: n(r.total_minor),
    taxMode: r.tax_mode as OrderSummary['taxMode'],
    note: s(r.note),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    netPaidMinor: paid - refunded,
    fulfilmentMethod: (fulfilment?.method as OrderSummary['fulfilmentMethod']) ?? 'pickup',
  }
}

const ORDER_SUMMARY_SELECT = '*, payments(amount_minor, status), refunds(amount_minor, status), fulfilments(method)'

export function createSupabaseGateway(url: string, anonKey: string): CommerceGateway {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  })

  return {
    mode: 'supabase',

    async getUser() {
      const { data } = await sb.auth.getUser()
      return data.user ? { id: data.user.id, email: data.user.email ?? '' } : null
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new GatewayError(error.message)
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: typeof window === 'undefined' ? undefined : window.location.origin + '/app' } })
      if (error) throw new GatewayError(error.message)
      return { needsEmailConfirmation: !data.session }
    },
    async signOut() {
      await sb.auth.signOut()
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => {
        cb(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
      })
      return () => data.subscription.unsubscribe()
    },

    async listOrganisations() {
      const { data: auth } = await sb.auth.getUser()
      if (!auth.user) return []
      const rows = check(
        await sb.from('memberships').select('role, organisations(*)').eq('user_id', auth.user.id),
      ) as Row[]
      return rows
        .filter((r) => r.organisations)
        .map((r) => ({ ...mapOrg(r.organisations as Row), role: r.role as Role }) satisfies OrganisationWithRole)
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async createOrganisation(input) {
      return check(
        await sb.rpc('create_organisation', {
          p_name: input.name,
          p_country: input.countryCode,
          p_timezone: input.timezone,
          p_locale: input.locale,
          p_currency: input.baseCurrency,
          p_business_type: input.businessType,
          p_tax_mode: input.taxMode,
        }),
      ) as string
    },
    async updateOrganisation(orgId, patch) {
      const row: Row = {}
      if (patch.name !== undefined) row.name = patch.name
      if (patch.legalName !== undefined) row.legal_name = patch.legalName
      if (patch.timezone !== undefined) row.timezone = patch.timezone
      if (patch.locale !== undefined) row.locale = patch.locale
      if (patch.businessType !== undefined) row.business_type = patch.businessType
      if (patch.taxMode !== undefined) row.tax_mode = patch.taxMode
      if (patch.contactEmail !== undefined) row.contact_email = patch.contactEmail
      if (patch.contactPhone !== undefined) row.contact_phone = patch.contactPhone
      const data = check(await sb.from('organisations').update(row).eq('id', orgId).select().single()) as Row
      return mapOrg(data)
    },
    async listMembers(orgId) {
      const rows = check(await sb.from('memberships').select('*').eq('org_id', orgId).order('created_at')) as Row[]
      return rows.map(
        (r): Member => ({
          userId: String(r.user_id),
          email: s(r.email),
          displayName: s(r.display_name),
          role: r.role as Role,
          createdAt: String(r.created_at),
        }),
      )
    },
    async addMember(orgId, email, role) {
      check(await sb.rpc('add_member_by_email', { p_org: orgId, p_email: email, p_role: role }))
    },
    async setMemberRole(orgId, userId, role) {
      check(await sb.rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role }))
    },
    async removeMember(orgId, userId) {
      check(await sb.rpc('remove_member', { p_org: orgId, p_user: userId }))
    },

    async listProducts(orgId) {
      const rows = check(
        await sb
          .from('products')
          .select('*, product_variants(*, inventory_levels(on_hand, reserved), variant_costs(cost_minor))')
          .eq('org_id', orgId)
          .order('name'),
      ) as Row[]
      return rows.map(
        (r): Product => ({
          id: String(r.id),
          name: String(r.name),
          description: s(r.description),
          category: s(r.category),
          status: r.status as Product['status'],
          trackStock: Boolean(r.track_stock),
          taxRateBps: n(r.tax_rate_bps),
          taxCode: s(r.tax_code),
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
          variants: ((r.product_variants as Row[]) ?? [])
            .sort((a, b) => n(a.position) - n(b.position))
            .map(mapVariant),
          images: mapImages(r.images),
          featured: Boolean(r.featured),
          availableFrom: s(r.available_from),
        }),
      )
    },
    async saveProduct(orgId, input) {
      return check(
        await sb.rpc('save_product', {
          p_org: orgId,
          p_product: {
            id: input.id ?? null,
            name: input.name,
            description: input.description,
            category: input.category,
            status: input.status,
            track_stock: input.trackStock,
            tax_rate_bps: input.taxRateBps,
            tax_code: input.taxCode,
            variants: input.variants.map((v) => ({
              id: v.id ?? null,
              name: v.name,
              sku: v.sku,
              price_minor: v.priceMinor,
              low_stock_threshold: v.lowStockThreshold,
              is_active: v.isActive,
              ...(v.costMinor !== undefined ? { cost_minor: v.costMinor } : {}),
            })),
          },
        }),
      ) as string
    },

    async listStockMovements(orgId, opts) {
      let q = sb
        .from('stock_movements')
        .select('*, product_variants(name, products(name))')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(opts?.limit ?? 200)
      if (opts?.variantId) q = q.eq('variant_id', opts.variantId)
      const rows = check(await q) as Row[]
      return rows.map((r): StockMovement => {
        const v = r.product_variants as Row | null
        return {
          id: String(r.id),
          variantId: String(r.variant_id),
          productName: String((v?.products as Row | null)?.name ?? 'Unknown product'),
          variantName: String(v?.name ?? ''),
          kind: r.kind as StockMovement['kind'],
          onHandDelta: n(r.on_hand_delta),
          reservedDelta: n(r.reserved_delta),
          reason: s(r.reason),
          note: s(r.note),
          orderId: s(r.order_id),
          createdAt: String(r.created_at),
        }
      })
    },
    async adjustStock(orgId, input, idempotencyKey) {
      check(
        await sb.rpc('adjust_stock', {
          p_org: orgId,
          p_variant: input.variantId,
          p_delta: input.delta,
          p_reason: input.reason,
          p_note: input.note,
          p_idempotency_key: idempotencyKey,
        }),
      )
    },

    async listCustomers(orgId) {
      const rows = check(await sb.from('customers').select('*').eq('org_id', orgId).order('name')) as Row[]
      return rows.map(
        (r): Customer => ({
          id: String(r.id),
          name: String(r.name),
          phoneE164: s(r.phone_e164),
          email: s(r.email),
          countryCode: s(r.country_code),
          marketingConsent: Boolean(r.marketing_consent),
          consentUpdatedAt: s(r.consent_updated_at),
          consentSource: CONSENT_SOURCES.find((x) => x === r.consent_source) ?? null,
          tags: (r.tags as string[]) ?? [],
          notes: s(r.notes),
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        }),
      )
    },
    async saveCustomer(orgId, input) {
      const row = {
        org_id: orgId,
        name: input.name.trim(),
        phone_e164: input.phoneE164,
        email: input.email?.trim().toLowerCase() || null,
        country_code: input.countryCode,
        // consent_updated_at / consent_source are stamped by a trigger, only when consent really changes.
        marketing_consent: input.marketingConsent,
        tags: input.tags,
        notes: input.notes,
      }
      if (input.id) {
        check(await sb.from('customers').update(row).eq('id', input.id).eq('org_id', orgId))
        return input.id
      }
      const data = check(await sb.from('customers').insert(row).select('id').single()) as Row
      return String(data.id)
    },

    async listOrders(orgId) {
      const rows = check(
        await sb.from('orders').select(ORDER_SUMMARY_SELECT).eq('org_id', orgId).order('created_at', { ascending: false }).limit(1000),
      ) as Row[]
      return rows.map(mapOrderSummary)
    },
    async getOrder(orgId, orderId) {
      const r = check(
        await sb
          .from('orders')
          .select('*, order_lines(*), payments(*), refunds(*), fulfilments(*), order_status_history(*)')
          .eq('org_id', orgId)
          .eq('id', orderId)
          .single(),
      ) as Row
      const f = (Array.isArray(r.fulfilments) ? r.fulfilments[0] : r.fulfilments) as Row | null
      const fulfilment: Fulfilment = {
        method: (f?.method as Fulfilment['method']) ?? 'pickup',
        recipientName: s(f?.recipient_name),
        recipientPhone: s(f?.recipient_phone),
        address: (f?.address as Address) ?? {},
        assignee: s(f?.assignee),
        provider: String(f?.provider ?? 'manual'),
        trackingRef: s(f?.tracking_ref),
        proofOfDelivery: s(f?.proof_of_delivery),
        deliveredAt: s(f?.delivered_at),
      }
      const detail: OrderDetail = {
        ...mapOrderSummary(r),
        lines: ((r.order_lines as Row[]) ?? [])
          .sort((a, b) => n(a.position) - n(b.position))
          .map(
            (l): OrderLine => ({
              id: String(l.id),
              variantId: s(l.variant_id),
              productName: String(l.product_name),
              variantName: String(l.variant_name),
              sku: s(l.sku),
              quantity: n(l.quantity),
              returnedQuantity: n(l.returned_quantity),
              unitPriceMinor: n(l.unit_price_minor),
              currency: String(l.currency),
              taxRateBps: n(l.tax_rate_bps),
              discountMinor: n(l.discount_minor),
              subtotalMinor: n(l.subtotal_minor),
              taxMinor: n(l.tax_minor),
              totalMinor: n(l.total_minor),
            }),
          ),
        payments: ((r.payments as Row[]) ?? []).map((p) => mapPayment({ ...p, orders: { number: r.number } })),
        refunds: ((r.refunds as Row[]) ?? []).map((x) => mapRefund({ ...x, orders: { number: r.number } })),
        fulfilment,
        history: ((r.order_status_history as Row[]) ?? [])
          .sort((a, b) => n(a.id) - n(b.id))
          .map((h) => ({
            fromStatus: (h.from_status as OrderStatus | null) ?? null,
            toStatus: h.to_status as OrderStatus,
            note: s(h.note),
            createdAt: String(h.created_at),
          })),
      }
      return detail
    },
    async createOrder(orgId, input, idempotencyKey) {
      return check(
        await sb.rpc('create_order', {
          p_org: orgId,
          p_idempotency_key: idempotencyKey,
          p_input: {
            status: input.status,
            channel: input.channel,
            customer_id: input.customerId,
            note: input.note,
            delivery_fee_minor: input.deliveryFeeMinor,
            fulfilment: {
              method: input.fulfilment.method,
              recipient_name: input.fulfilment.recipientName,
              recipient_phone: input.fulfilment.recipientPhone,
              address: input.fulfilment.address,
            },
            lines: input.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, discount_minor: l.discountMinor })),
          },
        }),
      ) as string
    },
    async transitionOrder(_orgId, orderId, to, note) {
      check(await sb.rpc('transition_order', { p_order: orderId, p_to: to, p_note: note }))
    },
    async updateFulfilment(_orgId, orderId, patch) {
      const p: Row = {}
      if (patch.method !== undefined) p.method = patch.method
      if (patch.recipientName !== undefined) p.recipient_name = patch.recipientName
      if (patch.recipientPhone !== undefined) p.recipient_phone = patch.recipientPhone
      if (patch.address !== undefined) p.address = patch.address
      if (patch.assignee !== undefined) p.assignee = patch.assignee
      if (patch.trackingRef !== undefined) p.tracking_ref = patch.trackingRef
      if (patch.proofOfDelivery !== undefined) p.proof_of_delivery = patch.proofOfDelivery
      check(await sb.rpc('update_fulfilment', { p_order: orderId, p_patch: p }))
    },
    async returnItems(_orgId, input, idempotencyKey) {
      check(
        await sb.rpc('return_order_items', {
          p_order: input.orderId,
          p_lines: input.lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })),
          p_note: input.note,
          p_idempotency_key: idempotencyKey,
        }),
      )
    },

    async listPayments(orgId) {
      const rows = check(
        await sb.from('payments').select('*, orders(number)').eq('org_id', orgId).order('received_at', { ascending: false }).limit(1000),
      ) as Row[]
      return rows.map(mapPayment)
    },
    async listRefunds(orgId) {
      const rows = check(
        await sb.from('refunds').select('*, orders(number)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1000),
      ) as Row[]
      return rows.map(mapRefund)
    },
    async recordManualPayment(_orgId, input, idempotencyKey) {
      return check(
        await sb.rpc('record_manual_payment', {
          p_order: input.orderId,
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_method: input.method,
          p_external_ref: input.externalRef,
          p_received_at: input.receivedAt,
          p_note: input.note,
          p_idempotency_key: idempotencyKey,
        }),
      ) as string
    },
    async reversePayment(_orgId, paymentId, reason) {
      check(await sb.rpc('reverse_payment', { p_payment: paymentId, p_reason: reason }))
    },
    async recordRefund(_orgId, input, idempotencyKey) {
      return check(
        await sb.rpc('record_refund', {
          p_payment: input.paymentId,
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_reason: input.reason,
          p_idempotency_key: idempotencyKey,
        }),
      ) as string
    },

    async listAudit(orgId, limit = 200) {
      const rows = check(
        await sb.from('audit_log').select('*').eq('org_id', orgId).order('id', { ascending: false }).limit(limit),
      ) as Row[]
      return rows.map(
        (r): AuditEntry => ({
          id: String(r.id),
          entity: String(r.entity),
          entityId: String(r.entity_id),
          action: String(r.action),
          actorId: s(r.actor_id),
          before: (r.before as Record<string, unknown>) ?? null,
          after: (r.after as Record<string, unknown>) ?? null,
          createdAt: String(r.created_at),
        }),
      )
    },
    async listIntegrations(orgId) {
      // Static capability list, upgraded by any verified connection state stored server-side.
      const rows = (check(await sb.from('integration_connections').select('*').eq('org_id', orgId)) as Row[]) ?? []
      return integrationStatuses().map((i) => {
        const row = rows.find((r) => r.provider === i.provider)
        if (!row) return i
        const state = String(row.state)
        return {
          ...i,
          label: state === 'connected_verified' ? 'connected_verified' : state === 'configured_unverified' ? 'configured_unverified' : i.label,
          lastTestedAt: s(row.last_tested_at),
        }
      })
    },

    async getShopSettings(orgId) {
      const row = check(await sb.from('shop_settings').select('*').eq('org_id', orgId).maybeSingle()) as Row | null
      return row ? mapShopSettings(row) : null
    },
    async saveShopSettings(orgId, settings) {
      check(await sb.rpc('save_shop_settings', { p_org: orgId, p_settings: shopSettingsPayload(settings) }))
      if (settings.trackingLinkDays != null) {
        check(await sb.rpc('set_tracking_link_days', { p_org: orgId, p_days: settings.trackingLinkDays }))
      }
    },
    async setProductMerchandising(orgId, productId, m) {
      check(
        await sb.rpc('set_product_merchandising', {
          p_org: orgId,
          p_product: productId,
          p_images: m.images.map((i) => (i.alt ? { url: i.url, alt: i.alt } : { url: i.url })),
          p_featured: m.featured,
          p_available_from: m.availableFrom,
        }),
      )
    },
    async setVariantMerchandising(orgId, variantId, m) {
      check(
        await sb.rpc('set_variant_merchandising', {
          p_org: orgId,
          p_variant: variantId,
          p_compare_at_minor: m.compareAtMinor,
          p_swatch: m.swatch,
        }),
      )
    },
    async uploadProductImage(orgId, image, opts) {
      const { data } = await sb.auth.getSession()
      const accessToken = data.session?.access_token
      if (!accessToken) throw new GatewayError('Sign in again to upload photos', 'unauthenticated')
      try {
        return await uploadProductImageToStorage({ baseUrl: url, anonKey, accessToken, orgId, image, opts })
      } catch (e) {
        if (e instanceof UploadError) throw new GatewayError(e.message, e.status === 0 ? 'network' : 'upload_failed')
        throw e
      }
    },
    async deleteProductImage(orgId, imageUrl) {
      // Only this org's own uploads; storage RLS (catalogue.write on the org folder) still decides.
      const path = productImagePathFromUrl(url, orgId, imageUrl)
      if (!path) return
      const { error } = await sb.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
      if (error) throw new GatewayError(error.message || 'The photo could not be removed', 'delete_failed')
    },

    ...createSupabaseCollections(sb),

    // Deposits, failed deliveries and handoff (delivery-supabase.ts).
    ...createSupabaseDeliveryAdmin(sb),
    ...createSupabaseTrust(sb),
    ...createSupabaseExpansion(sb),
  }
}
