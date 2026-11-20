import { describe, expect, it } from 'vitest'
import {
  buyerPromptMessage,
  classifyResultCode,
  decideC2bReceipt,
  decideStkCallback,
  normaliseReceiptCode,
  orderNumberFromRef,
  phoneHint,
  validateAttach,
  verdictFor,
  type ReconOrder,
  type ReconRequest,
} from './reconciliation'

const order = (o: Partial<ReconOrder> = {}): ReconOrder => ({ status: 'pending_confirmation', currency: 'KES', totalMinor: 150_000, netPaidMinor: 0, ...o })
const pending = (amountMinor = 150_000): ReconRequest => ({ status: 'pending', amountMinor })
const paidCb = (amountMinor = 150_000, receipt = 'QKJ3XYZ12A') => ({ resultCode: 0, amountMinor, receipt })

describe('classifyResultCode', () => {
  it('maps Daraja result codes to plain outcomes', () => {
    expect(classifyResultCode(0)).toBe('paid')
    expect(classifyResultCode(1032)).toBe('cancelled')
    expect(classifyResultCode(1037)).toBe('timeout')
    expect(classifyResultCode(1019)).toBe('timeout')
    expect(classifyResultCode(1)).toBe('failed')
    expect(classifyResultCode(2001)).toBe('failed')
  })
})

describe('decideStkCallback', () => {
  it('records a matching payment and auto-confirms a fully paid new order', () => {
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: paidCb() })).toEqual({
      kind: 'record',
      amountMinor: 150_000,
      fullyPaid: true,
      autoConfirm: true,
    })
  })

  it('records a partial payment without confirming', () => {
    const d = decideStkCallback({ request: pending(50_000), order: order(), receiptKnown: false, callback: paidCb(50_000) })
    expect(d).toEqual({ kind: 'record', amountMinor: 50_000, fullyPaid: false, autoConfirm: false })
  })

  it('does not auto-confirm an order already past confirmation', () => {
    const d = decideStkCallback({ request: pending(), order: order({ status: 'preparing' }), receiptKnown: false, callback: paidCb() })
    expect(d).toMatchObject({ kind: 'record', autoConfirm: false, fullyPaid: true })
  })

  it('is idempotent: a known receipt or an already-paid request is a duplicate', () => {
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: true, callback: paidCb() })).toEqual({ kind: 'duplicate' })
    expect(decideStkCallback({ request: { status: 'paid', amountMinor: 150_000 }, order: order(), receiptKnown: false, callback: paidCb() })).toEqual({
      kind: 'duplicate',
    })
    expect(decideStkCallback({ request: { status: 'mismatch', amountMinor: 150_000 }, order: order(), receiptKnown: false, callback: paidCb() })).toEqual({
      kind: 'duplicate',
    })
  })

  it('ignores a second failure callback for a resolved prompt', () => {
    expect(
      decideStkCallback({ request: { status: 'cancelled', amountMinor: 1 }, order: order(), receiptKnown: false, callback: { resultCode: 1037, amountMinor: null, receipt: null } }),
    ).toEqual({ kind: 'duplicate' })
  })

  it('maps failures on a pending prompt to a prompt status, never a payment', () => {
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: { resultCode: 1032, amountMinor: null, receipt: null } })).toEqual({
      kind: 'not_paid',
      promptStatus: 'cancelled',
    })
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: { resultCode: 2001, amountMinor: null, receipt: null } })).toEqual({
      kind: 'not_paid',
      promptStatus: 'failed',
    })
  })

  it('flags an amount mismatch for review instead of accepting it', () => {
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: paidCb(100_000) })).toEqual({
      kind: 'review',
      promptStatus: 'mismatch',
      receiptStatus: 'mismatch',
      reason: 'amount_differs',
    })
  })

  it('a late success after the order was cancelled goes to review, not paid', () => {
    expect(decideStkCallback({ request: pending(), order: order({ status: 'cancelled' }), receiptKnown: false, callback: paidCb() })).toEqual({
      kind: 'review',
      promptStatus: 'late',
      receiptStatus: 'late',
      reason: 'order_closed',
    })
  })

  it('a late success after the prompt timed out is still recorded (money really moved)', () => {
    const d = decideStkCallback({ request: { status: 'timeout', amountMinor: 150_000 }, order: order(), receiptKnown: false, callback: paidCb() })
    expect(d).toMatchObject({ kind: 'record', autoConfirm: true })
  })

  it('a second paid prompt on an order already paid is an extra payment for review', () => {
    expect(decideStkCallback({ request: pending(), order: order({ netPaidMinor: 150_000 }), receiptKnown: false, callback: paidCb() })).toMatchObject({
      kind: 'review',
      reason: 'already_paid',
    })
  })

  it('rejects malformed success callbacks and unknown requests', () => {
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: { resultCode: 0, amountMinor: 150_000, receipt: null } })).toEqual({
      kind: 'invalid',
    })
    expect(decideStkCallback({ request: pending(), order: order(), receiptKnown: false, callback: paidCb(150_000, 'x') })).toEqual({ kind: 'invalid' })
    expect(decideStkCallback({ request: null, order: null, receiptKnown: false, callback: paidCb() })).toEqual({ kind: 'unknown_request' })
  })

  it('flags non-KES orders', () => {
    expect(decideStkCallback({ request: pending(), order: order({ currency: 'EUR' }), receiptKnown: false, callback: paidCb() })).toMatchObject({
      kind: 'review',
      reason: 'currency',
    })
  })
})

