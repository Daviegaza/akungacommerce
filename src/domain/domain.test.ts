import { describe, expect, it } from 'vitest'
import {
  CurrencyMismatchError,
  add,
  applyBasisPoints,
  currencyExponent,
  divRoundHalfUp,
  formatMoney,
  money,
  parseMajor,
  toMajorString,
  totalsByCurrency,
} from './money'
import { canTransition, computeOrderTotals, holdsReservation } from './orders'
import { refundableMinor, summarisePayments, validateRefund, type PaymentRecord } from './payments'
import { adjust, commit, release, reserve, stockHealth } from './inventory'
import { businessDate, formatDateTime, isValidTimezone, toE164 } from './locale'
import { can } from './permissions'

describe('money', () => {
  it('uses ISO 4217 minor units per currency', () => {
    expect(currencyExponent('USD')).toBe(2)
    expect(currencyExponent('JPY')).toBe(0)
    expect(currencyExponent('KWD')).toBe(3)
    expect(currencyExponent('KES')).toBe(2)
  })

  it('parses decimal input exactly without floating point', () => {
    expect(parseMajor('0.1', 'USD').amountMinor).toBe(10)
    expect(parseMajor('19.99', 'EUR').amountMinor).toBe(1999)
    expect(parseMajor('1,250.5', 'KES').amountMinor).toBe(125050)
    expect(parseMajor('1500', 'JPY').amountMinor).toBe(1500)
    expect(parseMajor('1.234', 'KWD').amountMinor).toBe(1234)
    expect(() => parseMajor('1.5', 'JPY')).toThrow(/no minor unit/)
    expect(() => parseMajor('1.999', 'USD')).toThrow(/at most 2/)
    expect(() => parseMajor('abc', 'USD')).toThrow()
  })

  it('round-trips to major strings', () => {
    expect(toMajorString(money(5, 'USD'))).toBe('0.05')
    expect(toMajorString(money(-1999, 'GBP'))).toBe('-19.99')
    expect(toMajorString(money(1500, 'JPY'))).toBe('1500')
  })

  it('never combines unlike currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow(CurrencyMismatchError)
    const totals = totalsByCurrency([money(100, 'USD'), money(250, 'KES'), money(50, 'USD')])
    expect(totals.get('USD')?.amountMinor).toBe(150)
    expect(totals.get('KES')?.amountMinor).toBe(250)
    expect(totals.size).toBe(2)
  })

  it('rounds half away from zero with integer arithmetic', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3)
    expect(divRoundHalfUp(-5, 2)).toBe(-3)
    expect(divRoundHalfUp(4, 3)).toBe(1)
    expect(applyBasisPoints(money(333, 'USD'), 1600).amountMinor).toBe(53) // 53.28
    expect(applyBasisPoints(money(125, 'USD'), 2000).amountMinor).toBe(25)
  })

  it('formats for three regions with the right symbol and decimals', () => {
    expect(formatMoney(money(123456, 'KES'), 'en-KE')).toMatch(/1,234\.56/)
    expect(formatMoney(money(123456, 'EUR'), 'de-DE')).toMatch(/1\.234,56/)
    expect(formatMoney(money(123456, 'JPY'), 'ja-JP')).toMatch(/123,456/)
    expect(formatMoney(money(123456, 'JPY'), 'ja-JP')).not.toMatch(/\./)
  })

  it('rejects non-integer amounts and bad codes', () => {
    expect(() => money(1.5, 'USD')).toThrow()
    expect(() => money(1, 'usd')).toThrow()
  })
})

describe('order totals', () => {
  it('computes exclusive tax per line plus delivery', () => {
    const t = computeOrderTotals({
      currency: 'KES',
      taxMode: 'exclusive',
      deliveryFeeMinor: 20000,
      lines: [
        { unitPriceMinor: 150000, quantity: 2, taxRateBps: 1600, currency: 'KES' },
        { unitPriceMinor: 99900, quantity: 1, taxRateBps: 0, discountMinor: 9900, currency: 'KES' },
      ],
    })
    expect(t.subtotalMinor).toBe(300000 + 90000)
    expect(t.taxMinor).toBe(48000)
    expect(t.discountMinor).toBe(9900)
    expect(t.totalMinor).toBe(390000 + 48000 + 20000)
  })

  it('extracts inclusive tax without changing the total', () => {
    const t = computeOrderTotals({
      currency: 'EUR',
      taxMode: 'inclusive',
      lines: [{ unitPriceMinor: 1190, quantity: 1, taxRateBps: 1900, currency: 'EUR' }],
    })
    expect(t.totalMinor).toBe(1190)
    expect(t.taxMinor).toBe(190)
  })

  it('refuses mixed currencies, empty orders and over-discounting', () => {
    expect(() =>
      computeOrderTotals({ currency: 'USD', taxMode: 'exclusive', lines: [{ unitPriceMinor: 1, quantity: 1, taxRateBps: 0, currency: 'EUR' }] }),
    ).toThrow(CurrencyMismatchError)
    expect(() => computeOrderTotals({ currency: 'USD', taxMode: 'exclusive', lines: [] })).toThrow()
    expect(() =>
      computeOrderTotals({ currency: 'USD', taxMode: 'exclusive', lines: [{ unitPriceMinor: 100, quantity: 1, taxRateBps: 0, discountMinor: 101, currency: 'USD' }] }),
    ).toThrow(/exceed/)
    expect(() =>
      computeOrderTotals({ currency: 'USD', taxMode: 'exclusive', lines: [{ unitPriceMinor: 100, quantity: 0, taxRateBps: 0, currency: 'USD' }] }),
    ).toThrow(/at least 1/)
  })

  it('follows the status state machine', () => {
    expect(canTransition('confirmed', 'preparing')).toBe(true)
    expect(canTransition('confirmed', 'delivered')).toBe(false)
    expect(canTransition('dispatched', 'cancelled')).toBe(false)
    expect(canTransition('delivered', 'refunded')).toBe(false) // automatic only
    expect(holdsReservation('ready')).toBe(true)
    expect(holdsReservation('draft')).toBe(false)
  })
})

