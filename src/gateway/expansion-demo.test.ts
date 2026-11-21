import { beforeEach, describe, expect, it } from 'vitest'
import { parseImportCsv, toServerRows } from '@/domain/catalogue-import'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { createDemoStorefront } from './storefront-demo'

const gw = createDemoGateway()
const sf = createDemoStorefront()

async function orgOf(currency: string) {
  const org = (await gw.listOrganisations()).find((o) => o.baseCurrency === currency)
  if (!org) throw new Error(`seed missing ${currency} org`)
  return org
}

beforeEach(() => {
  resetDemoWorkspace()
})

const HEADER = 'name,description,category,variant name,sku,price,compare-at price,stock,image url'

describe('demo CSV import', () => {
  it('dry run changes nothing; real run creates products, variants and stock', async () => {
    const org = await orgOf('KES')
    const before = await gw.listProducts(org.id)
    const csv = [HEADER, 'Import Towel,Soft,Home,Blue,IMP-B,2500,3000,7,https://img.test/a.jpg', 'Import Towel,,,Red,IMP-R,2500,,3,', 'Import Mug,,,,,450,,,'].join('\n')
    const rows = toServerRows(parseImportCsv(csv, { currency: 'KES' }).rows)

    const dry = await gw.importProducts(org.id, rows, { onDuplicate: 'update', dryRun: true })
    expect(dry).toMatchObject({ ok: true, dryRun: true, createdProducts: 2, createdVariants: 3, updatedVariants: 0 })
    expect(await gw.listProducts(org.id)).toHaveLength(before.length)

    const real = await gw.importProducts(org.id, rows, { onDuplicate: 'update', dryRun: false })
    expect(real).toMatchObject({ ok: true, createdProducts: 2, createdVariants: 3 })
    const after = await gw.listProducts(org.id)
    const towel = after.find((p) => p.name === 'Import Towel')!
    expect(towel.variants.map((v) => v.name)).toEqual(['Blue', 'Red'])
    expect(towel.variants[0]).toMatchObject({ sku: 'IMP-B', priceMinor: 250000, compareAtMinor: 300000, onHand: 7 })
    expect(towel.images).toEqual([{ url: 'https://img.test/a.jpg' }])
    expect(towel.trackStock).toBe(true)
    expect(after.find((p) => p.name === 'Import Mug')!.trackStock).toBe(false)
  })

  it('updates or skips existing SKUs', async () => {
    const org = await orgOf('KES')
    const existing = (await gw.listProducts(org.id)).flatMap((p) => p.variants).find((v) => v.sku && v.reserved === 0 && v.compareAtMinor === null)!
    const csv = [HEADER, `Whatever,,,,${existing.sku},99,,5,`].join('\n')
    const rows = toServerRows(parseImportCsv(csv, { currency: 'KES' }).rows)

    const skip = await gw.importProducts(org.id, rows, { onDuplicate: 'skip', dryRun: false })
    expect(skip).toMatchObject({ ok: true, skipped: 1, updatedVariants: 0 })

    const upd = await gw.importProducts(org.id, rows, { onDuplicate: 'update', dryRun: false })
    expect(upd).toMatchObject({ ok: true, updatedVariants: 1, createdProducts: 0 })
    const v = (await gw.listProducts(org.id)).flatMap((p) => p.variants).find((x) => x.id === existing.id)!
    expect(v.priceMinor).toBe(9900)
  })

  it('rejects invalid rows with line numbers and writes nothing', async () => {
    const org = await orgOf('KES')
    const before = (await gw.listProducts(org.id)).length
    const bad = [{ line: 2, name: 'Ok', description: null, category: null, variant_name: null, sku: null, price_minor: 100, compare_at_minor: null, stock: null, image_url: null },
      { line: 3, name: '', description: null, category: null, variant_name: null, sku: null, price_minor: 100, compare_at_minor: 50, stock: null, image_url: 'http://x' }]
    const r = await gw.importProducts(org.id, bad, { onDuplicate: 'update', dryRun: false })
    expect(r.ok).toBe(false)
    expect(r.errors.every((e) => e.line === 3)).toBe(true)
    expect((await gw.listProducts(org.id)).length).toBe(before)
  })

  it('requires catalogue.write', async () => {
    const org = await orgOf('KES')
    __setDemoRole(org.id, 'sales')
    await expect(gw.importProducts(org.id, [], { onDuplicate: 'update', dryRun: true })).rejects.toThrow(/cannot edit products/)
  })
})

