import { describe, expect, it } from 'vitest'
import { computeOrderTotals } from './orders'
import {
  DEFAULT_SHOP_POLICY,
  PolicyError,
  amountsDue,
  applyFailedDelivery,
  computeDeposit,
  isWellFormedRiderToken,
  maskPhone,
  policyText,
  riderLinkHours,
  riderLinkState,
  roundUpToWholeMajor,
  validateShopPolicy,
  type ShopPolicy,
} from './delivery-policy'

const deposit30: ShopPolicy = { ...DEFAULT_SHOP_POLICY, paymentMode: 'deposit', depositKind: 'percent', depositPercentBps: 3000, depositCoversDelivery: false }

describe('roundUpToWholeMajor', () => {
  it('rounds up to whole units using the currency minor unit', () => {
    expect(roundUpToWholeMajor(0, 'KES')).toBe(0)
    expect(roundUpToWholeMajor(1, 'KES')).toBe(100)
    expect(roundUpToWholeMajor(100, 'KES')).toBe(100)
    expect(roundUpToWholeMajor(45_001, 'KES')).toBe(45_100)
    expect(roundUpToWholeMajor(1, 'JPY')).toBe(1) // no minor unit
    expect(roundUpToWholeMajor(1_001, 'KWD')).toBe(2_000) // 3 decimals
  })
  it('rejects fractions and negatives', () => {
    expect(() => roundUpToWholeMajor(1.5, 'KES')).toThrow(PolicyError)
    expect(() => roundUpToWholeMajor(-1, 'KES')).toThrow(PolicyError)
  })
})

describe('computeDeposit', () => {
  it('pay on delivery: nothing due now', () => {
    expect(computeDeposit(DEFAULT_SHOP_POLICY, { totalMinor: 250_000, deliveryFeeMinor: 20_000, currency: 'KES' })).toEqual({
      depositDueMinor: 0,
      balanceOnDeliveryMinor: 250_000,
      rule: 'none',
    })
  })

  it('full prepay: the whole all-in total is due now', () => {
    const p = { ...DEFAULT_SHOP_POLICY, paymentMode: 'full_prepay' as const }
    expect(computeDeposit(p, { totalMinor: 123_456, deliveryFeeMinor: 0, currency: 'KES' })).toEqual({
      depositDueMinor: 123_456,
      balanceOnDeliveryMinor: 0,
      rule: 'full',
    })
  })

  it('percent deposit rounds up to a whole shilling and the parts add up to the total', () => {
    // 30% of KSh 1,234.56 = 370.368 -> KSh 371.00
    const d = computeDeposit(deposit30, { totalMinor: 123_456, deliveryFeeMinor: 0, currency: 'KES' })
    expect(d).toEqual({ depositDueMinor: 37_100, balanceOnDeliveryMinor: 86_356, rule: 'deposit' })
    expect(d.depositDueMinor + d.balanceOnDeliveryMinor).toBe(123_456)
  })

  it('works on the all-in total for both exclusive and inclusive tax', () => {
    const line = { unitPriceMinor: 150_000, quantity: 1, taxRateBps: 1600, discountMinor: 0, currency: 'KES' }
    const excl = computeOrderTotals({ currency: 'KES', taxMode: 'exclusive', deliveryFeeMinor: 15_000, lines: [line] })
    const incl = computeOrderTotals({ currency: 'KES', taxMode: 'inclusive', deliveryFeeMinor: 15_000, lines: [line] })
    expect(excl.totalMinor).toBe(189_000) // 1500 + 16% tax + 150 delivery
    expect(incl.totalMinor).toBe(165_000) // tax already inside the price
    expect(computeDeposit(deposit30, { totalMinor: excl.totalMinor, deliveryFeeMinor: 15_000, currency: 'KES' }).depositDueMinor).toBe(56_700)
    expect(computeDeposit(deposit30, { totalMinor: incl.totalMinor, deliveryFeeMinor: 15_000, currency: 'KES' }).depositDueMinor).toBe(49_500)
  })

  it('applies only at or above the minimum order value', () => {
    const p = { ...deposit30, depositMinOrderMinor: 200_000 }
    expect(computeDeposit(p, { totalMinor: 199_999, deliveryFeeMinor: 0, currency: 'KES' })).toMatchObject({ depositDueMinor: 0, rule: 'below_threshold' })
    expect(computeDeposit(p, { totalMinor: 200_000, deliveryFeeMinor: 0, currency: 'KES' })).toMatchObject({ depositDueMinor: 60_000, rule: 'deposit' })
  })

  it('fixed deposit is capped at the total', () => {
    const p = { ...deposit30, depositKind: 'fixed' as const, depositFixedMinor: 50_000 }
    expect(computeDeposit(p, { totalMinor: 300_000, deliveryFeeMinor: 0, currency: 'KES' }).depositDueMinor).toBe(50_000)
    expect(computeDeposit(p, { totalMinor: 30_000, deliveryFeeMinor: 0, currency: 'KES' })).toEqual({
      depositDueMinor: 30_000,
      balanceOnDeliveryMinor: 0,
      rule: 'full',
    })
  })

  it('can be raised to cover the delivery fee', () => {
    const p = { ...deposit30, depositPercentBps: 1000, depositCoversDelivery: true }
    // 10% of 1,200 = 120 < 300 delivery fee
    expect(computeDeposit(p, { totalMinor: 120_000, deliveryFeeMinor: 30_000, currency: 'KES' }).depositDueMinor).toBe(30_000)
  })

  it('handles zero-decimal and three-decimal currencies', () => {
    expect(computeDeposit(deposit30, { totalMinor: 3_333, deliveryFeeMinor: 0, currency: 'JPY' }).depositDueMinor).toBe(1_000)
    // 30% of 10.001 KWD = 3.0003 -> 4.000 KWD
    expect(computeDeposit(deposit30, { totalMinor: 10_001, deliveryFeeMinor: 0, currency: 'KWD' }).depositDueMinor).toBe(4_000)
  })

  it('rejects non-integer amounts', () => {
    expect(() => computeDeposit(deposit30, { totalMinor: 10.5, deliveryFeeMinor: 0, currency: 'KES' })).toThrow(PolicyError)
  })
})

