import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setDemoRole, createDemoGateway, demoInternals, resetDemoWorkspace } from './demo'
import { newIdempotencyKey } from './gateway'
import { createDemoStorefront } from './storefront-demo'
import type { PlaceOrderInput, SimulatedOutcome } from './storefront'

const gw = createDemoGateway()
const sf = createDemoStorefront()
const PHONE = '+254712345678'
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

let phoneSeq = 100
async function placeOrder() {
  const data = await sf.getStorefront('mto-home')
  const v = data.products.find((p) => p.name === 'Soy Candle 200 g')!.variants[0]
  phoneSeq += 1
  const input: PlaceOrderInput = {
    lines: [{ variantId: v.id, quantity: 1 }],
    method: 'pickup',
    name: 'Wairimu Test',
    phoneE164: `+254799000${phoneSeq}`,
    payment: 'mpesa',
    marketingOptIn: false,
  }
  return sf.placeOrder('mto-home', input, newIdempotencyKey())
}

async function promptAndSettle(simulate: SimulatedOutcome, waitMs = 11_000) {
  const placed = await placeOrder()
  const r = await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate })
  if (r.status !== 'prompt_sent') throw new Error('expected prompt_sent')
  expect(await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)).toEqual({ status: 'pending', resultCode: null })
  advance(waitMs)
  const status = await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)
  return { placed, id: r.checkoutRequestId, status }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  resetDemoWorkspace()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('simulated STK lifecycle (demo)', () => {
  it('offers simulated STK by default and says so', async () => {
    expect(await sf.getPaymentOptions('mto-home')).toEqual({ provider: 'daraja', stk: true, simulated: true })
  })

  it('success: records one provider-verified payment, confirms the order and logs the receipt', async () => {
    const org = await mto()
    const { placed, status } = await promptAndSettle('success')
    expect(status).toEqual({ status: 'paid', resultCode: 0 })
    const order = await gw.getOrder(org.id, placed.orderId)
    expect(order.status).toBe('confirmed')
    expect(order.payments).toHaveLength(1)
    expect(order.payments[0]).toMatchObject({ verification: 'provider_verified', provider: 'mpesa', amountMinor: placed.totalMinor })
    expect(order.history.at(-1)?.note).toMatch(/Paid in full by M-Pesa \(verified receipt S/)
    const receipts = await gw.listMpesaReceipts(org.id)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ status: 'matched', orderNumber: placed.number, simulated: true })
    // Settling again (more polls, merchant views) never adds a second payment.
    advance(60_000)
    await gw.listMpesaPrompts(org.id)
    expect((await gw.getOrder(org.id, placed.orderId)).payments).toHaveLength(1)
    expect((await sf.track(placed.trackingToken)).paidMinor).toBe(placed.totalMinor)
  })

  it('stays pending until the simulated delay passes', async () => {
    const placed = await placeOrder()
    const r = await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate: 'success' })
    if (r.status !== 'prompt_sent') throw new Error('expected prompt')
    advance(2_000)
    expect((await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)).status).toBe('pending')
  })

  it('cancelled and timeout never record money', async () => {
    const org = await mto()
    const c = await promptAndSettle('cancelled')
    expect(c.status).toEqual({ status: 'cancelled', resultCode: 1032 })
    const t = await promptAndSettle('timeout')
    expect(t.status).toEqual({ status: 'timeout', resultCode: 1037 })
    for (const x of [c, t]) expect((await gw.getOrder(org.id, x.placed.orderId)).payments).toHaveLength(0)
    expect(await gw.listMpesaReceipts(org.id)).toHaveLength(0)
  })

  it('wrong amount: flagged for review, not accepted; staff can attach it as a partial payment', async () => {
    const org = await mto()
    const { placed, status } = await promptAndSettle('wrong_amount')
    expect(status.status).toBe('mismatch')
    const order = await gw.getOrder(org.id, placed.orderId)
    expect(order.payments).toHaveLength(0)
    expect(order.status).toBe('pending_confirmation')
    const [r] = await gw.listMpesaReceipts(org.id)
    expect(r).toMatchObject({ status: 'mismatch', orderId: placed.orderId, amountMinor: placed.totalMinor - 100 })
    await gw.attachMpesaReceipt(org.id, r.id, placed.orderId)
    const after = await gw.getOrder(org.id, placed.orderId)
    expect(after.payments).toHaveLength(1)
    expect(after.status).toBe('pending_confirmation') // partial: not auto-confirmed
    await expect(gw.attachMpesaReceipt(org.id, r.id, placed.orderId)).rejects.toThrow(/already been resolved/)
  })

  it('late success after the order was cancelled goes to the queue, not onto the order', async () => {
    const org = await mto()
    const placed = await placeOrder()
    const r = await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate: 'success' })
    if (r.status !== 'prompt_sent') throw new Error('expected prompt')
    await gw.transitionOrder(org.id, placed.orderId, 'cancelled', 'Customer changed mind')
    advance(6_000)
    expect((await sf.getMpesaPromptStatus(placed.trackingToken, r.checkoutRequestId)).status).toBe('late')
    expect((await gw.getOrder(org.id, placed.orderId)).payments).toHaveLength(0)
    const [receipt] = await gw.listMpesaReceipts(org.id)
    expect(receipt).toMatchObject({ status: 'late', reason: expect.stringMatching(/cancelled/) })
  })

  it('a second prompt paid after the first is an extra payment for review', async () => {
    const org = await mto()
    const placed = await placeOrder()
    const a = await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate: 'success' })
    const b = await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate: 'success' })
    if (a.status !== 'prompt_sent' || b.status !== 'prompt_sent') throw new Error('expected prompts')
    advance(6_000)
    const statuses = [
      (await sf.getMpesaPromptStatus(placed.trackingToken, a.checkoutRequestId)).status,
      (await sf.getMpesaPromptStatus(placed.trackingToken, b.checkoutRequestId)).status,
    ].sort()
    expect(statuses).toEqual(['late', 'paid'])
    expect((await gw.getOrder(org.id, placed.orderId)).payments).toHaveLength(1)
  })

  it('validates phone, provider and rate limit', async () => {
    const org = await mto()
    const placed = await placeOrder()
    expect(await sf.requestMpesaPrompt(placed.trackingToken, '+447700900123')).toMatchObject({ status: 'failed' })
    for (let i = 0; i < 5; i++) expect((await sf.requestMpesaPrompt(placed.trackingToken, PHONE, { simulate: 'cancelled' })).status).toBe('prompt_sent')
    expect(await sf.requestMpesaPrompt(placed.trackingToken, PHONE)).toMatchObject({ status: 'failed', error: expect.stringMatching(/Too many/) })
    await gw.setCollectionsProvider(org.id, { provider: 'manual', aggregator: null })
    expect(await sf.getPaymentOptions('mto-home')).toMatchObject({ provider: 'manual', stk: false })
    const other = await placeOrder()
    expect(await sf.requestMpesaPrompt(other.trackingToken, PHONE)).toEqual({ status: 'not_configured' })
    await gw.setCollectionsProvider(org.id, { provider: 'aggregator', aggregator: 'intasend' })
    expect(await sf.requestMpesaPrompt(other.trackingToken, PHONE)).toEqual({ status: 'not_configured' })
    await expect(gw.setCollectionsProvider(org.id, { provider: 'aggregator', aggregator: null })).rejects.toThrow(/which aggregator/)
  })
})