describe('decideC2bReceipt', () => {
  it('auto-matches only an exact balance on a referenced live order', () => {
    expect(decideC2bReceipt({ receiptKnown: false, accountRef: '#1042', order: order(), amountMinor: 150_000 })).toEqual({
      kind: 'record',
      amountMinor: 150_000,
      fullyPaid: true,
      autoConfirm: true,
    })
    expect(decideC2bReceipt({ receiptKnown: false, accountRef: '1042', order: order(), amountMinor: 100_000 })).toEqual({ kind: 'unmatched', reason: 'balance_differs' })
    expect(decideC2bReceipt({ receiptKnown: false, accountRef: null, order: null, amountMinor: 1 })).toEqual({ kind: 'unmatched', reason: 'no_order_ref' })
    expect(decideC2bReceipt({ receiptKnown: false, accountRef: '99', order: null, amountMinor: 1 })).toEqual({ kind: 'unmatched', reason: 'order_not_found' })
    expect(decideC2bReceipt({ receiptKnown: false, accountRef: '9', order: order({ status: 'cancelled' }), amountMinor: 150_000 })).toEqual({
      kind: 'unmatched',
      reason: 'order_closed',
    })
    expect(decideC2bReceipt({ receiptKnown: true, accountRef: '9', order: order(), amountMinor: 150_000 })).toEqual({ kind: 'duplicate' })
  })

  it('parses account references', () => {
    expect(orderNumberFromRef(' #12 ')).toBe(12)
    expect(orderNumberFromRef('INV-12')).toBeNull()
    expect(orderNumberFromRef('0')).toBeNull()
  })
})

describe('validateAttach', () => {
  const r = { status: 'unmatched' as const, amountMinor: 50_000, currency: 'KES' }
  it('allows a queued receipt within the balance', () => {
    expect(validateAttach(r, order())).toBeNull()
  })
  it('refuses resolved receipts, closed orders, other currencies and overpayment', () => {
    expect(validateAttach({ ...r, status: 'matched' }, order())).toMatch(/already been resolved/)
    expect(validateAttach(r, order({ status: 'cancelled' }))).toMatch(/cancelled/)
    expect(validateAttach(r, order({ currency: 'EUR' }))).toMatch(/EUR/)
    expect(validateAttach({ ...r, amountMinor: 200_000 }, order())).toMatch(/more than the balance/)
  })
})

describe('receipt codes and verdicts', () => {
  it('normalises receipt codes', () => {
    expect(normaliseReceiptCode(' qkj3 xyz12a ')).toBe('QKJ3XYZ12A')
    expect(normaliseReceiptCode('abc')).toBeNull()
    expect(normaliseReceiptCode('QKJ3XYZ12A!')).toBeNull()
  })

  it('keeps only a short phone hint', () => {
    expect(phoneHint('254712345678')).toBe('678')
    expect(phoneHint('12')).toBeNull()
  })

  it('manual mode says it cannot verify automatically', () => {
    expect(verdictFor({ code: 'QKJ3XYZ12A', provider: 'manual', found: null, manualOrderNumbers: [7] })).toEqual({
      state: 'not_verifiable',
      provider: 'manual',
      alsoRecordedManuallyOn: [7],
    })
  })

  it('automatic modes report not found or verified', () => {
    expect(verdictFor({ code: 'QKJ3XYZ12A', provider: 'daraja', found: null, manualOrderNumbers: [] })).toEqual({ state: 'not_found', alsoRecordedManuallyOn: [] })
    expect(verdictFor({ code: 'bad', provider: 'daraja', found: null, manualOrderNumbers: [] })).toEqual({ state: 'invalid_format' })
    const found = { code: 'QKJ3XYZ12A', status: 'matched' as const, amountMinor: 1, currency: 'KES', transactedAt: 'x', orderNumber: 3, payerHint: null, source: 'stk' as const }
    expect(verdictFor({ code: 'QKJ3XYZ12A', provider: 'daraja', found, manualOrderNumbers: [] })).toMatchObject({ state: 'verified' })
  })

  it('buyer messages never claim payment for a failure', () => {
    for (const s of ['cancelled', 'timeout', 'failed'] as const) expect(buyerPromptMessage(s).body).toMatch(/Nothing was charged/)
    expect(buyerPromptMessage('failed', 1).title).toMatch(/balance/)
    expect(buyerPromptMessage('mismatch').body).toMatch(/do not pay again/)
  })
})
