import { describe, expect, it } from 'vitest'
import { flutterwaveVaAdapter, parsePaystackDvaCharge, paystackDvaAdapter, resolveBankTransferAdapter, verifyFlutterwaveHash } from './bank-transfer.ts'
import { hmacSha512Hex } from './signatures.ts'

const SECRET = 'sk_test_not_a_real_key'

function dvaCharge(over: Record<string, unknown> = {}) {
  return {
    event: 'charge.success',
    data: {
      status: 'success',
      reference: 'T123456789',
      amount: 1500000,
      currency: 'NGN',
      paid_at: '2026-11-20T09:00:00.000Z',
      customer: { customer_code: 'CUS_abc123' },
      authorization: {
        channel: 'dedicated_nuban',
        receiver_bank_account_number: '9930000000',
        sender_bank_account_number: '0123456789',
      },
      ...over,
    },
  }
}

describe('Paystack dedicated virtual accounts', () => {
  it('verifies x-paystack-signature (HMAC SHA512 of the raw body)', async () => {
    const raw = JSON.stringify(dvaCharge())
    const sig = await hmacSha512Hex(SECRET, raw)
    const ok = await paystackDvaAdapter.verifyWebhook(raw, new Headers({ 'x-paystack-signature': sig }), SECRET)
    expect(ok).toEqual({ ok: true })
    const tampered = await paystackDvaAdapter.verifyWebhook(raw.replace('1500000', '9500000'), new Headers({ 'x-paystack-signature': sig }), SECRET)
    expect(tampered.ok).toBe(false)
    const missing = await paystackDvaAdapter.verifyWebhook(raw, new Headers(), SECRET)
    expect(missing.ok).toBe(false)
    expect((await paystackDvaAdapter.verifyWebhook(raw, new Headers({ 'x-paystack-signature': sig }), '')).ok).toBe(false)
  })

  it('parses a dedicated_nuban charge.success into a credit without storing full account numbers', () => {
    expect(parsePaystackDvaCharge(dvaCharge())).toEqual({
      provider: 'paystack_dva',
      reference: 'T123456789',
      amountMinor: 1500000,
      currency: 'NGN',
      receiverAccountNumber: '9930000000',
      senderHint: '6789',
      customerRef: 'CUS_abc123',
      paidAt: '2026-11-20T09:00:00.000Z',
    })
  })

  it('ignores anything that is not a successful NGN dedicated-account credit', () => {
    expect(parsePaystackDvaCharge({ event: 'transfer.success', data: {} })).toBeNull()
    expect(parsePaystackDvaCharge(dvaCharge({ status: 'failed' }))).toBeNull()
    expect(parsePaystackDvaCharge(dvaCharge({ authorization: { channel: 'card' } }))).toBeNull()
    expect(parsePaystackDvaCharge(dvaCharge({ currency: 'USD' }))).toBeNull()
    expect(parsePaystackDvaCharge(dvaCharge({ amount: -5 }))).toBeNull()
    expect(parsePaystackDvaCharge(dvaCharge({ amount: '1500' }))).toBeNull()
    expect(parsePaystackDvaCharge(null)).toBeNull()
  })
})

describe('Flutterwave virtual accounts', () => {
  it('checks verif-hash against the configured secret hash', async () => {
    expect(await verifyFlutterwaveHash('my-secret-hash', 'my-secret-hash')).toEqual({ ok: true })
    expect((await verifyFlutterwaveHash('wrong', 'my-secret-hash')).ok).toBe(false)
    expect((await verifyFlutterwaveHash(null, 'my-secret-hash')).ok).toBe(false)
    expect((await verifyFlutterwaveHash('x', '')).ok).toBe(false)
    const viaAdapter = await flutterwaveVaAdapter.verifyWebhook('{}', new Headers({ 'verif-hash': 'my-secret-hash' }), 'my-secret-hash')
    expect(viaAdapter.ok).toBe(true)
  })

  it('never records a payment from an unconfirmed event format', () => {
    expect(flutterwaveVaAdapter.parseWebhook({ event: 'charge.completed', data: { amount: 100, currency: 'NGN', status: 'successful' } })).toBeNull()
  })
})

describe('adapter resolution', () => {
  it('maps the shop choice to an adapter, never guessing', () => {
    expect(resolveBankTransferAdapter('paystack_dva')?.id).toBe('paystack_dva')
    expect(resolveBankTransferAdapter('flutterwave_va')?.readiness).toBe('adapter_only')
    expect(resolveBankTransferAdapter('none')).toBeNull()
    expect(resolveBankTransferAdapter(undefined)).toBeNull()
  })
})