describe('payments and refunds', () => {
  const pay = (id: string, amount: number, extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
    id, amountMinor: amount, currency: 'USD', status: 'succeeded', verification: 'manual_unverified', ...extra,
  })

  it('summarises paid, unverified, refunded and balance', () => {
    const s = summarisePayments({ totalMinor: 10000, currency: 'USD' }, [pay('a', 6000), pay('b', 4000, { verification: 'provider_verified' }), pay('c', 999, { status: 'failed' })], [])
    expect(s.state).toBe('paid')
    expect(s.paidUnverifiedMinor).toBe(6000)
    expect(s.balanceDueMinor).toBe(0)
    const partial = summarisePayments({ totalMinor: 10000, currency: 'USD' }, [pay('a', 2500)], [])
    expect(partial.state).toBe('partially_paid')
    expect(partial.balanceDueMinor).toBe(7500)
    const refunded = summarisePayments({ totalMinor: 10000, currency: 'USD' }, [pay('a', 10000)], [{ id: 'r', paymentId: 'a', amountMinor: 10000, currency: 'USD', status: 'succeeded' }])
    expect(refunded.state).toBe('refunded')
  })

  it('limits refunds to what remains on the payment, in the same currency', () => {
    const p = pay('a', 5000)
    const refunds = [{ id: 'r1', paymentId: 'a', amountMinor: 2000, currency: 'USD', status: 'succeeded' as const }]
    expect(refundableMinor(p, refunds)).toBe(3000)
    expect(() => validateRefund(p, refunds, 3001, 'USD')).toThrow(/exceeds/)
    expect(() => validateRefund(p, refunds, 100, 'EUR')).toThrow(CurrencyMismatchError)
    expect(() => validateRefund(p, refunds, 0, 'USD')).toThrow()
    expect(() => validateRefund(p, refunds, 3000, 'USD')).not.toThrow()
  })
})

describe('inventory', () => {
  it('reserves, releases and commits without going negative', () => {
    let l = { onHand: 5, reserved: 0 }
    l = reserve(l, 3)
    expect(l).toEqual({ onHand: 5, reserved: 3 })
    expect(() => reserve(l, 3)).toThrow(/Only 2 available/)
    l = commit(l, 2)
    expect(l).toEqual({ onHand: 3, reserved: 1 })
    l = release(l, 1)
    expect(l).toEqual({ onHand: 3, reserved: 0 })
    expect(() => release(l, 1)).toThrow()
  })

  it('does not let adjustments eat into reserved stock', () => {
    expect(() => adjust({ onHand: 5, reserved: 4 }, -2)).toThrow(/reserved/)
    expect(() => adjust({ onHand: 1, reserved: 0 }, -2)).toThrow(/below zero/)
    expect(adjust({ onHand: 1, reserved: 0 }, 4)).toEqual({ onHand: 5, reserved: 0 })
  })

  it('classifies stock health', () => {
    expect(stockHealth({ onHand: 2, reserved: 2 }, 3)).toBe('out')
    expect(stockHealth({ onHand: 5, reserved: 2 }, 3)).toBe('low')
    expect(stockHealth({ onHand: 10, reserved: 0 }, 3)).toBe('ok')
  })
})

describe('locale, phone and time', () => {
  it('normalises international phone numbers to E.164', () => {
    expect(toE164('0712 345678', 'KE')).toEqual({ ok: true, e164: '+254712345678' })
    expect(toE164('020 7946 0958', 'GB')).toEqual({ ok: true, e164: '+442079460958' })
    expect(toE164('+1 212 555 0123')).toEqual({ ok: true, e164: '+12125550123' })
    expect(toE164('12', 'US').ok).toBe(false)
  })

  it('renders UTC instants in the business time zone', () => {
    const utc = '2026-03-01T22:30:00Z'
    expect(businessDate(utc, 'Africa/Nairobi')).toBe('2026-03-02')
    expect(businessDate(utc, 'America/New_York')).toBe('2026-03-01')
    expect(businessDate(utc, 'Asia/Tokyo')).toBe('2026-03-02')
    expect(formatDateTime(utc, 'de-DE', 'Europe/Berlin')).toMatch(/23:30/)
    expect(isValidTimezone('Africa/Lagos')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
  })

  it('applies the role matrix', () => {
    expect(can('analyst', 'orders.create')).toBe(false)
    expect(can('sales', 'cost.read')).toBe(false)
    expect(can('manager', 'refunds.create')).toBe(true)
    expect(can(null, 'orders.create')).toBe(false)
  })
})