describe('unmatched queue and receipt verification (demo)', () => {
  it('direct Till payment without a reference waits in the queue; dismiss needs a reason', async () => {
    const org = await mto()
    await gw.simulateIncomingMpesa!(org.id, { amountMinor: 50_000, accountRef: null })
    const [r] = await gw.listMpesaReceipts(org.id)
    expect(r).toMatchObject({ status: 'unmatched', source: 'c2b', reason: expect.stringMatching(/No order number/) })
    await expect(gw.dismissMpesaReceipt(org.id, r.id, '  ')).rejects.toThrow(/reason/)
    await gw.dismissMpesaReceipt(org.id, r.id, 'Personal transfer')
    expect((await gw.listMpesaReceipts(org.id))[0].status).toBe('dismissed')
  })

  it('a Paybill payment naming an order with its exact balance is matched automatically', async () => {
    const org = await mto()
    const placed = await placeOrder()
    await gw.simulateIncomingMpesa!(org.id, { amountMinor: placed.totalMinor, accountRef: `#${placed.number}` })
    const [r] = await gw.listMpesaReceipts(org.id)
    expect(r).toMatchObject({ status: 'matched', orderId: placed.orderId })
    expect((await gw.getOrder(org.id, placed.orderId)).status).toBe('confirmed')
  })

  it('attaching refuses overpayment and closed orders', async () => {
    const org = await mto()
    const placed = await placeOrder()
    await gw.simulateIncomingMpesa!(org.id, { amountMinor: placed.totalMinor + 100_00, accountRef: null })
    const [r] = await gw.listMpesaReceipts(org.id)
    await expect(gw.attachMpesaReceipt(org.id, r.id, placed.orderId)).rejects.toThrow(/more than the balance/)
    await gw.transitionOrder(org.id, placed.orderId, 'cancelled', null)
    await expect(gw.attachMpesaReceipt(org.id, r.id, placed.orderId)).rejects.toThrow(/cancelled/)
  })

  it('verify-code: verified, not found, invalid format, and manual mode is not verifiable', async () => {
    const org = await mto()
    const { placed } = await promptAndSettle('success')
    const [r] = await gw.listMpesaReceipts(org.id)
    expect(await gw.verifyMpesaReceipt(org.id, r.receipt.toLowerCase())).toMatchObject({
      state: 'verified',
      receipt: { code: r.receipt, orderNumber: placed.number, status: 'matched' },
    })
    expect(await gw.verifyMpesaReceipt(org.id, 'QZZ0000000')).toEqual({ state: 'not_found', alsoRecordedManuallyOn: [] })
    expect(await gw.verifyMpesaReceipt(org.id, 'fake!')).toEqual({ state: 'invalid_format' })
    await gw.setCollectionsProvider(org.id, { provider: 'manual', aggregator: null })
    expect((await gw.verifyMpesaReceipt(org.id, 'QZZ0000000')).state).toBe('not_verifiable')
  })

  it('flags a code that staff typed in manually on another order', async () => {
    const org = await mto()
    const placed = await placeOrder()
    await gw.recordManualPayment(
      org.id,
      { orderId: placed.orderId, amountMinor: 10_000, currency: 'KES', method: 'mobile_money', externalRef: 'QAB1234567', receivedAt: new Date().toISOString(), note: null },
      newIdempotencyKey(),
    )
    expect(await gw.verifyMpesaReceipt(org.id, 'qab1234567')).toEqual({ state: 'not_found', alsoRecordedManuallyOn: [placed.number] })
  })

  it('roles: analysts cannot attach, dismiss or change the provider', async () => {
    const org = await mto()
    await gw.simulateIncomingMpesa!(org.id, { amountMinor: 50_000, accountRef: null })
    const [r] = await gw.listMpesaReceipts(org.id)
    const placed = await placeOrder()
    __setDemoRole(org.id, 'analyst')
    await expect(gw.attachMpesaReceipt(org.id, r.id, placed.orderId)).rejects.toThrow(/cannot record payments/)
    await expect(gw.dismissMpesaReceipt(org.id, r.id, 'x')).rejects.toThrow(/cannot record payments/)
    await expect(gw.setCollectionsProvider(org.id, { provider: 'manual', aggregator: null })).rejects.toThrow(/cannot manage integrations/)
    expect((await gw.verifyMpesaReceipt(org.id, 'QZZ0000000')).state).toBe('not_found')
  })
})

