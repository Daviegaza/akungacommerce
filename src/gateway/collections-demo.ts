/**
 * Demo M-Pesa collections: a SIMULATED STK lifecycle and reconciliation queue
 * on the browser-local demo state. Nothing is charged and no provider is called.
 *
 * The outcome of each simulated prompt is chosen up front (success, cancelled,
 * timeout, wrong amount) and settles after a fixed delay, so a demo is
 * deterministic. Settlement runs the same pure rules as the database
 * (src/domain/reconciliation.ts).
 */
import {
  confirmNote,
  decideC2bReceipt,
  decideStkCallback,
  normaliseReceiptCode,
  orderNumberFromRef,
  phoneHint,
  REVIEW_REASON_TEXT,
  validateAttach,
  verdictFor,
  type ReconOrder,
} from '@/domain/reconciliation'
import type { demoInternals as DemoInternalsValue, DemoState, StoredOrder } from './demo'
import type { CollectionsAdminGateway, CollectionsSettings, MpesaPrompt, MpesaReceipt } from './collections'
import type { PaymentOptions, PromptStatusResult, SimulatedOutcome, StkResult } from './storefront'

type Internals = typeof DemoInternalsValue

export interface StoredMpesaPrompt extends Omit<MpesaPrompt, 'orderNumber' | 'simulated'> {
  orgId: string
  simulate: SimulatedOutcome
}
export interface StoredMpesaReceipt extends Omit<MpesaReceipt, 'orderNumber' | 'simulated'> {
  orgId: string
}
export interface DemoCollectionsState {
  mpesaPrompts?: StoredMpesaPrompt[]
  mpesaReceipts?: StoredMpesaReceipt[]
  /** orgId -> settings; missing = Daraja (simulated) so the demo can show the full flow. */
  collections?: Record<string, CollectionsSettings>
}

/** How long each simulated outcome takes to "arrive" from M-Pesa. */
export const SIM_DELAY_MS: Record<SimulatedOutcome, number> = { success: 5_000, cancelled: 4_000, timeout: 10_000, wrong_amount: 5_000 }
const SIM_RESULT_CODE: Record<SimulatedOutcome, number> = { success: 0, cancelled: 1032, timeout: 1037, wrong_amount: 0 }
const PAYABLE = new Set(['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered'])
const DEFAULT_SETTINGS: CollectionsSettings = { provider: 'daraja', aggregator: null }

function settingsOf(s: DemoState, orgId: string): CollectionsSettings {
  return s.collections?.[orgId] ?? DEFAULT_SETTINGS
}
function prompts(s: DemoState): StoredMpesaPrompt[] {
  s.mpesaPrompts ??= []
  return s.mpesaPrompts
}
function receipts(s: DemoState): StoredMpesaReceipt[] {
  s.mpesaReceipts ??= []
  return s.mpesaReceipts
}

/** Random receipt-shaped code, e.g. "SKL4Q8ZT2M" (prefix S marks it simulated in our data). */
function fakeReceipt(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint8Array(9)
  crypto.getRandomValues(buf)
  return 'S' + Array.from(buf, (b) => alphabet[b % alphabet.length]).join('')
}

function reconOrder(I: Internals, s: DemoState, o: StoredOrder): ReconOrder {
  return { status: o.status, currency: o.currency, totalMinor: o.totalMinor, netPaidMinor: I.toSummary(s, o).netPaidMinor }
}

/** Record a provider-verified payment and confirm a fully paid new order (mirrors _mpesa_after_payment). */
function recordVerified(I: Internals, s: DemoState, o: StoredOrder, provider: string, amountMinor: number, receipt: string, at: string, note: string): string {
  const id = I.uuid()
  s.payments.push({
    id,
    orgId: o.orgId,
    orderId: o.id,
    idempotencyKey: `${provider}:${receipt}`,
    provider,
    method: 'mobile_money',
    amountMinor,
    currency: o.currency,
    status: 'succeeded',
    verification: 'provider_verified',
    externalRef: receipt,
    note,
    receivedAt: at,
    reversedReason: null,
    createdAt: I.nowIso(),
  })
  I.writeAudit(s, o.orgId, 'payments', id, 'insert', null, {
    orderNumber: o.number,
    amountMinor,
    currency: o.currency,
    method: 'mobile_money',
    verification: 'provider_verified',
  })
  if (o.status === 'pending_confirmation' && I.toSummary(s, o).netPaidMinor >= o.totalMinor) {
    o.status = 'confirmed'
    o.updatedAt = I.nowIso()
    s.history.push({ id: I.uuid(), orgId: o.orgId, orderId: o.id, fromStatus: 'pending_confirmation', toStatus: 'confirmed', note: confirmNote(receipt), createdAt: I.nowIso() })
  }
  return id
}

