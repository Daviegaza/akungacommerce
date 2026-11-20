import { describe, expect, it } from 'vitest'
import type { OrderSummary, Payment, Refund } from '@/gateway/types'
import { INTEGRATION_LABEL_TEXT, integrationStatuses } from './registry'
import { whatsappChatLink } from './whatsapp-link'
import { downloadCsv, ordersCsv, paymentsCsv, refundsCsv, toCsv } from './csv'

describe('integration registry', () => {
  it('never claims anything is connected', () => {
    const all = integrationStatuses()
    expect(all.length).toBe(13)
    for (const s of all) {
      expect(s.label).not.toBe('connected_verified')
      expect(s.label).not.toBe('configured_unverified')
      expect(s.lastTestedAt).toBeNull()
      expect(s.detail.length).toBeGreaterThan(0)
    }
  })
  it('labels each integration honestly', () => {
    const byProvider = Object.fromEntries(integrationStatuses().map((s) => [s.provider, s.label]))
    expect(byProvider).toEqual({
      whatsapp_cloud: 'adapter_only',
      resend: 'adapter_only',
      twilio: 'adapter_only',
      stripe: 'adapter_only',
      paystack: 'adapter_only',
      mpesa: 'adapter_only',
      intasend: 'adapter_only',
      pesapal: 'adapter_only',
      flutterwave: 'adapter_only',
      courier: 'not_implemented',
      kra_etims: 'not_implemented',
      xero: 'not_implemented',
      quickbooks_online: 'not_implemented',
    })
  })
  it('returns copies so callers cannot mutate the registry', () => {
    integrationStatuses()[0].label = 'connected_verified'
    expect(integrationStatuses()[0].label).toBe('adapter_only')
  })
  it('has human text for every label', () => {
    expect(INTEGRATION_LABEL_TEXT.adapter_only).toBe('Adapter only')
    expect(INTEGRATION_LABEL_TEXT.connected_verified).toBe('Connected and verified')
    expect(INTEGRATION_LABEL_TEXT.configured_unverified).toBe('Configured, not verified')
    expect(INTEGRATION_LABEL_TEXT.not_implemented).toBe('Not implemented')
  })
})

describe('whatsappChatLink', () => {
  it('builds a wa.me link with encoded text', () => {
    expect(whatsappChatLink('+254712345678', 'Hi! Order #12 & 3 items?')).toBe(
      'https://wa.me/254712345678?text=Hi!%20Order%20%2312%20%26%203%20items%3F',
    )
  })
  it('encodes non-ASCII text', () => {
    expect(whatsappChatLink('+447700900123', 'Café ✓')).toBe('https://wa.me/447700900123?text=Caf%C3%A9%20%E2%9C%93')
  })
  it('omits the text parameter when empty', () => {
    expect(whatsappChatLink('+15551234567', '')).toBe('https://wa.me/15551234567')
  })
  it.each(['254712345678', '+0712345678', '+25471234567890123', '+2547 1234 5678', '', '+12'])('rejects %j', (n) => {
    expect(() => whatsappChatLink(n, 'x')).toThrow(/E\.164/)
  })
})

describe('toCsv', () => {
  const cols = [
    { key: 'a', header: 'A' },
    { key: 'b', header: 'B' },
  ]
  it('quotes per RFC 4180 and uses CRLF', () => {
    const csv = toCsv([{ a: 'plain', b: 'has, comma' }, { a: 'say "hi"', b: 'line1\nline2' }, { a: null, b: 7 }], cols)
    expect(csv).toBe('A,B\r\nplain,"has, comma"\r\n"say ""hi""","line1\nline2"\r\n,7\r\n')
  })
  it('neutralises formula injection', () => {
    const rows = ['=SUM(A1:A2)', '+cmd', '-1+2', '@import', '\tTAB', '\rCR', '=HYPERLINK("http://x")'].map((a) => ({ a, b: null }))
    const lines = toCsv(rows, cols).split('\r\n')
    expect(lines.slice(1, 6)).toEqual(["'=SUM(A1:A2),", "'+cmd,", "'-1+2,", "'@import,", "'\tTAB,"])
    expect(lines[6]).toBe(`"'\rCR",`)
    expect(lines[7]).toBe(`"'=HYPERLINK(""http://x"")",`)
  })
  it('leaves plain negative decimals alone', () => {
    expect(toCsv([{ a: '-12.50', b: -3 }], cols)).toBe('A,B\r\n-12.50,-3\r\n')
  })
  it('guards headers too', () => {
    expect(toCsv([], [{ key: 'x', header: '=evil' }])).toBe("'=evil\r\n")
  })
})

