import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoGateway, resetDemoWorkspace } from './demo'
import { newIdempotencyKey } from './gateway'
import { createDemoStorefront } from './storefront-demo'
import { SIM_DELAY_MS, SIM_LOST_RECEIPT_AFTER_MS } from './collections-demo'
import type { PlaceOrderInput } from './storefront'

const gw = createDemoGateway()
const sf = createDemoStorefront()
let clock = Date.parse('2026-11-20T09:00:00Z')
function advance(ms: number) {
  clock += ms
  vi.setSystemTime(clock)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  resetDemoWorkspace()
})
afterEach(() => {
  vi.useRealTimers()
})

async function lagosShop(provider: 'paystack_dva' | 'none' = 'paystack_dva') {
  const orgId = await gw.createOrganisation({
    name: 'Lagos Wears',
    countryCode: 'NG',
    timezone: 'Africa/Lagos',
    locale: 'en-NG',
    baseCurrency: 'NGN',
    businessType: null,
    taxMode: 'exclusive',
  })
  await gw.saveProduct(orgId, {
    name: 'Ankara Tote',
    description: null,
    category: null,
    status: 'active',
    trackStock: false,
    taxRateBps: 0,
    taxCode: null,
    variants: [{ name: 'Default', sku: 'TOTE-1', priceMinor: 2_450_000, lowStockThreshold: 0, isActive: true }],
  })
  await gw.saveShopSettings(orgId, {
    slug: 'lagos-wears', published: true, tagline: null, about: null, coverUrl: null, logoUrl: null, whatsappE164: null, registeredName: null,
    locationLat: null, locationLng: null, locationLabel: null, pickupEnabled: true, deliveryEnabled: false, deliveryBands: [], deliveryPromise: null,
    codEnabled: false, mpesaTill: null, mpesaPaybill: null, returnPolicy: null,
  })
  if (provider !== 'none') await gw.setBankTransferProvider(orgId, provider)
  return orgId
}

async function bankOrder() {
  const data = await sf.getStorefront('lagos-wears')
  const input: PlaceOrderInput = {
    lines: [{ variantId: data.products[0].variants[0].id, quantity: 1 }],
    method: 'pickup',
    name: 'Ada Obi',
    phoneE164: '+2348031234567',
    payment: 'bank_transfer',
    marketingOptIn: false,
  }
  return sf.placeOrder('lagos-wears', input, newIdempotencyKey())
}