/** Apply the simulated M-Pesa result to every pending prompt whose delay has passed. */
export function settleDemoPrompts(I: Internals, s: DemoState): void {
  const t = I.now().getTime()
  for (const p of prompts(s)) {
    if (p.status !== 'pending' || t - Date.parse(p.createdAt) < SIM_DELAY_MS[p.simulate]) continue
    const order = s.orders.find((o) => o.id === p.orderId) ?? null
    const resultCode = SIM_RESULT_CODE[p.simulate]
    const paid = resultCode === 0
    const amount = p.simulate === 'wrong_amount' ? (p.amountMinor > 100 ? p.amountMinor - 100 : p.amountMinor + 100) : p.amountMinor
    const receipt = paid ? fakeReceipt() : null
    const decision = decideStkCallback({
      request: { status: p.status, amountMinor: p.amountMinor },
      order: order ? reconOrder(I, s, order) : null,
      receiptKnown: receipt !== null && receipts(s).some((r) => r.receipt === receipt),
      callback: { resultCode, amountMinor: paid ? amount : null, receipt },
    })
    const at = new Date(Date.parse(p.createdAt) + SIM_DELAY_MS[p.simulate]).toISOString()
    p.resultCode = resultCode
    p.resolvedAt = I.nowIso()
    if (decision.kind === 'not_paid') {
      p.status = decision.promptStatus
      p.resultDesc = p.simulate === 'cancelled' ? 'Request cancelled by user (simulated)' : 'No response from user (simulated)'
      continue
    }
    if (!receipt || !order) continue
    const base: StoredMpesaReceipt = {
      id: I.uuid(),
      orgId: p.orgId,
      provider: p.provider,
      source: 'stk',
      receipt,
      amountMinor: amount,
      currency: 'KES',
      accountRef: null,
      payerHint: p.phoneHint ? `···${p.phoneHint}` : null,
      transactedAt: at,
      status: 'matched',
      reason: null,
      orderId: order.id,
      paymentId: null,
      createdAt: I.nowIso(),
      resolvedAt: null,
    }
    p.receipt = receipt
    p.resultDesc = 'The service request is processed successfully (simulated)'
    if (decision.kind === 'record') {
      base.paymentId = recordVerified(I, s, order, p.provider, amount, receipt, at, 'Simulated M-Pesa payment (demo, nothing was charged)')
      base.resolvedAt = I.nowIso()
      p.status = 'paid'
    } else if (decision.kind === 'review') {
      base.status = decision.receiptStatus
      base.reason = REVIEW_REASON_TEXT[decision.reason]
      p.status = decision.promptStatus
    } else {
      continue
    }
    receipts(s).push(base)
  }
}

/* ───────────── Shopper side (used by storefront-demo.ts) ───────────── */

export function demoPaymentOptions(s: DemoState, orgId: string): PaymentOptions {
  const st = settingsOf(s, orgId)
  // Aggregators have no verified adapter, so even the demo does not pretend they prompt.
  return { provider: st.provider, stk: st.provider === 'daraja', simulated: true }
}