describe('demo shop extras', () => {
  it('validates and saves pixel IDs and exposes them to the storefront only', async () => {
    const org = await orgOf('KES')
    await expect(gw.saveTrackingIds(org.id, { metaPixelId: '12<script>', ga4Id: null })).rejects.toThrow(/digits/)
    await gw.saveTrackingIds(org.id, { metaPixelId: '123456789012345', ga4Id: 'g-abc1234' })
    expect(await gw.getShopExtras(org.id)).toMatchObject({ metaPixelId: '123456789012345', ga4Id: 'G-ABC1234' })
    const extras = await sf.getStorefrontExtras('mto-home')
    expect(extras).toMatchObject({ metaPixelId: '123456789012345', ga4Id: 'G-ABC1234', bankTransfer: { available: false } })
  })

  it('validates the KRA PIN and keeps bank transfer to NGN businesses', async () => {
    const org = await orgOf('KES')
    await expect(gw.saveKraPin(org.id, 'P12345')).rejects.toThrow(/KRA PIN/)
    await gw.saveKraPin(org.id, 'p051234567x')
    expect((await gw.getShopExtras(org.id)).kraPin).toBe('P051234567X')
    await expect(gw.setBankTransferProvider(org.id, 'paystack_dva')).rejects.toThrow(/NGN/)
    __setDemoRole(org.id, 'manager')
    await expect(gw.saveKraPin(org.id, null)).rejects.toThrow(/cannot change business settings/)
  })

  it('offers simulated bank transfer for an NGN shop with a provider', async () => {
    const id = await gw.createOrganisation({ name: 'Lagos Wears', countryCode: 'NG', timezone: 'Africa/Lagos', locale: 'en-NG', baseCurrency: 'NGN', businessType: null, taxMode: 'exclusive' })
    await gw.saveShopSettings(id, {
      slug: 'lagos-wears', published: true, tagline: null, about: null, coverUrl: null, logoUrl: null, whatsappE164: null, registeredName: null,
      locationLat: null, locationLng: null, locationLabel: null, pickupEnabled: true, deliveryEnabled: false, deliveryBands: [], deliveryPromise: null,
      codEnabled: false, mpesaTill: null, mpesaPaybill: null, returnPolicy: null,
    })
    expect((await sf.getStorefrontExtras('lagos-wears')).bankTransfer.available).toBe(false)
    await gw.setBankTransferProvider(id, 'paystack_dva')
    expect((await sf.getStorefrontExtras('lagos-wears')).bankTransfer).toEqual({ available: true, provider: 'paystack_dva', simulated: true })
  })
})

describe('demo custom domains', () => {
  it('stores a pending domain and resolves it only once verified', async () => {
    const org = await orgOf('KES')
    await expect(gw.setCustomDomain(org.id, 'http://')).rejects.toThrow()
    const d = await gw.setCustomDomain(org.id, 'https://Shop.MtoHome.co.ke/')
    expect(d).toMatchObject({ hostname: 'shop.mtohome.co.ke', status: 'pending_dns' })
    expect(d.verificationToken).toMatch(/^[a-f0-9]{32}$/)
    expect(await sf.resolveShopHost('shop.mtohome.co.ke')).toBeNull()
    await gw.simulateDomainCheck!(org.id, 'verified')
    expect(await sf.resolveShopHost('SHOP.mtohome.co.ke.')).toBe('mto-home')
    const lumen = await orgOf('EUR')
    await expect(gw.setCustomDomain(lumen.id, 'shop.mtohome.co.ke')).rejects.toThrow(/another shop/)
    await gw.removeCustomDomain(org.id)
    expect(await gw.getCustomDomain(org.id)).toBeNull()
  })

  it('"Check now" is simulated and labelled as such, owner/admin only, and rate-limited like the server', async () => {
    const org = await orgOf('KES')
    await expect(gw.checkCustomDomain(org.id)).rejects.toThrow(/Add a domain first/)
    await gw.setCustomDomain(org.id, 'shop.mtohome.co.ke')
    __setDemoRole(org.id, 'manager')
    await expect(gw.checkCustomDomain(org.id)).rejects.toThrow(/cannot/)
    __setDemoRole(org.id, 'owner')
    const r = await gw.checkCustomDomain(org.id)
    expect(r).toMatchObject({ status: 'verified', simulated: true })
    expect(await gw.getCustomDomain(org.id)).toMatchObject({ status: 'verified', lastCheckedAt: expect.any(String) })
    for (let i = 0; i < 4; i++) await gw.checkCustomDomain(org.id)
    await expect(gw.checkCustomDomain(org.id)).rejects.toThrow(/Too many attempts/)
  })
})

