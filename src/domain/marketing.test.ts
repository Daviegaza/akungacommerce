import { describe, expect, it } from 'vitest'
import {
  canExportCustomers,
  canMarketTo,
  canSendServiceMessage,
  cooldownDaysLeft,
  customerStats,
  marketingMessage,
  segmentCustomers,
  STOP_LINE,
  type StatsCustomer,
  type StatsOrder,
} from './marketing'

const NOW = Date.parse('2026-11-20T09:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function customer(id: string, name: string, consent: boolean, phone: string | null = '+254712000' + id.padStart(3, '0')): StatsCustomer {
  return { id, name, phoneE164: phone, email: null, marketingConsent: consent, consentUpdatedAt: null, consentSource: null }
}
function order(customerId: string | null, days: number, totalMinor: number, status = 'delivered', currency = 'KES'): StatsOrder {
  return { customerId, status, currency, totalMinor, createdAt: daysAgo(days) }
}

describe('consent rules', () => {
  it('only consenting customers with a valid phone can get marketing', () => {
    expect(canMarketTo({ marketingConsent: true, phoneE164: '+254712345678' })).toBe(true)
    expect(canMarketTo({ marketingConsent: false, phoneE164: '+254712345678' })).toBe(false)
    expect(canMarketTo({ marketingConsent: true, phoneE164: null })).toBe(false)
    expect(canMarketTo({ marketingConsent: true, phoneE164: '0712345678' })).toBe(false)
  })
  it('service messages about orders never need marketing consent', () => {
    expect(canSendServiceMessage({ phoneE164: '+254712345678' })).toBe(true)
    expect(canSendServiceMessage({ phoneE164: null })).toBe(false)
  })
  it('allows one offer per customer per 7 days', () => {
    expect(cooldownDaysLeft(null, NOW)).toBe(0)
    expect(cooldownDaysLeft(daysAgo(1), NOW)).toBe(6)
    expect(cooldownDaysLeft(daysAgo(6.5), NOW)).toBe(1)
    expect(cooldownDaysLeft(daysAgo(7), NOW)).toBe(0)
  })
  it('export is limited to owners, admins and managers', () => {
    expect(canExportCustomers('owner')).toBe(true)
    expect(canExportCustomers('admin')).toBe(true)
    expect(canExportCustomers('manager')).toBe(true)
    expect(canExportCustomers('sales')).toBe(false)
    expect(canExportCustomers('fulfilment')).toBe(false)
    expect(canExportCustomers('analyst')).toBe(false)
    expect(canExportCustomers(null)).toBe(false)
  })
})

describe('customer statistics', () => {
  it('counts orders and spend per currency, skipping drafts and cancelled orders', () => {
    const stats = customerStats([
      order('a', 10, 1000),
      order('a', 5, 2500, 'confirmed'),
      order('a', 1, 9999, 'draft'),
      order('a', 2, 9999, 'cancelled'),
      order('a', 3, 700, 'delivered', 'EUR'),
      order(null, 1, 5000),
    ])
    const a = stats.get('a')!
    expect(a.orderCount).toBe(3)
    expect(a.spent).toEqual([
      { currency: 'KES', totalMinor: 3500 },
      { currency: 'EUR', totalMinor: 700 },
    ])
    expect(a.lastOrderAt).toBe(daysAgo(3))
    expect(stats.size).toBe(1)
  })
})

describe('segments', () => {
  const customers = [
    customer('1', 'Amina Wekesa', true),
    customer('2', 'Kevin Mutua', false),
    customer('3', 'Grace Njoroge', true),
    customer('4', 'David Kiprop', true, null),
    customer('5', 'Fatuma Ali', true),
  ]
  const stats = customerStats([
    order('1', 10, 5000),
    order('2', 20, 90000),
    order('3', 120, 30000),
    order('4', 5, 1000),
    order('5', 70, 100),
  ])
  const opts = { nowMs: NOW, baseCurrency: 'KES' }

  it('recent buyers: last 90 days, consenting only, newest first', () => {
    const r = segmentCustomers('recent', customers, stats, opts)
    expect(r.members.map((m) => m.customer.id)).toEqual(['1', '5'])
    // Kevin (no consent) and David (no phone) fit the rule but are never listed.
    expect(r.excludedNoConsent).toBe(2)
  })

  it('lapsed: ordered before but not in 60 days', () => {
    const r = segmentCustomers('lapsed', customers, stats, opts)
    expect(r.members.map((m) => m.customer.id)).toEqual(['5', '3'])
    expect(r.excludedNoConsent).toBe(0)
  })

  it('top spenders in the base currency, never selecting non-consenting customers', () => {
    const r = segmentCustomers('top', customers, stats, opts)
    expect(r.members.map((m) => m.customer.id)).toEqual(['3', '1', '5'])
    expect(r.members.some((m) => !m.customer.marketingConsent)).toBe(false)
    expect(r.excludedNoConsent).toBe(2)
  })

  it('customers without orders are in no segment', () => {
    const r = segmentCustomers('recent', [customer('9', 'New Person', true)], stats, opts)
    expect(r.members).toEqual([])
  })
})

describe('marketing message', () => {
  it('fills the template and always appends the opt-out line', () => {
    const m = marketingMessage('Hi {name}, new mugs at {shop}!', 'Amina Wekesa', 'Mto Home')
    expect(m).toBe(`Hi Amina, new mugs at Mto Home!\n\n${STOP_LINE}`)
  })
  it('does not duplicate an opt-out line the merchant already wrote', () => {
    const m = marketingMessage('Hi {name}. Reply STOP to opt out.', 'Kevin', 'Mto Home')
    expect(m.match(/stop/gi)?.length).toBe(1)
  })
  it('falls back to "there" without a name', () => {
    expect(marketingMessage('Hi {name}', '  ', 'Shop')).toContain('Hi there')
  })
})