describe('shop M-Pesa keys (demo)', () => {
  const input = {
    environment: 'sandbox' as const,
    shortcode: '600111',
    transactionType: 'CustomerBuyGoodsOnline' as const,
    partyB: '654321',
    consumerKey: 'demo-key-WXYZ',
    consumerSecret: 'demo-secret',
    passkey: 'demo-passkey',
  }

  it('keeps only a summary, never the secret values', async () => {
    const org = await mto()
    expect(await gw.getMpesaCredentials(org.id)).toEqual({ configured: false })
    const saved = await gw.saveMpesaCredentials(org.id, input)
    expect(saved).toMatchObject({ configured: true, shortcode: '600111', partyB: '654321', keyHint: '…WXYZ' })
    expect(JSON.stringify(saved)).not.toMatch(/demo-secret|demo-passkey/)
    const state = await demoInternals.read((st) => JSON.stringify(st))
    expect(state).not.toMatch(/demo-secret|demo-passkey/)
    expect(state).toContain('600111')
    // Blank secrets keep the saved summary.
    const again = await gw.saveMpesaCredentials(org.id, { ...input, consumerKey: '', consumerSecret: '', passkey: '' })
    expect(again).toMatchObject({ keyHint: '…WXYZ' })
    await gw.clearMpesaCredentials(org.id)
    expect(await gw.getMpesaCredentials(org.id)).toEqual({ configured: false })
  })

  it('validates input, needs owner/admin, and never claims a verified account', async () => {
    const org = await mto()
    await expect(gw.saveMpesaCredentials(org.id, { ...input, consumerKey: '' })).rejects.toThrow(/consumer key/)
    await expect(gw.saveMpesaCredentials(org.id, { ...input, shortcode: '12' })).rejects.toThrow(/5 to 8 digits/)
    await gw.saveMpesaCredentials(org.id, input)
    await expect(gw.markMpesaVerified(org.id)).rejects.toThrow(/cannot verify/)
    __setDemoRole(org.id, 'manager')
    await expect(gw.saveMpesaCredentials(org.id, input)).rejects.toThrow()
  })

  it('stores the tracking-link window and validates it', async () => {
    const org = await mto()
    const base = (await gw.getShopSettings(org.id))!
    await gw.saveShopSettings(org.id, { ...base, trackingLinkDays: 30 })
    expect((await gw.getShopSettings(org.id))!.trackingLinkDays).toBe(30)
    await expect(gw.saveShopSettings(org.id, { ...base, trackingLinkDays: 3 })).rejects.toThrow(/7 to 3650/)
  })
})
