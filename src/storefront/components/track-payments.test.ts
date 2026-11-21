import { describe, expect, it } from 'vitest'
import { attachPaymentEvents, paymentSourceText } from './track-payments'
import { mapTrackBankTransfer, mapTrackPayments } from '@/gateway/payments-track'
import type { TrackedPaymentEvent } from '@/gateway/storefront'

const pay = (receivedAt: string, amountMinor = 50_000, over: Partial<TrackedPaymentEvent> = {}): TrackedPaymentEvent => ({
  amountMinor,
  currency: 'KES',
  method: 'mobile_money',
  verified: true,
  receivedAt,
  ...over,
})

describe('attachPaymentEvents', () => {
  const steps = [
    { key: 'pending_confirmation', at: '2026-11-20T08:00:00Z' },
    { key: 'confirmed', at: '2026-11-20T09:00:00Z' },
    { key: 'preparing', at: null },
    { key: 'ready', at: null },
  ]
  it('puts each payment under the step that was current when it arrived, without touching step times', () => {
    const before = JSON.stringify(steps)
    const m = attachPaymentEvents(steps, [pay('2026-11-20T09:30:00Z', 20_000), pay('2026-11-20T08:10:00Z', 10_000)])
    expect(m.get('pending_confirmation')?.map((p) => p.amountMinor)).toEqual([10_000])
    expect(m.get('confirmed')?.map((p) => p.amountMinor)).toEqual([20_000])
    expect(m.has('preparing')).toBe(false)
    expect(JSON.stringify(steps)).toBe(before)
  })
  it('a payment at the exact confirmation time belongs to that step; earlier than any step goes to the first', () => {
    const m = attachPaymentEvents(steps, [pay('2026-11-20T09:00:00Z'), pay('2026-11-20T07:00:00Z', 1)])
    expect(m.get('confirmed')).toHaveLength(1)
    expect(m.get('pending_confirmation')?.[0].amountMinor).toBe(1)
  })
  it('handles no payments and no steps', () => {
    expect(attachPaymentEvents(steps, []).size).toBe(0)
    expect(attachPaymentEvents([], [pay('2026-11-20T09:00:00Z')]).size).toBe(0)
  })
})

describe('paymentSourceText', () => {
  it('never claims provider confirmation for a manual payment', () => {
    expect(paymentSourceText({ method: 'mobile_money', verified: true })).toBe('confirmed by M-Pesa')
    expect(paymentSourceText({ method: 'bank_transfer', verified: true })).toBe('confirmed by the bank transfer provider')
    expect(paymentSourceText({ method: 'mobile_money', verified: false })).toBe('recorded by the shop')
  })
})

describe('tracking RPC mappers', () => {
  it('maps storefront_track_payments rows and drops malformed ones', () => {
    expect(
      mapTrackPayments([
        { amount_minor: 50000, currency: 'KES', method: 'mobile_money', verified: true, received_at: '2026-11-20T09:00:00Z' },
        { amount_minor: 'x', received_at: '2026-11-20T09:00:00Z' },
        null,
      ]),
    ).toEqual([{ amountMinor: 50000, currency: 'KES', method: 'mobile_money', verified: true, receivedAt: '2026-11-20T09:00:00Z' }])
    expect(mapTrackPayments(null)).toEqual([])
  })
  it('maps storefront_bank_transfer, accepting only 10-digit NUBANs', () => {
    expect(mapTrackBankTransfer(null)).toBeNull()
    expect(
      mapTrackBankTransfer({
        provider: 'paystack_dva',
        account: { bank_name: 'Wema Bank', account_number: '9930012345', account_name: 'Shop / Fungua' },
        due_now_minor: 2450000,
        reference: 1042,
      }),
    ).toEqual({
      provider: 'paystack_dva',
      account: { bankName: 'Wema Bank', accountNumber: '9930012345', accountName: 'Shop / Fungua' },
      dueNowMinor: 2450000,
      reference: 1042,
      simulated: false,
    })
    expect(mapTrackBankTransfer({ provider: 'none', account: { bank_name: 'X', account_number: '123' }, due_now_minor: 5, reference: 1 })).toMatchObject({
      provider: null,
      account: null,
    })
  })
})