const order = (over: Partial<OrderSummary>): OrderSummary => ({
  id: 'o1',
  number: 101,
  status: 'confirmed',
  channel: 'whatsapp',
  currency: 'USD',
  customerId: null,
  customerName: 'Amina, Ltd',
  customerPhone: '+254712345678',
  subtotalMinor: 1250,
  discountMinor: 0,
  taxMinor: 200,
  deliveryFeeMinor: 5,
  totalMinor: 1455,
  taxMode: 'exclusive',
  note: null,
  createdAt: '2026-11-19T23:30:00.000Z',
  updatedAt: '2026-11-19T23:30:00.000Z',
  netPaidMinor: 1455,
  fulfilmentMethod: 'delivery',
  ...over,
})

describe('accounting exports', () => {
  it('orders: exact decimals per currency with an explicit currency column', () => {
    const csv = ordersCsv([
      order({}),
      order({ id: 'o2', number: 102, currency: 'JPY', subtotalMinor: 1500, taxMinor: 150, deliveryFeeMinor: 0, totalMinor: 1650, netPaidMinor: 0 }),
      order({ id: 'o3', number: 103, currency: 'KWD', subtotalMinor: 12345, taxMinor: 5, deliveryFeeMinor: 1, totalMinor: 12351, netPaidMinor: 12351 }),
    ])
    const [header, usd, jpy, kwd] = csv.split('\r\n')
    expect(header).toBe(
      'Order number,Date (UTC),Created at (ISO 8601),Status,Channel,Customer,Customer phone,Currency,Subtotal,Discount,Tax,Tax mode,Delivery fee,Total,Net paid,Fulfilment,Order ID',
    )
    expect(usd).toBe(
      `101,2026-11-19,2026-11-19T23:30:00.000Z,confirmed,whatsapp,"Amina, Ltd",'+254712345678,USD,12.50,0.00,2.00,exclusive,0.05,14.55,14.55,delivery,o1`,
    )
    expect(jpy).toContain(',JPY,1500,0,150,exclusive,0,1650,0,')
    expect(kwd).toContain(',KWD,12.345,0.000,0.005,exclusive,0.001,12.351,12.351,')
    // Phone numbers starting with "+" digits are neutralised as potential formulas.
    expect(csv).not.toMatch(/,\+254/)
  })

  it('payments and refunds: currency column + exact major-unit amounts', () => {
    const payment: Payment = {
      id: 'p1',
      orderId: 'o1',
      orderNumber: 101,
      provider: 'manual',
      method: 'mobile_money',
      amountMinor: 1001,
      currency: 'KWD',
      status: 'succeeded',
      verification: 'manual_unverified',
      externalRef: '=cmd|calc',
      note: null,
      receivedAt: '2026-11-19T10:00:00.000Z',
      reversedReason: null,
      createdAt: '2026-11-19T10:00:00.000Z',
    }
    const refund: Refund = {
      id: 'r1',
      orderId: 'o1',
      orderNumber: 101,
      paymentId: 'p1',
      amountMinor: 500,
      currency: 'JPY',
      status: 'succeeded',
      verification: 'manual_unverified',
      reason: 'Damaged, "box"',
      createdAt: '2026-11-19T11:00:00.000Z',
    }
    const p = paymentsCsv([payment]).split('\r\n')[1]
    expect(p).toBe("101,2026-11-19T10:00:00.000Z,manual,mobile_money,succeeded,manual_unverified,KWD,1.001,'=cmd|calc,,,p1,o1")
    const r = refundsCsv([refund]).split('\r\n')[1]
    expect(r).toBe('101,2026-11-19T11:00:00.000Z,succeeded,manual_unverified,JPY,500,"Damaged, ""box""",r1,p1,o1')
  })

  it('downloadCsv is a no-op outside the browser', () => {
    expect(downloadCsv('orders.csv', 'a\r\n')).toBe(false)
  })
})
