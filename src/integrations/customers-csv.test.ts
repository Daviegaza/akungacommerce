import { describe, expect, it } from 'vitest'
import { customersCsv } from './csv'
import type { CustomerExportRow } from '@/gateway/trust'

const row = (over: Partial<CustomerExportRow>): CustomerExportRow => ({
  id: 'c1',
  name: 'Amina Wekesa',
  phoneE164: '+254712000101',
  email: 'amina@example.com',
  orderCount: 2,
  spent: [{ currency: 'KES', totalMinor: 350000 }],
  lastOrderAt: '2026-11-14T09:00:00.000Z',
  marketingConsent: true,
  consentUpdatedAt: '2026-10-01T08:00:00.000Z',
  consentSource: 'checkout',
  createdAt: '2026-09-01T08:00:00.000Z',
  ...over,
})

describe('customers CSV', () => {
  it('has a header and one row per customer with consent provenance', () => {
    const csv = customersCsv([row({})])
    const [header, line] = csv.trimEnd().split('\r\n')
    expect(header).toBe(
      'Name,Phone (E.164),Email,Orders,Total spent,Currency,Last order (ISO 8601),Marketing consent,Consent updated at (ISO 8601),Consent source,Customer since (ISO 8601),Customer ID',
    )
    // A leading "+" is neutralised like every other formula trigger (same as the orders export).
    expect(line).toBe(
      "Amina Wekesa,'+254712000101,amina@example.com,2,3500.00,KES,2026-11-14T09:00:00.000Z,yes,2026-10-01T08:00:00.000Z,Ticked the box at checkout,2026-09-01T08:00:00.000Z,c1",
    )
  })

  it('never sums currencies and leaves spend empty with no orders', () => {
    const csv = customersCsv([
      row({ spent: [{ currency: 'KES', totalMinor: 100000 }, { currency: 'EUR', totalMinor: 1250 }] }),
      row({ id: 'c2', orderCount: 0, spent: [], lastOrderAt: null, marketingConsent: false, consentUpdatedAt: null, consentSource: null }),
    ])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[1]).toContain(',1000.00 KES; 12.50 EUR,KES; EUR,')
    expect(lines[2]).toContain(',0,,,,no,,,')
  })

  it('neutralises spreadsheet formulas and quotes commas', () => {
    const csv = customersCsv([row({ name: '=HYPERLINK("x")', email: null }), row({ name: 'Njoroge, Grace' })])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[1].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true)
    expect(lines[2].startsWith('"Njoroge, Grace"')).toBe(true)
  })
})
