import { describe, expect, it, vi } from 'vitest'
import {
  DarajaError,
  buildStkPushPayload,
  darajaBaseUrl,
  darajaPassword,
  darajaTimestamp,
  getDarajaToken,
  kesToMinor,
  parseDarajaTimestamp,
  parseStkCallback,
  sendStkPush,
  toDarajaPhone,
  type FetchLike,
  type StkPushInput,
} from './daraja.ts'

// Daraja public sandbox test values (documented by Safaricom; not secrets).
const SHORTCODE = '174379'
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'

const base: StkPushInput = {
  shortcode: SHORTCODE,
  passkey: PASSKEY,
  transactionType: 'CustomerPayBillOnline',
  amountMinor: 150_000,
  phoneE164: '+254712345678',
  callbackUrl: 'https://example.supabase.co/functions/v1/mpesa-callback?secret=abc',
  accountReference: '1042',
  transactionDesc: 'Order 1042',
  at: new Date('2026-03-09T22:05:07Z'), // 01:05:07 on 10 March in Nairobi
}

describe('timestamps', () => {
  it('formats yyyyMMddHHmmss in Africa/Nairobi (UTC+3)', () => {
    expect(darajaTimestamp(new Date('2026-03-09T22:05:07Z'))).toBe('20260310010507')
    expect(darajaTimestamp(new Date('2026-12-31T20:59:59Z'))).toBe('20261231235959')
    expect(darajaTimestamp(new Date('2026-12-31T21:00:00Z'))).toBe('20270101000000')
  })
  it('parses Daraja timestamps back to UTC and rejects impossible dates', () => {
    expect(parseDarajaTimestamp('20260310010507')).toBe('2026-03-09T22:05:07.000Z')
    expect(parseDarajaTimestamp(20260310010507)).toBe('2026-03-09T22:05:07.000Z')
    expect(parseDarajaTimestamp('20261310010507')).toBeNull()
    expect(parseDarajaTimestamp('2026031001')).toBeNull()
    expect(parseDarajaTimestamp(undefined)).toBeNull()
  })
})

describe('password and phone', () => {
  it('password is base64(shortcode + passkey + timestamp)', () => {
    const ts = '20260310010507'
    const pw = darajaPassword(SHORTCODE, PASSKEY, ts)
    expect(Buffer.from(pw, 'base64').toString('utf8')).toBe(`${SHORTCODE}${PASSKEY}${ts}`)
  })
  it.each([
    ['+254712345678', '254712345678'],
    ['+254110123456', '254110123456'],
    [' +254798765432 ', '254798765432'],
  ])('converts %s', (input, out) => {
    expect(toDarajaPhone(input)).toBe(out)
  })
  it.each(['0712345678', '254712345678', '+25471234567', '+2547123456789', '+447700900123', '+254212345678', ''])('rejects %j', (n) => {
    expect(toDarajaPhone(n)).toBeNull()
  })
})

describe('buildStkPushPayload', () => {
  it('builds the documented STK push body', () => {
    const p = buildStkPushPayload(base)
    expect(p).toEqual({
      BusinessShortCode: SHORTCODE,
      Password: darajaPassword(SHORTCODE, PASSKEY, '20260310010507'),
      Timestamp: '20260310010507',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 1500,
      PartyA: '254712345678',
      PartyB: SHORTCODE,
      PhoneNumber: '254712345678',
      CallBackURL: 'https://example.supabase.co/functions/v1/mpesa-callback?secret=abc',
      AccountReference: '1042',
      TransactionDesc: 'Order 1042',
    })
  })
  it('uses the till as PartyB for Buy Goods and trims the description to 13 chars', () => {
    const p = buildStkPushPayload({ ...base, transactionType: 'CustomerBuyGoodsOnline', partyB: '5123456', transactionDesc: 'A very long description' })
    expect(p.TransactionType).toBe('CustomerBuyGoodsOnline')
    expect(p.PartyB).toBe('5123456')
    expect(p.TransactionDesc).toBe('A very long d')
  })
  it('rejects fractional shillings, non-positive amounts and bad inputs', () => {
    expect(() => buildStkPushPayload({ ...base, amountMinor: 150_050 })).toThrow(/whole shillings/)
    expect(() => buildStkPushPayload({ ...base, amountMinor: 0 })).toThrow(/positive/)
    expect(() => buildStkPushPayload({ ...base, amountMinor: 1.5 })).toThrow(DarajaError)
    expect(() => buildStkPushPayload({ ...base, accountReference: '1234567890123' })).toThrow(/1–12/)
    expect(() => buildStkPushPayload({ ...base, accountReference: '  ' })).toThrow(/1–12/)
    expect(() => buildStkPushPayload({ ...base, callbackUrl: 'http://example.com/cb' })).toThrow(/https/)
    expect(() => buildStkPushPayload({ ...base, callbackUrl: 'not a url' })).toThrow(/invalid/)
    expect(() => buildStkPushPayload({ ...base, phoneE164: '+447700900123' })).toThrow(/Kenyan/)
    expect(() => buildStkPushPayload({ ...base, shortcode: '12' })).toThrow(/Shortcode/)
    expect(() => buildStkPushPayload({ ...base, passkey: '' })).toThrow(/Passkey/)
  })
})

function fakeFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('Daraja HTTP calls (mocked fetch; nothing leaves the process)', () => {
  it('gets an OAuth token with Basic auth against the right host', async () => {
    const f = fakeFetch(200, { access_token: 'tok123', expires_in: '3599' })
    expect(await getDarajaToken(f, 'sandbox', 'key', 'secret')).toBe('tok123')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('key:secret')}`)
    expect(darajaBaseUrl('production')).toBe('https://api.safaricom.co.ke')
  })
  it('fails auth without echoing credentials', async () => {
    const err = await getDarajaToken(fakeFetch(401, {}), 'sandbox', 'key', 'super-secret').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DarajaError)
    expect(String(err)).not.toContain('super-secret')
  })
  it('sends the STK push and returns the CheckoutRequestID', async () => {
    const f = fakeFetch(200, {
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_191220191020363925',
      ResponseCode: '0',
      ResponseDescription: 'Success. Request accepted for processing',
      CustomerMessage: 'Success. Request accepted for processing',
    })
    const payload = buildStkPushPayload(base)
    const r = await sendStkPush(f, 'sandbox', 'tok123', payload)
    expect(r).toEqual({
      checkoutRequestId: 'ws_CO_191220191020363925',
      merchantRequestId: '29115-34620561-1',
      customerMessage: 'Success. Request accepted for processing',
    })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
    expect(JSON.parse(String(init?.body))).toEqual(payload)
  })
  it('treats a non-zero ResponseCode or HTTP error as rejected', async () => {
    const payload = buildStkPushPayload(base)
    await expect(sendStkPush(fakeFetch(200, { ResponseCode: '1', ResponseDescription: 'Rejected' }), 'sandbox', 't', payload)).rejects.toThrow(/Rejected/)
    await expect(sendStkPush(fakeFetch(400, { errorMessage: 'Bad Request - Invalid PhoneNumber' }), 'sandbox', 't', payload)).rejects.toThrow(
      /Invalid PhoneNumber/,
    )
  })
})

describe('parseStkCallback', () => {
  const success = {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 1500 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20191219102115 },
            { Name: 'PhoneNumber', Value: 254708374149 },
          ],
        },
      },
    },
  }

  it('parses a successful payment (resultCode 0)', () => {
    expect(parseStkCallback(success)).toEqual({
      merchantRequestId: '29115-34620561-1',
      checkoutRequestId: 'ws_CO_191220191020363925',
      resultCode: 0,
      resultDesc: 'The service request is processed successfully.',
      succeeded: true,
      amount: 1500,
      mpesaReceipt: 'NLJ7RT61SV',
      phone: '254708374149',
      transactionDate: '2019-12-19T07:21:15.000Z',
    })
  })

  it('parses a cancelled request as not succeeded, with no amount or receipt', () => {
    const cancelled = {
      Body: { stkCallback: { MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_1', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } },
    }
    expect(parseStkCallback(cancelled)).toMatchObject({ succeeded: false, resultCode: 1032, amount: null, mpesaReceipt: null, phone: null })
  })

  it('accepts a string ResultCode and returns null for anything that is not an STK callback', () => {
    const s = JSON.parse(JSON.stringify(success))
    s.Body.stkCallback.ResultCode = '0'
    expect(parseStkCallback(s)?.succeeded).toBe(true)
    expect(parseStkCallback(null)).toBeNull()
    expect(parseStkCallback({})).toBeNull()
    expect(parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull()
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', ResultCode: 'abc' } } })).toBeNull()
  })

  it('converts whole KES to minor units and refuses fractions', () => {
    expect(kesToMinor(1500)).toBe(150_000)
    expect(kesToMinor(15.5)).toBeNull()
    expect(kesToMinor(0)).toBeNull()
    expect(kesToMinor(null)).toBeNull()
  })
})