describe('demo team invites', () => {
  it('invites, previews, accepts once and lists', async () => {
    const org = await orgOf('KES')
    const { invite, token } = await gw.createInvite(org.id, { email: 'Rider@Shop.test', phoneE164: null, role: 'fulfilment' })
    expect(invite).toMatchObject({ email: 'rider@shop.test', role: 'fulfilment', status: 'pending' })
    const preview = await gw.previewInvite(token)
    expect(preview).toMatchObject({ orgName: org.name, role: 'fulfilment', contactHint: 'r***@shop.test', status: 'pending' })
    expect(await gw.acceptInvite(token)).toBe(org.id)
    await expect(gw.acceptInvite(token)).rejects.toThrow(/already used/)
    const members = await gw.listMembers(org.id)
    expect(members.some((m) => m.email === 'rider@shop.test' && m.role === 'fulfilment')).toBe(true)
    expect((await gw.listInvites(org.id))[0].status).toBe('accepted')
    await expect(gw.previewInvite('x'.repeat(43))).rejects.toThrow(/not found/)
  })

  it('a new invite to the same contact replaces the old link; revoke works', async () => {
    const org = await orgOf('KES')
    const first = await gw.createInvite(org.id, { email: null, phoneE164: '+254712000111', role: 'sales' })
    const second = await gw.createInvite(org.id, { email: null, phoneE164: '+254712000111', role: 'sales' })
    expect((await gw.previewInvite(first.token)).status).toBe('revoked')
    await gw.revokeInvite(org.id, second.invite.id)
    await expect(gw.acceptInvite(second.token)).rejects.toThrow(/revoked/)
  })

  it('only owners invite owners; staff cannot invite', async () => {
    const org = await orgOf('KES')
    __setDemoRole(org.id, 'admin')
    await expect(gw.createInvite(org.id, { email: 'boss@shop.test', phoneE164: null, role: 'owner' })).rejects.toThrow(/Only an owner/)
    await gw.createInvite(org.id, { email: 'cashier@shop.test', phoneE164: null, role: 'sales' })
    __setDemoRole(org.id, 'sales')
    await expect(gw.createInvite(org.id, { email: 'x@shop.test', phoneE164: null, role: 'sales' })).rejects.toThrow(/cannot manage the team/)
    await expect(gw.listInvites(org.id)).rejects.toThrow()
  })
})

describe('demo eTIMS invoices', () => {
  it('needs a KRA PIN, numbers invoices per org, is idempotent and matches the order total', async () => {
    const org = await orgOf('KES')
    const orders = (await gw.listOrders(org.id)).filter((o) => !['draft', 'cancelled'].includes(o.status))
    await expect(gw.issueTaxInvoice(org.id, orders[0].id, { pin: null, name: null })).rejects.toThrow(/KRA PIN/)
    await gw.saveKraPin(org.id, 'P051234567X')
    const a = await gw.issueTaxInvoice(org.id, orders[0].id, { pin: 'a123456789z', name: 'Acme Ltd' })
    const b = await gw.issueTaxInvoice(org.id, orders[1].id, { pin: null, name: null })
    expect([a.invoiceNumber, b.invoiceNumber]).toEqual([1, 2])
    expect(a).toMatchObject({ sellerPin: 'P051234567X', buyerPin: 'A123456789Z', buyerName: 'Acme Ltd', kraStatus: 'not_submitted' })
    expect(a.netMinor + a.taxMinor + a.deliveryMinor).toBe(a.totalMinor)
    expect(a.totalMinor).toBe(orders[0].totalMinor)
    const again = await gw.issueTaxInvoice(org.id, orders[0].id, { pin: null, name: 'Changed' })
    expect(again).toMatchObject({ id: a.id, invoiceNumber: 1, buyerName: 'Acme Ltd' })
    expect((await gw.listTaxInvoices(org.id)).map((i) => i.invoiceNumber)).toEqual([2, 1])
    expect((await gw.getShopExtras(org.id)).nextInvoiceNumber).toBe(3)
  })

  it('refuses drafts and cancelled orders, and bad buyer PINs', async () => {
    const org = await orgOf('KES')
    await gw.saveKraPin(org.id, 'P051234567X')
    const orders = await gw.listOrders(org.id)
    const draft = orders.find((o) => o.status === 'draft')!
    await expect(gw.issueTaxInvoice(org.id, draft.id, { pin: null, name: null })).rejects.toThrow(/confirmed orders/)
    const ok = orders.find((o) => o.status === 'delivered')!
    await expect(gw.issueTaxInvoice(org.id, ok.id, { pin: 'nope', name: null })).rejects.toThrow(/Buyer KRA PIN/)
  })
})