describe('amountsDue', () => {
  it('charges the unpaid deposit first, then the balance', () => {
    expect(amountsDue({ totalMinor: 100_000, depositDueMinor: 30_000, netPaidMinor: 0 })).toEqual({
      depositPaidMinor: 0,
      depositOutstandingMinor: 30_000,
      balanceDueMinor: 100_000,
      dueNowMinor: 30_000,
    })
    expect(amountsDue({ totalMinor: 100_000, depositDueMinor: 30_000, netPaidMinor: 10_000 }).dueNowMinor).toBe(20_000)
    expect(amountsDue({ totalMinor: 100_000, depositDueMinor: 30_000, netPaidMinor: 30_000 })).toMatchObject({
      depositPaidMinor: 30_000,
      depositOutstandingMinor: 0,
      balanceDueMinor: 70_000,
      dueNowMinor: 70_000,
    })
  })
  it('never goes negative after overpayment or refunds', () => {
    expect(amountsDue({ totalMinor: 100_000, depositDueMinor: 0, netPaidMinor: 120_000 })).toMatchObject({ balanceDueMinor: 0, dueNowMinor: 0 })
    expect(amountsDue({ totalMinor: 100_000, depositDueMinor: 30_000, netPaidMinor: -5 })).toMatchObject({ depositPaidMinor: 0, dueNowMinor: 30_000 })
  })
})

describe('applyFailedDelivery', () => {
  const base = {
    agreedPolicy: { failedDeliveryPayer: 'buyer' as const },
    maxAttempts: 2,
    attemptsSoFar: 0,
    reason: 'buyer_unreachable' as const,
    deliveryFeeMinor: 20_000,
    depositPaidMinor: 50_000,
    forfeitedSoFarMinor: 0,
  }

  it('keeps the delivery fee from the deposit when the buyer is at fault', () => {
    expect(applyFailedDelivery(base)).toEqual({ attempt: 1, forfeitMinor: 20_000, final: false })
  })

  it('never keeps more than the deposit that is left', () => {
    expect(applyFailedDelivery({ ...base, attemptsSoFar: 1, depositPaidMinor: 30_000, forfeitedSoFarMinor: 20_000 })).toEqual({
      attempt: 2,
      forfeitMinor: 10_000,
      final: true,
    })
    expect(applyFailedDelivery({ ...base, depositPaidMinor: 0 }).forfeitMinor).toBe(0)
  })

  it('keeps nothing when the shop absorbs failed trips, when the failure is the shop’s, or with no agreed policy', () => {
    expect(applyFailedDelivery({ ...base, agreedPolicy: { failedDeliveryPayer: 'seller' } }).forfeitMinor).toBe(0)
    expect(applyFailedDelivery({ ...base, reason: 'rider_issue' }).forfeitMinor).toBe(0)
    expect(applyFailedDelivery({ ...base, reason: 'shop_issue' }).forfeitMinor).toBe(0)
    expect(applyFailedDelivery({ ...base, agreedPolicy: null }).forfeitMinor).toBe(0)
  })

  it('refuses once all attempts are used', () => {
    expect(() => applyFailedDelivery({ ...base, attemptsSoFar: 2 })).toThrow(/All 2 delivery attempts/)
    expect(() => applyFailedDelivery({ ...base, reason: 'nope' as never })).toThrow(PolicyError)
  })
})

