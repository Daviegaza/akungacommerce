import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setDemoRole, createDemoGateway, resetDemoWorkspace } from './demo'
import { newIdempotencyKey } from './gateway'
import { createDemoStorefront } from './storefront-demo'
import type { PlaceOrderInput } from './storefront'

const gw = createDemoGateway()
const sf = createDemoStorefront()
let clock = Date.parse('2026-11-20T09:00:00Z')

function advance(ms: number) {
  clock += ms
  vi.setSystemTime(clock)
}

async function mto() {
  const org = (await gw.listOrganisations()).find((o) => o.baseCurrency === 'KES')
  if (!org) throw new Error('seed missing KES org')
  return org
}

let phoneSeq = 300
async function placeOrder(opts: { optIn?: boolean; phone?: string } = {}) {
  const data = await sf.getStorefront('mto-home')
  const v = data.products.find((p) => p.name === 'Soy Candle 200 g')!.variants[0]
  phoneSeq += 1
  const input: PlaceOrderInput = {
    lines: [{ variantId: v.id, quantity: 1 }],
    method: 'pickup',
    name: 'Wanjiru Buyer',
    phoneE164: opts.phone ?? `+254799100${phoneSeq}`,
    payment: 'mpesa',
    marketingOptIn: opts.optIn ?? false,
  }
  return { placed: await sf.placeOrder('mto-home', input, newIdempotencyKey()), phone: input.phoneE164 }
}

