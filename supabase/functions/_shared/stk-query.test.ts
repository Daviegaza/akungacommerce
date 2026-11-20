import { describe, expect, it, vi } from 'vitest'
import {
  DarajaError,
  buildStkQueryPayload,
  darajaPassword,
  parseStkQueryResponse,
  queryStkPush,
  stkQueryAction,
  stkQueryRpcArgs,
  type FetchLike,
} from './daraja.ts'

// Daraja public sandbox test values (documented by Safaricom; not secrets).
const SHORTCODE = '174379'
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'
const ID = 'ws_CO_20112026101010123456'

function mockFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('STK Push Query payload', () => {
  it('builds BusinessShortCode, Password, Timestamp and CheckoutRequestID like the push', () => {
    const at = new Date('2026-03-09T22:05:07Z')
    const p = buildStkQueryPayload({ shortcode: SHORTCODE, passkey: PASSKEY, checkoutRequestId: ` ${ID} `, at })
    expect(p).toEqual({
      BusinessShortCode: SHORTCODE,
      Password: darajaPassword(SHORTCODE, PASSKEY, '20260310010507'),
      Timestamp: '20260310010507',
      CheckoutRequestID: ID,
    })
    expect(Object.keys(p).sort()).toEqual(['BusinessShortCode', 'CheckoutRequestID', 'Password', 'Timestamp'])
  })
  it('rejects bad input without calling anything', () => {
    expect(() => buildStkQueryPayload({ shortcode: '12', passkey: PASSKEY, checkoutRequestId: ID })).toThrow(DarajaError)
    expect(() => buildStkQueryPayload({ shortcode: SHORTCODE, passkey: '', checkoutRequestId: ID })).toThrow(DarajaError)
    expect(() => buildStkQueryPayload({ shortcode: SHORTCODE, passkey: PASSKEY, checkoutRequestId: '  ' })).toThrow(DarajaError)
  })
})

describe('queryStkPush (mocked HTTP)', () => {
  it('POSTs to /mpesa/stkpushquery/v1/query with the bearer token and maps a result', async () => {
    const f = mockFetch(200, {
      ResponseCode: '0',
      ResponseDescription: 'The service request has been accepted successsfully',
      MerchantRequestID: '22205-34066-1',
      CheckoutRequestID: ID,
      ResultCode: '1032',
      ResultDesc: 'Request cancelled by user',
    })
    const payload = buildStkQueryPayload({ shortcode: SHORTCODE, passkey: PASSKEY, checkoutRequestId: ID })
    const r = await queryStkPush(f, 'sandbox', 'tok_123', payload)
    expect(r).toEqual({ kind: 'result', resultCode: 1032, resultDesc: 'Request cancelled by user' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_123')
    expect(JSON.parse(String(init?.body))).toEqual(payload)
  })
  it('uses the production host in production', async () => {
    const f = mockFetch(200, { ResponseCode: '0', ResultCode: '0', ResultDesc: 'ok' })
    await queryStkPush(f, 'production', 't', buildStkQueryPayload({ shortcode: SHORTCODE, passkey: PASSKEY, checkoutRequestId: ID }))
    expect(f.mock.calls[0][0]).toBe('https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query')
  })
  it('maps "still processing" and failures to non-results; a network error never throws', async () => {
    const payload = buildStkQueryPayload({ shortcode: SHORTCODE, passkey: PASSKEY, checkoutRequestId: ID })
    expect(await queryStkPush(mockFetch(500, { requestId: 'x', errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }), 'sandbox', 't', payload)).toEqual({
      kind: 'processing',
    })
    const err = await queryStkPush(mockFetch(400, { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid CheckoutRequestID' }), 'sandbox', 't', payload)
    expect(err.kind).toBe('error')
    const boom: FetchLike = async () => {
      throw new Error('offline')
    }
    expect(await queryStkPush(boom, 'sandbox', 't', payload)).toEqual({ kind: 'error', message: 'STK query network error' })
  })
})

describe('parseStkQueryResponse', () => {
  it('accepts numeric or string codes and needs ResponseCode 0 + HTTP 2xx', () => {
    expect(parseStkQueryResponse(200, { ResponseCode: 0, ResultCode: 0, ResultDesc: 'ok' })).toEqual({ kind: 'result', resultCode: 0, resultDesc: 'ok' })
    expect(parseStkQueryResponse(200, { ResponseCode: '1', ResultCode: '0' }).kind).toBe('error')
    expect(parseStkQueryResponse(503, { ResponseCode: '0', ResultCode: '0' }).kind).toBe('error')
    expect(parseStkQueryResponse(200, { ResponseCode: '0' }).kind).toBe('error')
    expect(parseStkQueryResponse(200, null).kind).toBe('error')
  })
})

describe('query answer -> prompt action (never records money)', () => {
  it('ResultCode 0 means awaiting_receipt only: no amount, no receipt in the action or RPC args', () => {
    const a = stkQueryAction({ kind: 'result', resultCode: 0, resultDesc: 'The service request is processed successfully.' })
    expect(a).toEqual({ action: 'awaiting_receipt', resultCode: 0, resultDesc: 'The service request is processed successfully.' })
    const args = stkQueryRpcArgs(ID, a)
    expect(args).toEqual({ p_checkout_request_id: ID, p_result_code: 0, p_result_desc: 'The service request is processed successfully.' })
    // The only RPC the query path calls is apply_mpesa_stk_query; it has no amount or receipt parameter at all.
    expect(Object.keys(args).some((k) => /amount|receipt/i.test(k))).toBe(false)
  })
  it('cancelled, timeout, insufficient funds and wrong PIN resolve the prompt', () => {
    expect(stkQueryAction({ kind: 'result', resultCode: 1032, resultDesc: 'Cancelled' })).toMatchObject({ action: 'resolve', status: 'cancelled' })
    expect(stkQueryAction({ kind: 'result', resultCode: 1037, resultDesc: 'Timeout' })).toMatchObject({ action: 'resolve', status: 'timeout' })
    expect(stkQueryAction({ kind: 'result', resultCode: 1019, resultDesc: 'Expired' })).toMatchObject({ action: 'resolve', status: 'timeout' })
    expect(stkQueryAction({ kind: 'result', resultCode: 1, resultDesc: 'Insufficient funds' })).toMatchObject({ action: 'resolve', status: 'failed', resultCode: 1 })
    expect(stkQueryAction({ kind: 'result', resultCode: 2001, resultDesc: 'Wrong PIN' })).toMatchObject({ action: 'resolve', status: 'failed' })
  })
  it('processing / errors keep the prompt pending and send a null result code', () => {
    expect(stkQueryAction({ kind: 'processing' })).toEqual({ action: 'keep_pending' })
    expect(stkQueryAction({ kind: 'error', message: 'x' })).toEqual({ action: 'keep_pending' })
    expect(stkQueryRpcArgs(ID, { action: 'keep_pending' })).toEqual({ p_checkout_request_id: ID, p_result_code: null, p_result_desc: null })
  })
})