describe('validateShopPolicy', () => {
  it('accepts the default and rejects out-of-range values', () => {
    expect(validateShopPolicy(DEFAULT_SHOP_POLICY)).toEqual({})
    expect(validateShopPolicy({ ...DEFAULT_SHOP_POLICY, depositPercentBps: 50 })).toHaveProperty('depositPercentBps')
    expect(validateShopPolicy({ ...DEFAULT_SHOP_POLICY, maxDeliveryAttempts: 0 })).toHaveProperty('maxDeliveryAttempts')
    expect(validateShopPolicy({ ...DEFAULT_SHOP_POLICY, maxDeliveryAttempts: 6 })).toHaveProperty('maxDeliveryAttempts')
    expect(validateShopPolicy({ ...DEFAULT_SHOP_POLICY, paymentMode: 'deposit', depositKind: 'fixed', depositFixedMinor: 0 })).toHaveProperty(
      'depositFixedMinor',
    )
    expect(validateShopPolicy({ ...DEFAULT_SHOP_POLICY, depositMinOrderMinor: 1.5 })).toHaveProperty('depositMinOrderMinor')
  })
})

describe('policyText', () => {
  it('describes deposit, threshold and failed-delivery rules in plain words', () => {
    const lines = policyText(
      { ...deposit30, depositMinOrderMinor: 200_000, depositCoversDelivery: true, failedDeliveryPayer: 'buyer', maxDeliveryAttempts: 2 },
      { currency: 'KES', locale: 'en-KE', delivers: true },
    )
    expect(lines[0]).toMatch(/30% deposit \(at least the delivery fee\) is due when you order on orders of Ksh\s?2,000\.00 or more/)
    expect(lines.join(' ')).toMatch(/delivery fee for that trip is kept from your deposit/)
    expect(lines.join(' ')).toMatch(/up to 2 delivery attempts/)
    expect(lines.join(' ')).toMatch(/never cost you anything/)
  })
  it('promises nothing is kept when the shop absorbs failed trips, and skips delivery lines for pickup-only shops', () => {
    expect(policyText(DEFAULT_SHOP_POLICY, { currency: 'EUR', locale: 'de-DE', delivers: true }).join(' ')).toMatch(/shop pays for the return trip/)
    expect(policyText(DEFAULT_SHOP_POLICY, { currency: 'EUR', locale: 'de-DE', delivers: false })).toHaveLength(1)
  })
})

describe('rider links', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  it('are active until they expire or are revoked', () => {
    expect(riderLinkState({ expiresAt: '2026-11-20T10:00:01Z', revokedAt: null }, now)).toBe('active')
    expect(riderLinkState({ expiresAt: '2026-11-20T10:00:00Z', revokedAt: null }, now)).toBe('expired')
    expect(riderLinkState({ expiresAt: '2026-11-21T10:00:00Z', revokedAt: '2026-11-20T09:00:00Z' }, now)).toBe('revoked')
    expect(riderLinkState({ expiresAt: 'not a date', revokedAt: null }, now)).toBe('expired')
    expect(riderLinkState(null, now)).toBe('invalid')
  })
  it('only accept long base64url tokens', () => {
    expect(isWellFormedRiderToken('a'.repeat(32))).toBe(true)
    expect(isWellFormedRiderToken('Ab0-_'.repeat(7))).toBe(true)
    expect(isWellFormedRiderToken('short')).toBe(false)
    expect(isWellFormedRiderToken('a'.repeat(31) + '/')).toBe(false)
    expect(isWellFormedRiderToken(null)).toBe(false)
  })
  it('clamp lifetimes to 1–72 hours', () => {
    expect(riderLinkHours(undefined)).toBe(12)
    expect(riderLinkHours(0)).toBe(1)
    expect(riderLinkHours(500)).toBe(72)
    expect(riderLinkHours(5.6)).toBe(6)
  })
  it('mask the buyer phone to the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('••• ••• 678')
    expect(maskPhone('+15551234567')).toBe('••• ••• 567')
    expect(maskPhone(null)).toBeNull()
  })
})
