import { describe, expect, it } from 'vitest'
import { kesDecimalToMinor, normaliseReceipt, parseC2bConfirmation, parseStkCallback, phoneHintOf, stkResultStatus } from './daraja.ts'

// Shape of a Daraja C2B confirmation (values are fictional).
const c2b = {
  TransactionType: 'Pay Bill',
  TransID: 'RKTQDM7W6S',
  TransTime: '20261120143005',
  TransAmount: '1500.00',
  BusinessShortCode: '600638',
  BillRefNumber: ' 1042 ',
  InvoiceNumber: '',
  OrgAccountBalance: '49197.00',
  ThirdPartyTransID: '',
  MSISDN: '254708374149',
  FirstName: 'Jane',
}

describe('STK result codes', () => {
  it('maps result codes to prompt statuses', () => {
    expect(stkResultStatus(0)).toBe('paid')
    expect(stkResultStatus(1032)).toBe('cancelled')
    expect(stkResultStatus(1037)).toBe('timeout')
    expect(stkResultStatus(1019)).toBe('timeout')
    expect(stkResultStatus(1)).toBe('failed')
    expect(stkResultStatus(2001)).toBe('failed')
  })

  it('parses a cancelled callback with string result code and no metadata', () => {
    const cb = parseStkCallback({
      Body: { stkCallback: { MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_1', ResultCode: '1032', ResultDesc: 'Request cancelled by user' } },
    })
    expect(cb).toMatchObject({ resultCode: 1032, succeeded: false, amount: null, mpesaReceipt: null })
  })
})

describe('receipt helpers', () => {
  it('normalises receipts and phone hints', () => {
    expect(normaliseReceipt(' rktqdm7w6s ')).toBe('RKTQDM7W6S')
    expect(normaliseReceipt('short')).toBeNull()
    expect(normaliseReceipt(42)).toBeNull()
    expect(phoneHintOf(254708374149)).toBe('149')
    expect(phoneHintOf('abc')).toBeNull()
  })

  it('converts decimal KES strings to minor units exactly', () => {
    expect(kesDecimalToMinor('1500.00')).toBe(150_000)
    expect(kesDecimalToMinor('1500.5')).toBe(150_050)
    expect(kesDecimalToMinor(10)).toBe(1000)
    expect(kesDecimalToMinor('0.00')).toBeNull()
    expect(kesDecimalToMinor('1.005')).toBeNull()
    expect(kesDecimalToMinor('-5')).toBeNull()
  })
})

describe('parseC2bConfirmation', () => {
  it('parses a confirmation and keeps only a payer hint', () => {
    expect(parseC2bConfirmation(c2b)).toEqual({
      transId: 'RKTQDM7W6S',
      transactionType: 'Pay Bill',
      amountMinor: 150_000,
      shortcode: '600638',
      accountRef: '1042',
      transactedAt: '2026-11-20T11:30:05.000Z',
      payerHint: 'Jane ···149',
    })
  })

  it('accepts a numeric shortcode and an empty account reference (Till)', () => {
    const r = parseC2bConfirmation({ ...c2b, BusinessShortCode: 600638, BillRefNumber: '' })
    expect(r?.shortcode).toBe('600638')
    expect(r?.accountRef).toBeNull()
  })

  it('rejects malformed bodies', () => {
    expect(parseC2bConfirmation(null)).toBeNull()
    expect(parseC2bConfirmation({ ...c2b, TransID: '' })).toBeNull()
    expect(parseC2bConfirmation({ ...c2b, TransAmount: 'abc' })).toBeNull()
    expect(parseC2bConfirmation({ ...c2b, BusinessShortCode: '12' })).toBeNull()
  })
})
