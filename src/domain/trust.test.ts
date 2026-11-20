import { describe, expect, it } from 'vitest'
import {
  businessNamesMatch,
  completedOrdersLabel,
  maskReceipt,
  normaliseBusinessName,
  onRafuSinceLabel,
  publicCompletedOrders,
  trustBadges,
  type ShopTrustFacts,
} from './trust'

const NONE: ShopTrustFacts = { phoneVerified: false, mpesaName: null, documentsApproved: false, onRafuSince: '2026-03-02T08:00:00Z', completedOrders: null }

describe('business name matching', () => {
  it('ignores case, punctuation, spacing, accents and the shortcode prefix', () => {
    expect(normaliseBusinessName('5123456 - Mto Home Ltd.')).toBe('MTO HOME LIMITED')
    expect(businessNamesMatch('5123456 - MTO HOME LTD', 'Mto  Home Limited')).toBe(true)
    expect(businessNamesMatch('Café Njeri', 'CAFE NJERI')).toBe(true)
    expect(businessNamesMatch('Jua & Sons Enterprises', 'JUA AND SONS ENT')).toBe(true)
  })

  it('does not match different names, empty names or near misses', () => {
    expect(businessNamesMatch('MTO HOME', 'MTO HOMES')).toBe(false)
    expect(businessNamesMatch('MTO HOME', null)).toBe(false)
    expect(businessNamesMatch('', '')).toBe(false)
    expect(businessNamesMatch('A', 'A')).toBe(false)
    // A shortcode alone is never a name.
    expect(businessNamesMatch('5123456 -', '5123456 -')).toBe(false)
  })
})

describe('receipt masking', () => {
  it('keeps the first 3 and last 2 characters', () => {
    expect(maskReceipt('SJK4H7Q2P1')).toBe('SJK•••••P1')
    expect(maskReceipt(' sjk4h7q2p1 ')).toBe('SJK•••••P1')
    expect(maskReceipt('ABCDEFGH')).toBe('ABC•••GH')
  })
  it('hides very short codes completely', () => {
    expect(maskReceipt('ABCDE')).toBe('•••••')
    expect(maskReceipt(null)).toBe('')
  })
})

describe('trust badges', () => {
  it('shows nothing the server did not confirm', () => {
    expect(trustBadges(NONE, 'Mto Home')).toEqual([])
  })

  it('explains each earned badge plainly, strongest first', () => {
    const badges = trustBadges({ ...NONE, phoneVerified: true, mpesaName: 'MTO HOME LIMITED', documentsApproved: true }, 'Mto Home')
    expect(badges.map((b) => b.id)).toEqual(['mpesa_name', 'documents', 'phone'])
    expect(badges[0].explanation).toContain('Payments go to the M-Pesa business name MTO HOME LIMITED')
    expect(badges[1].explanation).toContain('Rafu reviewer approved')
  })
})

describe('shop age and completed orders', () => {
  it('hides exact counts below 5', () => {
    expect(publicCompletedOrders(0)).toBeNull()
    expect(publicCompletedOrders(4)).toBeNull()
    expect(publicCompletedOrders(5)).toBe(5)
    expect(completedOrdersLabel(null)).toBe('Fewer than 5 completed orders so far')
    expect(completedOrdersLabel(1234)).toBe('1,234 completed orders')
  })
  it('formats "on Rafu since" as month and year', () => {
    expect(onRafuSinceLabel('2026-03-02T08:00:00Z', 'en-KE', 'Africa/Nairobi')).toBe('March 2026')
    expect(onRafuSinceLabel('not a date')).toBe('')
  })
})
