/**
 * Demo implementation of the parity/expansion contract on the browser-local
 * demo state. Same rules as the database functions in
 * supabase/migrations/20261120000050_parity_and_expansion.sql. Simulated parts
 * (invite acceptance, DNS checks, bank-transfer availability) are labelled as such.
 */
import { validateServerRows, type DuplicateMode, type ServerImportRow } from '@/domain/catalogue-import'
import { normaliseGa4Id, normaliseMetaPixelId } from '@/domain/tracking'
import { effectiveInviteStatus, generateInviteToken, hashInviteToken, inviteExpiry } from '@/domain/team-invites'
import { normaliseHostname } from '@/domain/custom-domain'
import { BANK_TRANSFER_PROVIDERS, bankTransferEligible, type BankTransferProviderId } from '@/domain/bank-transfer'
import { invoiceLine, invoiceTotals, normaliseKraPin, type TaxInvoiceRecord } from '@/domain/etims'
import type { Role } from '@/domain/permissions'
import { GatewayError } from './gateway'
import type { demoInternals as DemoInternalsValue, DemoState } from './demo'
import type { CustomDomain, ExpansionAdminGateway, ImportResult, ShopExtras, StorefrontExtrasGateway, TeamInvite } from './expansion'

type Internals = typeof DemoInternalsValue

interface StoredExtras {
  metaPixelId: string | null
  ga4Id: string | null
  kraPin: string | null
  bankTransferProvider: BankTransferProviderId
  nextInvoiceNumber: number
}
export interface StoredInvite extends Omit<TeamInvite, 'status'> {
  orgId: string
  tokenHash: string
  status: 'pending' | 'accepted' | 'revoked'
}
export interface StoredTaxInvoice extends Omit<TaxInvoiceRecord, 'orderNumber'> {
  orgId: string
}

/** Optional so older saved demo states stay valid. */
export interface DemoExpansionState {
  shopExtras?: Record<string, StoredExtras>
  teamInvites?: StoredInvite[]
  customDomains?: Record<string, CustomDomain>
  taxInvoices?: StoredTaxInvoice[]
}

const DEFAULT_EXTRAS: StoredExtras = { metaPixelId: null, ga4Id: null, kraPin: null, bankTransferProvider: 'none', nextInvoiceNumber: 1 }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const E164_RE = /^\+[1-9][0-9]{6,14}$/

function fail(message: string, code?: string): never {
  throw new GatewayError(message, code)
}

function extrasOf(s: DemoState, orgId: string): StoredExtras {
  s.shopExtras ??= {}
  s.shopExtras[orgId] ??= { ...DEFAULT_EXTRAS }
  return s.shopExtras[orgId]
}

function publicInvite(i: StoredInvite, now: Date): TeamInvite {
  const { orgId: _o, tokenHash: _t, ...rest } = i
  void _o
  void _t
  return { ...rest, status: effectiveInviteStatus(i.status, i.expiresAt, now) }
}

function publicInvoice(s: DemoState, inv: StoredTaxInvoice): TaxInvoiceRecord {
  const { orgId: _o, ...rest } = inv
  void _o
  return { ...rest, orderNumber: s.orders.find((o) => o.id === inv.orderId)?.number ?? null }
}

interface ImportCounts {
  createdProducts: number
  createdVariants: number
  updatedVariants: number
  skipped: number
}