function pdf(name = 'cert.pdf', size = 2000) {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  resetDemoWorkspace()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('checkout consent (demo)', () => {
  it('records opt-in with a timestamp and source, and never switches consent off at checkout', async () => {
    const org = await mto()
    const { phone } = await placeOrder({ optIn: true })
    let c = (await gw.listCustomers(org.id)).find((x) => x.phoneE164 === phone)!
    expect(c.marketingConsent).toBe(true)
    expect(c.consentSource).toBe('checkout')
    expect(c.consentUpdatedAt).toBe(new Date(clock).toISOString())

    advance(60_000)
    await placeOrder({ optIn: false, phone })
    c = (await gw.listCustomers(org.id)).find((x) => x.phoneE164 === phone)!
    expect(c.marketingConsent).toBe(true)
    expect(c.consentUpdatedAt).toBe(new Date(clock - 60_000).toISOString())
  })

  it('a box left unticked stores no consent', async () => {
    const org = await mto()
    const { phone } = await placeOrder()
    const c = (await gw.listCustomers(org.id)).find((x) => x.phoneE164 === phone)!
    expect(c).toMatchObject({ marketingConsent: false, consentUpdatedAt: null, consentSource: null })
  })

  it('the buyer can stop offers from their tracking link; staff edits do not move the timestamp', async () => {
    const org = await mto()
    const { placed, phone } = await placeOrder({ optIn: true })
    advance(1000)
    await sf.optOutOfMarketing(placed.trackingToken)
    const c = (await gw.listCustomers(org.id)).find((x) => x.phoneE164 === phone)!
    expect(c).toMatchObject({ marketingConsent: false, consentSource: 'buyer_link' })
    const stamp = c.consentUpdatedAt
    advance(1000)
    await gw.saveCustomer(org.id, { ...c, notes: 'Prefers mornings' })
    const again = (await gw.listCustomers(org.id)).find((x) => x.id === c.id)!
    expect(again.consentUpdatedAt).toBe(stamp)
  })
})

describe('customer export and re-engagement (demo)', () => {
  it('exports server-computed rows for managers and refuses sales staff', async () => {
    const org = await mto()
    const rows = await gw.exportCustomers(org.id)
    const amina = rows.find((r) => r.name === 'Amina Wekesa')!
    expect(amina.orderCount).toBe(2)
    expect(amina.spent[0].currency).toBe('KES')
    expect(amina.marketingConsent).toBe(true)
    expect(amina.consentSource).toBe('staff')
    expect((await gw.listAudit(org.id)).some((a) => a.entity === 'customers' && a.action === 'export')).toBe(true)

    __setDemoRole(org.id, 'sales')
    await expect(gw.exportCustomers(org.id)).rejects.toThrow(/owners, admins and managers/)
  })

  it('refuses marketing chats for customers who did not agree, and enforces the 7-day gap', async () => {
    const org = await mto()
    const customers = await gw.listCustomers(org.id)
    const kevin = customers.find((c) => c.name === 'Kevin Mutua')!
    const amina = customers.find((c) => c.name === 'Amina Wekesa')!
    expect(kevin.marketingConsent).toBe(false)
    await expect(gw.startMarketingChat(org.id, kevin.id, 'recent')).rejects.toThrow(/not agreed to offers/)

    await expect(gw.startMarketingChat(org.id, amina.id, 'recent')).resolves.toEqual({ phoneE164: amina.phoneE164 })
    await expect(gw.startMarketingChat(org.id, amina.id, 'lapsed')).rejects.toThrow(/last 7 days/)
    expect((await gw.listMarketingContacts(org.id)).map((c) => c.customerId)).toEqual([amina.id])

    advance(7 * 86_400_000 + 1000)
    await expect(gw.startMarketingChat(org.id, amina.id, 'recent')).resolves.toBeTruthy()
  })

  it('records an opt-out (replied STOP) and then blocks offers', async () => {
    const org = await mto()
    const amina = (await gw.listCustomers(org.id)).find((c) => c.name === 'Amina Wekesa')!
    await gw.optOutCustomer(org.id, amina.id, 'stop_reply')
    const after = (await gw.listCustomers(org.id)).find((c) => c.id === amina.id)!
    expect(after).toMatchObject({ marketingConsent: false, consentSource: 'stop_reply' })
    await expect(gw.startMarketingChat(org.id, amina.id, 'recent')).rejects.toThrow(/not agreed/)

    __setDemoRole(org.id, 'analyst')
    await expect(gw.optOutCustomer(org.id, amina.id, 'staff')).rejects.toThrow(/cannot edit customers/)
  })
})

describe('verification and buyer proof (demo)', () => {
  it('a new shop shows no badges, its age and a hidden-below-5 order count', async () => {
    const trust = await sf.getShopTrust('mto-home')
    expect(trust.phoneVerified).toBe(false)
    expect(trust.mpesaName).toBeNull()
    expect(trust.documentsApproved).toBe(false)
    expect(trust.onRafuSince).toMatch(/^\d{4}-/)
    expect(trust.completedOrders === null || trust.completedOrders >= 5).toBe(true)
  })

  it('phone badge needs a confirmed code for the shop’s own WhatsApp number', async () => {
    const org = await mto()
    const shop = (await gw.getShopSettings(org.id))!
    const phone = shop.whatsappE164!
    const { simulatedCode } = await gw.requestPhoneCode(org.id, phone)
    expect(simulatedCode).toMatch(/^\d{6}$/)
    await expect(gw.confirmPhoneCode(org.id, phone, '000000' === simulatedCode ? '111111' : '000000')).rejects.toThrow(/not right/)
    await gw.confirmPhoneCode(org.id, phone, simulatedCode!)
    expect((await gw.getShopVerification(org.id)).phone.verified).toBe(true)
    expect((await sf.getShopTrust('mto-home')).phoneVerified).toBe(true)

    // Changing the shop's number removes the badge until the new number is verified.
    await gw.saveShopSettings(org.id, { ...shop, whatsappE164: '+254700999888' })
    expect((await sf.getShopTrust('mto-home')).phoneVerified).toBe(false)
  })

  it('codes expire after 10 minutes', async () => {
    const org = await mto()
    const phone = (await gw.getShopSettings(org.id))!.whatsappE164!
    const { simulatedCode } = await gw.requestPhoneCode(org.id, phone)
    advance(11 * 60_000)
    await expect(gw.confirmPhoneCode(org.id, phone, simulatedCode!)).rejects.toThrow(/expired/)
  })

  it('M-Pesa name badge only when the reported name matches the registered name', async () => {
    const org = await mto()
    const shop = (await gw.getShopSettings(org.id))!
    await gw.simulateMpesaNameReport!(org.id, 'SOMEONE ELSE TRADERS')
    let v = await gw.getShopVerification(org.id)
    expect(v.mpesaName).toMatchObject({ matched: false, reportedName: 'SOMEONE ELSE TRADERS' })
    expect((await sf.getShopTrust('mto-home')).mpesaName).toBeNull()

    await gw.simulateMpesaNameReport!(org.id, `${shop.mpesaTill ?? shop.mpesaPaybill} - ${shop.registeredName!.toUpperCase()}`)
    v = await gw.getShopVerification(org.id)
    expect(v.mpesaName.matched).toBe(true)
    expect((await sf.getShopTrust('mto-home')).mpesaName).toBe(shop.registeredName!.toUpperCase())
  })

  it('documents need a reviewer: submitted shows nothing to buyers; approved shows the badge; rejected needs a reason', async () => {
    const org = await mto()
    await expect(gw.submitVerificationDocuments(org.id, { kind: 'kra_pin', files: [] })).rejects.toThrow(/between 1 and 5/)
    await expect(
      gw.submitVerificationDocuments(org.id, { kind: 'kra_pin', files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })] }),
    ).rejects.toThrow(/PDF, JPG/)
    await gw.submitVerificationDocuments(org.id, { kind: 'business_registration', files: [pdf()] })
    expect((await gw.getShopVerification(org.id)).documents.status).toBe('submitted')
    expect((await sf.getShopTrust('mto-home')).documentsApproved).toBe(false)

    const queue = await gw.listVerificationQueue()
    expect(queue.map((q) => q.orgId)).toContain(org.id)
    await expect(gw.reviewVerificationDocuments(org.id, 'rejected', '  ')).rejects.toThrow(/Say why/)
    await gw.reviewVerificationDocuments(org.id, 'approved', null)
    expect((await sf.getShopTrust('mto-home')).documentsApproved).toBe(true)
    await expect(gw.reviewVerificationDocuments(org.id, 'approved', null)).rejects.toThrow(/Nothing is waiting/)
  })

  it('only owners and admins can submit documents', async () => {
    const org = await mto()
    __setDemoRole(org.id, 'manager')
    await expect(gw.submitVerificationDocuments(org.id, { kind: 'kra_pin', files: [pdf()] })).rejects.toThrow(/cannot change business settings/)
  })

  it('reports are anonymous, need a reason, are rate-limited and reach the review queue', async () => {
    await expect(sf.reportShop('mto-home', { reason: 'other', details: '  ' })).rejects.toThrow(/what happened/)
    await sf.reportShop('mto-home', { reason: 'not_as_described', details: 'Colour was different' })
    await sf.reportShop('mto-home', { reason: 'not_delivered', details: null })
    await expect(sf.reportShop('mto-home', { reason: 'fake_shop', details: null })).rejects.toThrow(/Too many/)
    const reports = await gw.listShopReports()
    expect(reports).toHaveLength(2)
    expect(Object.keys(reports[0]).sort()).toEqual(['businessName', 'createdAt', 'details', 'id', 'orgId', 'reason', 'slug', 'status'])
    await gw.resolveShopReport(reports[0].id, 'reviewed')
    await expect(gw.resolveShopReport(reports[0].id, 'dismissed')).rejects.toThrow(/already handled/)
  })

  it('shows a masked receipt only for M-Pesa-verified payments', async () => {
    const org = await mto()
    const { placed } = await placeOrder()
    expect(await sf.getPaymentReceipts(placed.trackingToken)).toEqual([])

    // A payment typed in by staff is never shown as a receipt.
    await gw.recordManualPayment(
      org.id,
      { orderId: placed.orderId, amountMinor: 100, currency: 'KES', method: 'mobile_money', externalRef: 'SJK4H7Q2P1', receivedAt: new Date(clock).toISOString(), note: null },
      newIdempotencyKey(),
    )
    expect(await sf.getPaymentReceipts(placed.trackingToken)).toEqual([])

    const r = await sf.requestMpesaPrompt(placed.trackingToken, '+254712345678', { simulate: 'success' })
    if (r.status !== 'prompt_sent') throw new Error('expected prompt')
    advance(6000)
    await sf.track(placed.trackingToken)
    const receipts = await sf.getPaymentReceipts(placed.trackingToken)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].receiptMasked).toMatch(/^[A-Z0-9]{3}•+[A-Z0-9]{2}$/)
    expect(receipts[0].paidToVerified).toBe(false)
    expect(receipts[0].paidToName).toBe((await gw.getShopSettings(org.id))!.registeredName)
  })
})