describe('demo bank transfer (simulated Paystack DVA)', () => {
  it('tracking says the shop will share details until an account is assigned, then shows it', async () => {
    const orgId = await lagosShop()
    const placed = await bankOrder()
    const before = await sf.track(placed.trackingToken)
    expect(before.bankTransfer).toMatchObject({ provider: 'paystack_dva', account: null, dueNowMinor: placed.totalMinor, reference: placed.number, simulated: true })

    const r = await gw.assignVirtualAccount(orgId, placed.orderId)
    if (r.status !== 'assigned') throw new Error('expected assigned')
    expect(r.account).toMatchObject({ bankName: 'Demo Bank (simulated)', orderNumber: placed.number, simulated: true, status: 'active' })
    expect(r.account.accountNumber).toMatch(/^[0-9]{10}$/)
    const after = await sf.track(placed.trackingToken)
    expect(after.bankTransfer?.account).toMatchObject({ accountNumber: r.account.accountNumber, bankName: 'Demo Bank (simulated)' })
    expect(await gw.listVirtualAccounts(orgId)).toHaveLength(1)
  })

  it('without a provider, assignment answers not_configured', async () => {
    const orgId = await lagosShop('none')
    const placed = await bankOrder()
    expect((await gw.assignVirtualAccount(orgId, placed.orderId)).status).toBe('not_configured')
  })

  it('an exact transfer records once and confirms; a different amount waits in the queue with a provider', async () => {
    const orgId = await lagosShop()
    const placed = await bankOrder()
    const r = await gw.assignVirtualAccount(orgId, placed.orderId)
    if (r.status !== 'assigned') throw new Error('expected assigned')

    await gw.simulateBankTransfer!(orgId, { accountNumber: r.account.accountNumber, amountMinor: 1_000_000 })
    let receipts = await gw.listMpesaReceipts(orgId)
    expect(receipts[0]).toMatchObject({ source: 'bank_transfer', provider: 'paystack', status: 'unmatched', currency: 'NGN', orderNumber: placed.number })
    expect(receipts[0].reason).toMatch(/deposit or balance/)
    expect((await gw.getOrder(orgId, placed.orderId)).payments).toHaveLength(0)

    await gw.simulateBankTransfer!(orgId, { accountNumber: r.account.accountNumber, amountMinor: placed.totalMinor })
    const order = await gw.getOrder(orgId, placed.orderId)
    expect(order.status).toBe('confirmed')
    expect(order.payments).toHaveLength(1)
    expect(order.payments[0]).toMatchObject({ method: 'bank_transfer', provider: 'paystack', verification: 'provider_verified' })
    expect(order.history.at(-1)?.note).toMatch(/^Paid in full by bank transfer \(verified reference SIMDVA_/)
    receipts = await gw.listMpesaReceipts(orgId)
    expect(receipts.filter((x) => x.status === 'matched')).toHaveLength(1)

    // Staff dismiss the stray transfer.
    const stray = receipts.find((x) => x.status === 'unmatched')!
    await gw.dismissMpesaReceipt(orgId, stray.id, 'Buyer sent a partial amount by mistake; refunded')
    expect((await gw.listMpesaReceipts(orgId)).find((x) => x.id === stray.id)?.status).toBe('dismissed')
  })

  it('staff can attach a queued transfer: it becomes a bank_transfer payment', async () => {
    const orgId = await lagosShop()
    const placed = await bankOrder()
    const r = await gw.assignVirtualAccount(orgId, placed.orderId)
    if (r.status !== 'assigned') throw new Error('expected assigned')
    await gw.simulateBankTransfer!(orgId, { accountNumber: r.account.accountNumber, amountMinor: 1_000_000 })
    const queued = (await gw.listMpesaReceipts(orgId))[0]
    await gw.attachMpesaReceipt(orgId, queued.id, placed.orderId)
    const order = await gw.getOrder(orgId, placed.orderId)
    expect(order.payments[0]).toMatchObject({ method: 'bank_transfer', amountMinor: 1_000_000 })
    expect(order.status).toBe('pending_confirmation') // partial, no deposit policy: status unchanged
    // The partial payment is still visible to the buyer.
    const tracked = await sf.track(placed.trackingToken)
    expect(tracked.payments).toEqual([expect.objectContaining({ amountMinor: 1_000_000, method: 'bank_transfer', verified: true, currency: 'NGN' })])
    expect(tracked.history.map((h) => h.status)).toEqual(['pending_confirmation'])
    // Not presented as an M-Pesa receipt.
    expect(await sf.getPaymentReceipts(placed.trackingToken)).toEqual([])
  })

  it('refuses unknown accounts', async () => {
    const orgId = await lagosShop()
    await expect(gw.simulateBankTransfer!(orgId, { accountNumber: '9900000000', amountMinor: 100 })).rejects.toThrow(/No dedicated account/)
  })
})

describe('demo lost M-Pesa callback (STK query fallback)', () => {
  it('query success shows awaiting_receipt with no payment; the late receipt then records once', async () => {
    const data = await sf.getStorefront('mto-home')
    const v = data.products.find((p) => p.name === 'Soy Candle 200 g')!.variants[0]
    const placed = await sf.placeOrder(
      'mto-home',
      { lines: [{ variantId: v.id, quantity: 1 }], method: 'pickup', name: 'Wairimu Test', phoneE164: '+254799000555', payment: 'mpesa', marketingOptIn: false },
      newIdempotencyKey(),
    )
    const org = (await gw.listOrganisations()).find((o) => o.baseCurrency === 'KES')!
    const r = await sf.requestMpesaPrompt(placed.trackingToken, '+254712345678', { simulate: 'callback_lost' })
    if (r.status !== 'prompt_sent') throw new Error('expected prompt_sent')

    advance(SIM_DELAY_MS.callback_lost + 100)
    expect(await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)).toEqual({ status: 'awaiting_receipt', resultCode: 0 })
    expect((await gw.getOrder(org.id, placed.orderId)).payments).toHaveLength(0)
    expect((await gw.listMpesaPrompts(org.id)).find((p) => p.checkoutRequestId === r.checkoutRequestId)?.status).toBe('awaiting_receipt')
    expect((await sf.track(placed.trackingToken)).paidMinor).toBe(0)

    advance(SIM_LOST_RECEIPT_AFTER_MS)
    expect((await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)).status).toBe('paid')
    advance(60_000)
    await gw.listMpesaPrompts(org.id)
    const order = await gw.getOrder(org.id, placed.orderId)
    expect(order.payments).toHaveLength(1)
    expect(order.status).toBe('confirmed')
  })
})