export function demoRequestPrompt(I: Internals, s: DemoState, order: StoredOrder, phoneE164: string, simulate: SimulatedOutcome = 'success'): StkResult {
  settleDemoPrompts(I, s)
  if (settingsOf(s, order.orgId).provider !== 'daraja') return { status: 'not_configured' }
  if (!/^\+254[71]\d{8}$/.test(String(phoneE164 ?? '').trim())) return { status: 'failed', error: 'Enter a Kenyan mobile number, e.g. +254712345678' }
  if (order.currency !== 'KES') return { status: 'failed', error: 'M-Pesa is only available for KES orders' }
  if (!PAYABLE.has(order.status)) return { status: 'failed', error: 'This order is not accepting payments' }
  const outstanding = order.totalMinor - I.toSummary(s, order).netPaidMinor
  if (outstanding <= 0) return { status: 'failed', error: 'This order is already paid' }
  if (outstanding % 100 !== 0) return { status: 'failed', error: 'M-Pesa only accepts whole shillings' }
  const hourAgo = I.now().getTime() - 3_600_000
  if (prompts(s).filter((p) => p.orderId === order.id && Date.parse(p.createdAt) > hourAgo).length >= 5) {
    return { status: 'failed', error: 'Too many payment prompts. Please wait a few minutes.' }
  }
  const checkoutRequestId = `ws_CO_DEMO_${I.uuid().replace(/-/g, '').slice(0, 16)}`
  prompts(s).push({
    checkoutRequestId,
    orgId: order.orgId,
    orderId: order.id,
    provider: 'mpesa',
    amountMinor: outstanding,
    status: 'pending',
    resultCode: null,
    resultDesc: null,
    receipt: null,
    phoneHint: phoneHint(phoneE164),
    createdAt: I.nowIso(),
    resolvedAt: null,
    simulate,
  })
  return { status: 'prompt_sent', checkoutRequestId }
}

export function demoPromptStatus(I: Internals, s: DemoState, order: StoredOrder, checkoutRequestId: string): PromptStatusResult {
  settleDemoPrompts(I, s)
  const p = prompts(s).find((x) => x.checkoutRequestId === checkoutRequestId && x.orderId === order.id) ?? I.fail('Payment request not found', 'not_found')
  return { status: p.status, resultCode: p.resultCode }
}

/* ───────────── Merchant side ───────────── */

function toPrompt(s: DemoState, p: StoredMpesaPrompt): MpesaPrompt {
  const { orgId: _o, simulate: _s, ...rest } = p
  void _o
  void _s
  return { ...rest, orderNumber: s.orders.find((o) => o.id === p.orderId)?.number ?? null, simulated: true }
}
function toReceipt(s: DemoState, r: StoredMpesaReceipt): MpesaReceipt {
  const { orgId: _o, ...rest } = r
  void _o
  return { ...rest, orderNumber: r.orderId ? (s.orders.find((o) => o.id === r.orderId)?.number ?? null) : null, simulated: true }
}