/** Apply validated rows (mirrors step 2 of import_products). Throws on the first failure; `onLine` tracks progress. */
function applyImport(I: Internals, s: DemoState, orgId: string, rows: ServerImportRow[], mode: DuplicateMode, onLine: (line: number) => void): ImportCounts {
  I.requirePermission(s, orgId, 'catalogue.write')
  const counts: ImportCounts = { createdProducts: 0, createdVariants: 0, updatedVariants: 0, skipped: 0 }
  const created = new Map<string, string>() // lower(name) -> product id
  for (const r of rows) {
    onLine(r.line)
    const sku = r.sku?.trim() || null
    const existing = sku ? s.variants.find((v) => v.orgId === orgId && v.sku?.toLowerCase() === sku.toLowerCase()) : undefined
    let productId: string
    if (existing) {
      if (mode === 'skip') {
        counts.skipped++
        continue
      }
      existing.priceMinor = r.price_minor as number
      existing.compareAtMinor = r.compare_at_minor ?? null
      if (r.variant_name?.trim()) existing.name = r.variant_name.trim()
      existing.updatedAt = I.nowIso()
      const product = s.products.find((p) => p.id === existing.productId) ?? fail('Product not found', 'not_found')
      if (r.description?.trim()) product.description = r.description.trim()
      if (r.category?.trim()) product.category = r.category.trim()
      productId = product.id
      if (r.stock !== null && r.stock !== undefined && product.trackStock) {
        const lvl = I.level(s, existing.id)
        if (r.stock < lvl.reserved) fail(`Stock ${r.stock} is below the ${lvl.reserved} already reserved for open orders`, 'invalid')
        if (r.stock !== lvl.onHand) {
          I.adjustStock(s, orgId, { variantId: existing.id, delta: r.stock - lvl.onHand, reason: 'stock_count', note: 'CSV import' }, I.uuid())
        }
      }
      I.writeAudit(s, orgId, 'product_variants', existing.id, 'csv_import_update', null, { priceMinor: existing.priceMinor })
      counts.updatedVariants++
    } else {
      const key = r.name.trim().toLowerCase()
      const variantInput = { name: r.variant_name?.trim() || 'Default', sku, priceMinor: r.price_minor as number, lowStockThreshold: 3, isActive: true }
      const known = created.get(key)
      if (!known) {
        const trackStock = rows.some((x) => x.name.trim().toLowerCase() === key && x.stock !== null && x.stock !== undefined)
        productId = I.saveProduct(s, orgId, {
          name: r.name.trim(),
          description: r.description,
          category: r.category,
          status: 'active',
          trackStock,
          taxRateBps: 0,
          taxCode: null,
          variants: [variantInput],
        })
        created.set(key, productId)
        counts.createdProducts++
      } else {
        productId = known
        const product = s.products.find((p) => p.id === known) ?? fail('Product not found', 'not_found')
        const current = s.variants
          .filter((v) => v.productId === known)
          .sort((a, b) => a.position - b.position)
          .map((v) => ({ id: v.id, name: v.name, sku: v.sku, priceMinor: v.priceMinor, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive }))
        I.saveProduct(s, orgId, {
          id: known,
          name: product.name,
          description: product.description,
          category: product.category,
          status: product.status,
          trackStock: product.trackStock,
          taxRateBps: product.taxRateBps,
          taxCode: product.taxCode,
          variants: [...current, variantInput],
        })
      }
      const variant =
        s.variants.filter((v) => v.productId === productId).sort((a, b) => b.position - a.position)[0] ?? fail('Variant not created', 'invalid')
      if (r.compare_at_minor !== null && r.compare_at_minor !== undefined) {
        I.setVariantMerchandising(s, orgId, variant.id, { compareAtMinor: r.compare_at_minor, swatch: variant.swatch })
      }
      if (r.stock) I.adjustStock(s, orgId, { variantId: variant.id, delta: r.stock, reason: 'received_from_supplier', note: 'CSV import' }, I.uuid())
      counts.createdVariants++
    }
    if (r.image_url) {
      const product = s.products.find((p) => p.id === productId)
      if (product && product.images.length < 12 && !product.images.some((i) => i.url === r.image_url)) product.images.push({ url: r.image_url })
    }
  }
  return counts
}

