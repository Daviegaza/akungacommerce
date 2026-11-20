import { describe, expect, it, vi } from 'vitest'
import {
  AGGREGATORS,
  callbackUrlWithSecret,
  createAggregatorProvider,
  createDarajaProvider,
  createManualProvider,
  readDarajaConfig,
  resolveCollectionsProvider,
  type AggregatorAdapter,
  type DarajaConfig,
} from './collections.ts'
import type { FetchLike } from './daraja.ts'

// Placeholders only; never real credentials.
const ENV: Record<string, string> = {
  DARAJA_ENV: 'sandbox',
  DARAJA_CONSUMER_KEY: 'test-key',
  DARAJA_CONSUMER_SECRET: 'test-secret',
  DARAJA_SHORTCODE: '174379',
  DARAJA_PASSKEY: 'test-passkey',
  DARAJA_CALLBACK_URL: 'https://example.supabase.co/functions/v1/mpesa-callback',
  MPESA_CALLBACK_SECRET: 'long-random',
}
const get = (env: Record<string, string>) => (k: string) => env[k]

const req = { orderNumber: 1042, amountMinor: 150_000, currency: 'KES', phoneE164: '+254712345678', callbackUrl: 'https://example.supabase.co/cb?secret=x' }

function mockFetch(stkStatus = 200, stkBody: unknown = { ResponseCode: '0', CheckoutRequestID: 'ws_CO_1', MerchantRequestID: 'm1' }) {
  return vi.fn<FetchLike>(async (url) => {
    if (url.includes('/oauth/')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    return new Response(JSON.stringify(stkBody), { status: stkStatus })
  })
}

describe('readDarajaConfig', () => {
  it('needs every value and a valid environment', () => {
    expect(readDarajaConfig(get(ENV))).toMatchObject({ env: 'sandbox', shortcode: '174379', transactionType: 'CustomerPayBillOnline' })
    expect(readDarajaConfig(get({ ...ENV, DARAJA_PASSKEY: '' }))).toBeNull()
    expect(readDarajaConfig(get({ ...ENV, DARAJA_ENV: 'live' }))).toBeNull()
    expect(readDarajaConfig(get({ ...ENV, DARAJA_TRANSACTION_TYPE: 'Nope' }))).toBeNull()
    expect(readDarajaConfig(get({ ...ENV, DARAJA_TRANSACTION_TYPE: 'CustomerBuyGoodsOnline', DARAJA_PARTY_B: '123456' }))).toMatchObject({
      transactionType: 'CustomerBuyGoodsOnline',
      partyB: '123456',
    })
  })

  it('appends the callback secret', () => {
    expect(callbackUrlWithSecret('https://x.test/cb', 'a b')).toBe('https://x.test/cb?secret=a+b')
  })
})

describe('Daraja provider', () => {
  const cfg = readDarajaConfig(get(ENV)) as DarajaConfig

  it('sends an STK push through mocked HTTP and returns the checkout id', async () => {
    const f = mockFetch()
    const out = await createDarajaProvider(cfg, f).requestPrompt(req)
    expect(out).toEqual({ status: 'prompt_sent', checkoutRequestId: 'ws_CO_1' })
    expect(f).toHaveBeenCalledTimes(2)
    const body = JSON.parse(String(f.mock.calls[1][1]?.body))
    expect(body).toMatchObject({ Amount: 1500, PartyA: '254712345678', AccountReference: '1042' })
    expect(String(f.mock.calls[1][0])).toMatch(/^https:\/\/sandbox\.safaricom\.co\.ke\//)
  })

  it('returns failed (not throw) on a rejected push, without leaking secrets', async () => {
    const out = await createDarajaProvider(cfg, mockFetch(400, { errorMessage: 'Bad Request - Invalid PhoneNumber' })).requestPrompt(req)
    expect(out.status).toBe('failed')
    expect(JSON.stringify(out)).not.toMatch(/test-secret|test-passkey/)
  })

  it('refuses non-KES and fractional amounts before calling the network', async () => {
    const f = mockFetch()
    expect((await createDarajaProvider(cfg, f).requestPrompt({ ...req, currency: 'EUR' })).status).toBe('failed')
    expect((await createDarajaProvider(cfg, f).requestPrompt({ ...req, amountMinor: 150_050 })).status).toBe('failed')
    expect(f).not.toHaveBeenCalled()
  })

  it('normalises callbacks to minor units, receipt and phone hint', () => {
    const cb = createDarajaProvider(cfg, mockFetch()).parseCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'm1',
          CheckoutRequestID: 'ws_CO_1',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1500 },
              { Name: 'MpesaReceiptNumber', Value: 'qkj3xyz12a' },
              { Name: 'TransactionDate', Value: 20261120143005 },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    })
    expect(cb).toEqual({
      checkoutRequestId: 'ws_CO_1',
      resultCode: 0,
      resultDesc: 'ok',
      amountMinor: 150_000,
      receipt: 'QKJ3XYZ12A',
      phoneHint: '678',
      transactedAt: '2026-11-20T11:30:05.000Z',
    })
  })
})

describe('aggregator and manual providers', () => {
  it('every listed aggregator is honestly adapter_only', () => {
    expect(AGGREGATORS.length).toBeGreaterThan(0)
    for (const a of AGGREGATORS) expect(a.readiness).toBe('adapter_only')
  })

  it('an aggregator without a verified adapter never calls the network', async () => {
    const f = mockFetch()
    const p = createAggregatorProvider('intasend', f)
    expect(p.supportsStk).toBe(false)
    expect(await p.requestPrompt(req)).toEqual({ status: 'not_configured' })
    expect(p.parseCallback({})).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('delegates to a registered adapter', async () => {
    const adapter: AggregatorAdapter = {
      id: 'fake',
      requestPrompt: async () => ({ status: 'prompt_sent', checkoutRequestId: 'agg_1' }),
      verifyWebhook: async () => true,
      parseWebhook: () => null,
    }
    const p = createAggregatorProvider('fake', mockFetch(), { fake: adapter })
    expect(p.paymentProvider).toBe('fake')
    expect(await p.requestPrompt(req)).toEqual({ status: 'prompt_sent', checkoutRequestId: 'agg_1' })
  })

  it('manual mode never prompts', async () => {
    expect(await createManualProvider().requestPrompt(req)).toEqual({ status: 'not_configured' })
  })

  it('resolves the shop choice and degrades to manual when Daraja is not configured', () => {
    const f = mockFetch()
    expect(resolveCollectionsProvider({ provider: 'daraja', aggregator: null }, get(ENV), f).id).toBe('daraja')
    expect(resolveCollectionsProvider({ provider: 'daraja', aggregator: null }, get({}), f).id).toBe('manual')
    expect(resolveCollectionsProvider({ provider: 'aggregator', aggregator: 'pesapal' }, get(ENV), f).id).toBe('aggregator')
    expect(resolveCollectionsProvider({ provider: 'nope', aggregator: null }, get(ENV), f).id).toBe('manual')
  })
})
