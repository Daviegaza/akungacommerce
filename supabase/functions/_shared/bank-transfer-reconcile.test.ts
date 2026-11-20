import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BANK_TRANSFER_PROCESSED,
  PAYSTACK_DVA_AMOUNT_UNIT_CONFIRMED,
  bankTransferRpcArgs,
  flutterwaveVaAdapter,
  parsePaystackDvaCharge,
  paystackDvaAdapter,
} from './bank-transfer.ts'
import { hmacSha512Hex } from './signatures.ts'

const SECRET = 'sk_test_not_a_real_key'

const charge = {
  event: 'charge.success',
  data: {
    id: 302961,
    status: 'success',
    reference: 'T823592367_1700000000',
    amount: 2_450_000,
    currency: 'NGN',
    channel: 'dedicated_nuban',
    paid_at: '2026-11-20T10:15:00.000Z',
    customer: { customer_code: 'CUS_x1y2z3' },
    authorization: { channel: 'dedicated_nuban', receiver_bank_account_number: '9930012345', sender_bank_account_number: '0012345678' },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webhook -> reconcile_bank_transfer arguments', () => {
  it('only a signature-verified, parsed credit becomes RPC arguments (amount in kobo as sent)', async () => {
    const raw = JSON.stringify(charge)
    const sig = await hmacSha512Hex(SECRET, raw)
    expect((await paystackDvaAdapter.verifyWebhook(raw, new Headers({ 'x-paystack-signature': sig }), SECRET)).ok).toBe(true)
    const credit = paystackDvaAdapter.parseWebhook(JSON.parse(raw))
    expect(credit).not.toBeNull()
    expect(bankTransferRpcArgs(credit!)).toEqual({
      p_provider: 'paystack_dva',
      p_reference: 'T823592367_1700000000',
      p_amount_minor: 2_450_000,
      p_currency: 'NGN',
      p_receiver_account: '9930012345',
      p_customer_ref: 'CUS_x1y2z3',
      p_sender_hint: '5678',
      p_paid_at: '2026-11-20T10:15:00.000Z',
    })
  })

  it('a card charge.success is not a bank transfer (handled by the normal Paystack path)', () => {
    expect(parsePaystackDvaCharge({ ...charge, data: { ...charge.data, channel: 'card', authorization: { channel: 'card' } } })).toBeNull()
  })

  it('treats recorded / unmatched / duplicate as handled, leaves unknown accounts and invalid credits for review', () => {
    expect([...BANK_TRANSFER_PROCESSED].sort()).toEqual(['duplicate', 'recorded', 'unmatched'])
    expect(BANK_TRANSFER_PROCESSED.has('unknown_account')).toBe(false)
    expect(BANK_TRANSFER_PROCESSED.has('invalid')).toBe(false)
  })

  it('states honestly that the kobo unit is unconfirmed', () => {
    expect(PAYSTACK_DVA_AMOUNT_UNIT_CONFIRMED).toBe(false)
  })
})

describe('assignVirtualAccount (adapter_only)', () => {
  it('never calls a provider and answers not_configured', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('no network calls allowed')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const input = { orgId: 'o', orderId: 'x', customerId: null, customerEmail: 'a@example.com', customerName: 'Ada' }
    for (const adapter of [paystackDvaAdapter, flutterwaveVaAdapter]) {
      const r = await adapter.assignVirtualAccount(input)
      expect(r.status).toBe('not_configured')
      expect(r.status === 'not_configured' && r.reason).toMatch(/adapter_only/)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