export function createDemoExpansion(I: Internals): ExpansionAdminGateway {
  const { tx, read } = I
  return {
    async importProducts(orgId, rows, opts): Promise<ImportResult> {
      const base = { dryRun: opts.dryRun, createdProducts: 0, createdVariants: 0, updatedVariants: 0, skipped: 0 }
      if (opts.onDuplicate !== 'update' && opts.onDuplicate !== 'skip') fail('Choose whether to update or skip existing SKUs', 'invalid')
      const errors = await read((s) => {
        I.requirePermission(s, orgId, 'catalogue.write')
        return validateServerRows(rows)
      })
      if (errors.length > 0) return { ok: false, ...base, errors }
      let line = 0
      const run = (s: DemoState) => applyImport(I, s, orgId, rows, opts.onDuplicate, (l) => (line = l))
      try {
        // A dry run uses read(): the state copy is thrown away, so nothing is saved.
        const counts = opts.dryRun ? await read(run) : await tx(run)
        return { ok: true, dryRun: opts.dryRun, ...counts, errors: [] }
      } catch (e) {
        return { ok: false, ...base, errors: [{ line, message: e instanceof Error ? e.message : 'Import failed' }] }
      }
    },

    getShopExtras: (orgId) =>
      read((s): ShopExtras => {
        I.requireMember(s, orgId)
        return { ...(s.shopExtras?.[orgId] ?? DEFAULT_EXTRAS) }
      }),
    saveTrackingIds: (orgId, ids) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        const pixel = normaliseMetaPixelId(ids.metaPixelId)
        if (!pixel.ok) fail(pixel.error, 'invalid')
        const ga4 = normaliseGa4Id(ids.ga4Id)
        if (!ga4.ok) fail(ga4.error, 'invalid')
        const x = extrasOf(s, orgId)
        x.metaPixelId = pixel.value
        x.ga4Id = ga4.value
        I.writeAudit(s, orgId, 'shop_extras', orgId, 'tracking_ids', null, { metaPixelId: pixel.value, ga4Id: ga4.value })
      }),
    saveKraPin: (orgId, pin) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        const r = normaliseKraPin(pin)
        if (!r.ok) fail(r.error, 'invalid')
        extrasOf(s, orgId).kraPin = r.value
        I.writeAudit(s, orgId, 'shop_extras', orgId, 'kra_pin', null, { kraPin: r.value })
      }),
    setBankTransferProvider: (orgId, provider) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'integrations.manage')
        if (!BANK_TRANSFER_PROVIDERS.includes(provider)) fail('Choose Paystack, Flutterwave or none', 'invalid')
        if (provider !== 'none' && !bankTransferEligible(I.getOrg(s, orgId).baseCurrency)) {
          fail('Bank-transfer virtual accounts are only available for NGN businesses', 'invalid')
        }
        extrasOf(s, orgId).bankTransferProvider = provider
      }),

    getCustomDomain: (orgId) =>
      read((s) => {
        I.requireMember(s, orgId)
        const d = s.customDomains?.[orgId]
        return d ? { ...d } : null
      }),
    setCustomDomain: (orgId, hostname) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        const h = normaliseHostname(hostname)
        if (!h.ok) fail(h.error, 'invalid')
        if (!s.shopSettings.some((x) => x.orgId === orgId)) fail('Set up your shop link first (My shop)', 'invalid')
        s.customDomains ??= {}
        if (Object.entries(s.customDomains).some(([o, d]) => o !== orgId && d.hostname === h.hostname)) {
          fail('That domain is already connected to another shop', 'conflict')
        }
        const buf = new Uint8Array(16)
        crypto.getRandomValues(buf)
        const d: CustomDomain = {
          hostname: h.hostname,
          status: 'pending_dns',
          verificationToken: Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(''),
          failureReason: null,
          lastCheckedAt: null,
          verifiedAt: null,
          createdAt: I.nowIso(),
        }
        s.customDomains[orgId] = d
        I.writeAudit(s, orgId, 'custom_domains', orgId, 'insert', null, { hostname: d.hostname })
        return { ...d }
      }),
    removeCustomDomain: (orgId) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        if (s.customDomains) delete s.customDomains[orgId]
      }),
    simulateDomainCheck: (orgId, outcome) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'org.manage')
        const d = s.customDomains?.[orgId] ?? fail('Add a domain first', 'not_found')
        d.status = outcome
        d.lastCheckedAt = I.nowIso()
        d.verifiedAt = outcome === 'verified' ? d.lastCheckedAt : null
        d.failureReason = outcome === 'failed' ? 'Simulated: the CNAME/A record was not found' : null
      }),

    listInvites: (orgId) =>
      read((s) => {
        I.requirePermission(s, orgId, 'team.manage')
        const now = I.now()
        return (s.teamInvites ?? [])
          .filter((i) => i.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((i) => publicInvite(i, now))
      }),
    async createInvite(orgId, input) {
      const token = generateInviteToken()
      const tokenHash = await hashInviteToken(token)
      return tx((s) => {
        const actor = I.requirePermission(s, orgId, 'team.manage')
        if (input.role === 'owner' && actor !== 'owner') fail('Only an owner can invite another owner', 'forbidden')
        const email = input.email?.trim().toLowerCase() || null
        const phone = input.phoneE164?.trim() || null
        if ((email === null) === (phone === null)) fail('Invite by email or by phone number', 'invalid')
        if (email && !EMAIL_RE.test(email)) fail('Enter a valid email address', 'invalid')
        if (phone && !E164_RE.test(phone)) fail('Enter the phone number with its country code', 'invalid')
        if (email && s.members.some((m) => m.orgId === orgId && m.email?.toLowerCase() === email)) fail('That person is already on the team', 'conflict')
        s.teamInvites ??= []
        const nowIso = I.nowIso()
        const open = s.teamInvites.filter((i) => i.orgId === orgId && i.status === 'pending' && i.expiresAt > nowIso)
        if (open.length >= 50) fail('Too many open invitations. Revoke some first.', 'limit')
        for (const i of open) if ((email && i.email === email) || (phone && i.phoneE164 === phone)) i.status = 'revoked'
        const invite: StoredInvite = {
          id: I.uuid(),
          orgId,
          email,
          phoneE164: phone,
          role: input.role,
          tokenHash,
          status: 'pending',
          createdAt: nowIso,
          expiresAt: inviteExpiry(I.now()),
          acceptedAt: null,
        }
        s.teamInvites.push(invite)
        I.writeAudit(s, orgId, 'team_invites', invite.id, 'insert', null, { role: invite.role, email, phone })
        return { invite: publicInvite(invite, I.now()), token }
      })
    },
    revokeInvite: (orgId, inviteId) =>
      tx((s) => {
        const actor = I.requirePermission(s, orgId, 'team.manage')
        const i = (s.teamInvites ?? []).find((x) => x.id === inviteId && x.orgId === orgId) ?? fail('Invitation not found', 'not_found')
        if (i.role === 'owner' && actor !== 'owner') fail('Only an owner can revoke an owner invitation', 'forbidden')
        if (i.status !== 'pending') fail('This invitation is no longer open', 'invalid')
        i.status = 'revoked'
      }),
    async previewInvite(token) {
      const hash = await hashInviteToken(token)
      return read((s) => {
        const i = (s.teamInvites ?? []).find((x) => x.tokenHash === hash) ?? fail('Invitation not found', 'not_found')
        return {
          orgName: I.getOrg(s, i.orgId).name,
          role: i.role,
          status: effectiveInviteStatus(i.status, i.expiresAt, I.now()),
          expiresAt: i.expiresAt,
          contactKind: i.email ? ('email' as const) : ('phone' as const),
          contactHint: i.email ? `${i.email.slice(0, 1)}***@${i.email.split('@')[1]}` : `***${(i.phoneE164 ?? '').slice(-3)}`,
        }
      })
    },
    /** SIMULATED: the demo has one signed-in user, so accepting adds the invited person as a fictional teammate. */
    async acceptInvite(token) {
      const hash = await hashInviteToken(token)
      return tx((s) => {
        const i = (s.teamInvites ?? []).find((x) => x.tokenHash === hash) ?? fail('Invitation not found', 'not_found')
        acceptStored(I, s, i)
        return i.orgId
      })
    },
    simulateInviteAcceptance: (orgId, inviteId) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'team.manage')
        const i = (s.teamInvites ?? []).find((x) => x.id === inviteId && x.orgId === orgId) ?? fail('Invitation not found', 'not_found')
        acceptStored(I, s, i)
      }),

    issueTaxInvoice: (orgId, orderId, buyer) =>
      tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        s.taxInvoices ??= []
        const existing = s.taxInvoices.find((x) => x.orgId === orgId && x.orderId === orderId)
        if (existing) return publicInvoice(s, existing)
        const order = I.orderDetail(s, orgId, orderId)
        if (order.status === 'draft' || order.status === 'cancelled') fail('Invoices can only be issued for confirmed orders', 'invalid')
        const pin = normaliseKraPin(buyer.pin)
        if (!pin.ok) fail('Buyer KRA PIN must be a letter, 9 digits and a letter', 'invalid')
        const x = extrasOf(s, orgId)
        if (!x.kraPin) fail('Add your KRA PIN in Selling tools before issuing tax invoices', 'invalid')
        const org = I.getOrg(s, orgId)
        const lines = order.lines.map((l) => invoiceLine(l, order.taxMode))
        const totals = invoiceTotals(lines, order.deliveryFeeMinor)
        const inv: StoredTaxInvoice = {
          id: I.uuid(),
          orgId,
          orderId,
          invoiceNumber: x.nextInvoiceNumber,
          sellerName: org.legalName ?? org.name,
          sellerPin: x.kraPin,
          buyerPin: pin.value,
          buyerName: buyer.name?.trim() || order.customerName,
          currency: order.currency,
          taxMode: order.taxMode,
          lines,
          netMinor: totals.netMinor,
          taxMinor: totals.taxMinor,
          deliveryMinor: totals.deliveryMinor,
          totalMinor: order.totalMinor,
          issuedAt: I.nowIso(),
          kraStatus: 'not_submitted',
        }
        x.nextInvoiceNumber++
        s.taxInvoices.push(inv)
        I.writeAudit(s, orgId, 'tax_invoices', inv.id, 'insert', null, { invoiceNumber: inv.invoiceNumber, orderId })
        return publicInvoice(s, inv)
      }),
    getTaxInvoice: (orgId, orderId) =>
      read((s) => {
        I.requireMember(s, orgId)
        const inv = (s.taxInvoices ?? []).find((x) => x.orgId === orgId && x.orderId === orderId)
        return inv ? publicInvoice(s, inv) : null
      }),
    listTaxInvoices: (orgId) =>
      read((s) => {
        I.requireMember(s, orgId)
        return (s.taxInvoices ?? [])
          .filter((x) => x.orgId === orgId)
          .sort((a, b) => b.invoiceNumber - a.invoiceNumber)
          .map((x) => publicInvoice(s, x))
      }),
  }
}