export function createDemoCollections(I: Internals): Required<CollectionsAdminGateway> {
  return {
    getCollectionsSettings: (orgId) =>
      I.read((s) => {
        I.requireMember(s, orgId)
        return { ...settingsOf(s, orgId) }
      }),
    setCollectionsProvider: (orgId, settings) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'integrations.manage')
        if (!['manual', 'daraja', 'aggregator'].includes(settings.provider)) I.fail('Choose manual, Daraja or an aggregator', 'invalid')
        if (settings.provider === 'aggregator' && !/^[a-z][a-z0-9_]{1,30}$/.test(settings.aggregator ?? '')) I.fail('Choose which aggregator', 'invalid')
        if (!s.shopSettings.some((x) => x.orgId === orgId)) I.fail('Set up your shop link first (My shop), then choose how you get paid', 'invalid')
        s.collections ??= {}
        s.collections[orgId] = { provider: settings.provider, aggregator: settings.provider === 'aggregator' ? settings.aggregator : null }
      }),
    listMpesaPrompts: (orgId) =>
      I.tx((s) => {
        I.requireMember(s, orgId)
        settleDemoPrompts(I, s)
        return prompts(s)
          .filter((p) => p.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((p) => toPrompt(s, p))
      }),
    listMpesaReceipts: (orgId) =>
      I.tx((s) => {
        I.requireMember(s, orgId)
        settleDemoPrompts(I, s)
        return receipts(s)
          .filter((r) => r.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => toReceipt(s, r))
      }),
    attachMpesaReceipt: (orgId, receiptId, orderId) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        const r = receipts(s).find((x) => x.id === receiptId && x.orgId === orgId) ?? I.fail('Payment not found', 'not_found')
        const o = s.orders.find((x) => x.id === orderId && x.orgId === orgId) ?? I.fail('Order not found', 'not_found')
        const problem = validateAttach(r, reconOrder(I, s, o))
        if (problem) I.fail(problem, 'invalid')
        if (s.payments.some((p) => p.orgId === orgId && p.idempotencyKey === `${r.provider}:${r.receipt}`)) {
          I.fail('This receipt is already recorded as a payment', 'conflict')
        }
        const paymentId = recordVerified(I, s, o, r.provider, r.amountMinor, r.receipt, r.transactedAt, 'Verified M-Pesa receipt attached by staff (simulated)')
        Object.assign(r, { status: 'attached', orderId: o.id, paymentId, resolvedAt: I.nowIso() })
        return paymentId
      }),
    dismissMpesaReceipt: (orgId, receiptId, reason) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        const why = (reason ?? '').trim()
        if (!why) I.fail('A reason is required', 'invalid')
        const r = receipts(s).find((x) => x.id === receiptId && x.orgId === orgId) ?? I.fail('Payment not found', 'not_found')
        if (!['unmatched', 'mismatch', 'late'].includes(r.status)) I.fail('This payment has already been resolved', 'invalid')
        Object.assign(r, { status: 'dismissed', reason: why.slice(0, 300), resolvedAt: I.nowIso() })
      }),
    verifyMpesaReceipt: (orgId, code) =>
      I.tx((s) => {
        I.requireMember(s, orgId)
        settleDemoPrompts(I, s)
        const norm = normaliseReceiptCode(code) ?? ''
        const r = receipts(s).find((x) => x.orgId === orgId && x.receipt === norm)
        const manualOrderNumbers = [
          ...new Set(
            s.payments
              .filter((p) => p.orgId === orgId && p.verification === 'manual_unverified' && normaliseReceiptCode(p.externalRef) === norm && norm)
              .map((p) => s.orders.find((o) => o.id === p.orderId)?.number)
              .filter((n): n is number => typeof n === 'number'),
          ),
        ]
        return verdictFor({
          code,
          provider: settingsOf(s, orgId).provider,
          found: r
            ? {
                code: r.receipt,
                status: r.status,
                amountMinor: r.amountMinor,
                currency: r.currency,
                transactedAt: r.transactedAt,
                orderNumber: r.orderId ? (s.orders.find((o) => o.id === r.orderId)?.number ?? null) : null,
                payerHint: r.payerHint,
                source: r.source,
              }
            : null,
          manualOrderNumbers,
        })
      }),
    simulateIncomingMpesa: (orgId, input) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) I.fail('Amount must be positive', 'invalid')
        const receipt = fakeReceipt()
        const num = orderNumberFromRef(input.accountRef)
        const order = num === null ? undefined : s.orders.find((o) => o.orgId === orgId && o.number === num)
        const decision = decideC2bReceipt({
          receiptKnown: false,
          accountRef: input.accountRef,
          order: order ? reconOrder(I, s, order) : null,
          amountMinor: input.amountMinor,
        })
        const row: StoredMpesaReceipt = {
          id: I.uuid(),
          orgId,
          provider: 'mpesa',
          source: 'c2b',
          receipt,
          amountMinor: input.amountMinor,
          currency: 'KES',
          accountRef: input.accountRef?.trim() || null,
          payerHint: 'Demo customer ···123',
          transactedAt: I.nowIso(),
          status: 'unmatched',
          reason: null,
          orderId: null,
          paymentId: null,
          createdAt: I.nowIso(),
          resolvedAt: null,
        }
        if (decision.kind === 'record' && order) {
          row.paymentId = recordVerified(I, s, order, 'mpesa', input.amountMinor, receipt, row.transactedAt, 'Simulated Till/Paybill payment (demo)')
          row.status = 'matched'
          row.orderId = order.id
          row.resolvedAt = I.nowIso()
        } else if (decision.kind === 'unmatched') {
          row.reason = REVIEW_REASON_TEXT[decision.reason]
        }
        receipts(s).push(row)
      }),
  }
}
