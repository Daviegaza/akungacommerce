import { describe, expect, it } from 'vitest'
import {
  PROMPT_STATUSES,
  buyerPromptMessage,
  decideBankTransfer,
  decideStkCallback,
  decideStkQuery,
  isDueForStkQuery,
  type BankTransferCandidate,
} from './reconciliation'

const order = (over: Partial<BankTransferCandidate> = {}): BankTransferCandidate => ({
  id: 'o1',
  status: 'pending_confirmation',
  currency: 'NGN',
  totalMinor: 2_000_000,
  netPaidMinor: 0,
  dueNowMinor: 2_000_000,
  ...over,
})
const base = { reference: 'T823592367', amountMinor: 2_000_000, currency: 'NGN', mapping: { orderId: 'o1' }, referenceKnown: false }

describe('decideBankTransfer (mirrors reconcile_bank_transfer)', () => {
  it('records the full balance for the mapped order and confirms a new order', () => {
    expect(decideBankTransfer({ ...base, candidates: [order()] })).toEqual({ kind: 'record', orderId: 'o1', amountMinor: 2_000_000, fullyPaid: true, autoConfirm: true })
  })
  it('records exactly the deposit due now (not fully paid); the after-payment rule confirms it', () => {
    const d = decideBankTransfer({ ...base, amountMinor: 500_000, candidates: [order({ dueNowMinor: 500_000 })] })
    expect(d).toEqual({ kind: 'record', orderId: 'o1', amountMinor: 500_000, fullyPaid: false, autoConfirm: true })
  })
  it('queues any other amount, with the order it was meant for', () => {
    expect(decideBankTransfer({ ...base, amountMinor: 1_999_900, candidates: [order()] })).toEqual({ kind: 'unmatched', reason: 'balance_differs', orderId: 'o1' })
    expect(decideBankTransfer({ ...base, amountMinor: 2_100_000, candidates: [order()] })).toMatchObject({ kind: 'unmatched', reason: 'balance_differs' })
  })
  it('a payment after confirmation still records but does not auto-confirm', () => {
    const d = decideBankTransfer({ ...base, amountMinor: 1_500_000, candidates: [order({ status: 'dispatched', netPaidMinor: 500_000, dueNowMinor: 1_500_000 })] })
    expect(d).toMatchObject({ kind: 'record', fullyPaid: true, autoConfirm: false })
  })
  it('closed orders, wrong currency, duplicates, unknown accounts and bad input never record', () => {
    expect(decideBankTransfer({ ...base, candidates: [order({ status: 'cancelled' })] })).toMatchObject({ kind: 'unmatched', reason: 'order_closed' })
    expect(decideBankTransfer({ ...base, currency: 'USD', candidates: [order()] })).toMatchObject({ kind: 'unmatched', reason: 'transfer_currency' })
    expect(decideBankTransfer({ ...base, referenceKnown: true, candidates: [order()] })).toEqual({ kind: 'duplicate' })
    expect(decideBankTransfer({ ...base, mapping: null, candidates: [order()] })).toEqual({ kind: 'unknown_account' })
    expect(decideBankTransfer({ ...base, mapping: { orderId: 'gone' }, candidates: [order()] })).toEqual({ kind: 'unmatched', reason: 'order_not_found', orderId: null })
    expect(decideBankTransfer({ ...base, reference: 'x', candidates: [order()] })).toEqual({ kind: 'invalid' })
    expect(decideBankTransfer({ ...base, amountMinor: 0, candidates: [order()] })).toEqual({ kind: 'invalid' })
    expect(decideBankTransfer({ ...base, amountMinor: 1.5, candidates: [order()] })).toEqual({ kind: 'invalid' })
  })
  it('customer accounts match only when exactly one open order is due exactly this amount', () => {
    const cust = { ...base, mapping: { orderId: null } }
    const a = order({ id: 'a' })
    const b = order({ id: 'b', totalMinor: 900_000, dueNowMinor: 900_000 })
    expect(decideBankTransfer({ ...cust, candidates: [a, b] })).toMatchObject({ kind: 'record', orderId: 'a' })
    expect(decideBankTransfer({ ...cust, candidates: [a, order({ id: 'c' })] })).toEqual({ kind: 'unmatched', reason: 'no_single_order', orderId: null })
    expect(decideBankTransfer({ ...cust, candidates: [a, order({ id: 'c', status: 'cancelled' })] })).toMatchObject({ kind: 'record', orderId: 'a' })
    expect(decideBankTransfer({ ...cust, amountMinor: 1, candidates: [a, b] })).toMatchObject({ kind: 'unmatched', reason: 'no_single_order' })
  })
})

describe('STK Push Query fallback (mirrors apply_mpesa_stk_query)', () => {
  it('awaiting_receipt is a real prompt status with honest buyer copy', () => {
    expect(PROMPT_STATUSES).toContain('awaiting_receipt')
    const m = buyerPromptMessage('awaiting_receipt')
    expect(m.title).toBe('M-Pesa says you paid')
    expect(m.body).toMatch(/do not pay again/i)
    expect(m.title.toLowerCase()).not.toContain('payment received')
  })
  it('a query success never records money: it only moves pending -> awaiting_receipt', () => {
    expect(decideStkQuery({ status: 'pending' }, 0)).toEqual({ kind: 'awaiting_receipt' })
    expect(decideStkQuery({ status: 'awaiting_receipt' }, 0)).toEqual({ kind: 'noop' })
    expect(decideStkQuery({ status: 'paid' }, 1032)).toEqual({ kind: 'noop' })
  })
  it('failure codes resolve the prompt; no answer keeps it pending', () => {
    expect(decideStkQuery({ status: 'pending' }, 1032)).toEqual({ kind: 'not_paid', promptStatus: 'cancelled' })
    expect(decideStkQuery({ status: 'pending' }, 1037)).toEqual({ kind: 'not_paid', promptStatus: 'timeout' })
    expect(decideStkQuery({ status: 'pending' }, 1)).toEqual({ kind: 'not_paid', promptStatus: 'failed' })
    expect(decideStkQuery({ status: 'pending' }, null)).toEqual({ kind: 'still_pending' })
    expect(decideStkQuery(null, 0)).toEqual({ kind: 'unknown_request' })
  })
  it('the real callback still records after awaiting_receipt (money arrives with a receipt)', () => {
    const d = decideStkCallback({
      request: { status: 'awaiting_receipt', amountMinor: 150_000 },
      order: { status: 'pending_confirmation', currency: 'KES', totalMinor: 150_000, netPaidMinor: 0 },
      receiptKnown: false,
      callback: { resultCode: 0, amountMinor: 150_000, receipt: 'SKL4Q8ZT2M' },
    })
    expect(d).toMatchObject({ kind: 'record', fullyPaid: true })
  })
  it('only prompts pending 2 min – 24 h are due, at most every 2 minutes', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
    expect(isDueForStkQuery({ status: 'pending', createdAt: at(1) }, now)).toBe(false)
    expect(isDueForStkQuery({ status: 'pending', createdAt: at(3) }, now)).toBe(true)
    expect(isDueForStkQuery({ status: 'pending', createdAt: at(25 * 60) }, now)).toBe(false)
    expect(isDueForStkQuery({ status: 'awaiting_receipt', createdAt: at(5) }, now)).toBe(false)
    expect(isDueForStkQuery({ status: 'pending', createdAt: at(10), lastQueriedAt: at(1) }, now)).toBe(false)
    expect(isDueForStkQuery({ status: 'pending', createdAt: at(10), lastQueriedAt: at(3) }, now)).toBe(true)
  })
})