function acceptStored(I: Internals, s: DemoState, i: StoredInvite): void {
  if (i.status !== 'pending') fail('This invitation was already used or revoked', 'invalid')
  if (i.expiresAt <= I.nowIso()) fail('This invitation has expired. Ask for a new one.', 'invalid')
  const label = i.email ?? i.phoneE164 ?? 'Teammate'
  s.members.push({
    orgId: i.orgId,
    userId: `demo-invitee-${i.id.slice(0, 8)}`,
    email: i.email,
    displayName: i.email ? i.email.split('@')[0] : `Teammate ${label.slice(-3)}`,
    role: i.role as Role,
    createdAt: I.nowIso(),
  })
  i.status = 'accepted'
  i.acceptedAt = I.nowIso()
  I.writeAudit(s, i.orgId, 'memberships', i.id, 'invite_accepted', null, { role: i.role })
}

export function createDemoStorefrontExtras(I: Internals): StorefrontExtrasGateway {
  const shopBySlug = (s: DemoState, slug: string) => s.shopSettings.find((x) => x.slug === String(slug ?? '').toLowerCase() && x.published)
  return {
    getStorefrontExtras: (slug) =>
      I.read((s) => {
        const shop = shopBySlug(s, slug) ?? fail('Shop not found', 'not_found')
        const x = s.shopExtras?.[shop.orgId] ?? DEFAULT_EXTRAS
        const currency = I.getOrg(s, shop.orgId).baseCurrency
        return {
          metaPixelId: x.metaPixelId,
          ga4Id: x.ga4Id,
          // SIMULATED: no provider is connected in the demo; an NGN shop with a provider chosen shows the option.
          bankTransfer: { available: currency === 'NGN' && x.bankTransferProvider !== 'none', provider: x.bankTransferProvider, simulated: true },
        }
      }),
    resolveShopHost: (hostname) =>
      I.read((s) => {
        const h = String(hostname ?? '').toLowerCase().replace(/\.$/, '')
        const entry = Object.entries(s.customDomains ?? {}).find(([, d]) => d.hostname === h && d.status === 'verified')
        if (!entry) return null
        return s.shopSettings.find((x) => x.orgId === entry[0] && x.published)?.slug ?? null
      }),
  }
}
