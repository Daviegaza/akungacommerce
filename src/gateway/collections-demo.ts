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
  decideBankTransfer,
  decideC2bReceipt,
  decideStkCallback,
  decideStkQuery,
  normaliseReceiptCode,
  orderNumberFromRef,
  phoneHint,
  REVIEW_REASON_TEXT,
  validateAttach,
  verdictFor,
  type ReconOrder,
} from '@/domain/reconciliation'
import type { demoInternals as DemoInternalsValue, DemoState, StoredOrder } from './demo'
import { demoTrackedDelivery } from './delivery-demo'
import type { CollectionsAdminGateway, CollectionsSettings, MpesaPrompt, MpesaReceipt, VirtualAccountRecord } from './collections'
import type { PaymentOptions, PromptStatusResult, SimulatedOutcome, StkResult, TrackedBankTransfer, TrackedPaymentEvent } from './storefront'

type Internals = typeof DemoInternalsValue

export interface StoredMpesaPrompt extends Omit<MpesaPrompt, 'orderNumber' | 'simulated'> {
  orgId: string
  simulate: SimulatedOutcome
}
export interface StoredMpesaReceipt extends Omit<MpesaReceipt, 'orderNumber' | 'simulated'> {
  orgId: string
}
export interface StoredVirtualAccount extends Omit<VirtualAccountRecord, 'orderNumber' | 'simulated'> {
  orgId: string
}
export interface DemoCollectionsState {
  mpesaPrompts?: StoredMpesaPrompt[]
  mpesaReceipts?: StoredMpesaReceipt[]
  /** orgId -> settings; missing = Daraja (simulated) so the demo can show the full flow. */
  collections?: Record<string, CollectionsSettings>
  /** SIMULATED dedicated bank accounts (NGN demo businesses). */
  virtualAccounts?: StoredVirtualAccount[]
}

/** How long each simulated outcome takes to "arrive" from M-Pesa. */
export const SIM_DELAY_MS: Record<SimulatedOutcome, number> = { success: 5_000, cancelled: 4_000, timeout: 10_000, wrong_amount: 5_000, callback_lost: 6_000 }
/** callback_lost: the STK query says "paid" after SIM_DELAY_MS; the receipt itself only arrives this long after the prompt. */
export const SIM_LOST_RECEIPT_AFTER_MS = 25_000
const SIM_RESULT_CODE: Record<SimulatedOutcome, number> = { success: 0, cancelled: 1032, timeout: 1037, wrong_amount: 0, callback_lost: 0 }
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

/** Record a provider-verified payment and confirm a fully paid new order (mirrors _after_verified_payment). */
function recordVerified(
  I: Internals,
  s: DemoState,
  o: StoredOrder,
  provider: string,
  amountMinor: number,
  receipt: string,
  at: string,
  note: string,
  via: 'mpesa' | 'bank_transfer' = 'mpesa',
): string {
  const id = I.uuid()
  s.payments.push({
    id,
    orgId: o.orgId,
    orderId: o.id,
    idempotencyKey: `${provider}:${receipt}`,
    provider,
    method: via === 'bank_transfer' ? 'bank_transfer' : 'mobile_money',
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
    method: via === 'bank_transfer' ? 'bank_transfer' : 'mobile_money',
    verification: 'provider_verified',
  })
  if (o.status === 'pending_confirmation') {
    // Same rule as public._after_verified_payment (20261120000060): full payment or a covered deposit confirms.
    const fullyPaid = I.toSummary(s, o).netPaidMinor >= o.totalMinor
    const d = demoTrackedDelivery(s, o)
    const depositCovered = d.depositDueMinor > 0 && d.depositPaidMinor >= d.depositDueMinor
    if (fullyPaid || depositCovered) {
      o.status = 'confirmed'
      o.updatedAt = I.nowIso()
      const label = via === 'bank_transfer' ? `bank transfer (verified reference ${receipt})` : `M-Pesa (verified receipt ${receipt})`
      const note =
        fullyPaid && via === 'mpesa' ? confirmNote(receipt) : fullyPaid ? `Paid in full by ${label}` : `Deposit paid by ${label}; balance due on delivery`
      s.history.push({ id: I.uuid(), orgId: o.orgId, orderId: o.id, fromStatus: 'pending_confirmation', toStatus: 'confirmed', note, createdAt: I.nowIso() })
    }
  }
  return id
}

/** Apply the simulated M-Pesa result to every pending prompt whose delay has passed. */
export function settleDemoPrompts(I: Internals, s: DemoState): void {
  const t = I.now().getTime()
  for (const p of prompts(s)) {
    const age = t - Date.parse(p.createdAt)
    if (p.simulate === 'callback_lost') {
      // The callback never came; the (simulated) STK Push Query says "paid" but carries no receipt or amount,
      // so nothing is recorded (same as apply_mpesa_stk_query). The receipt turns up later as a late callback.
      if (p.status === 'pending' && age >= SIM_DELAY_MS.callback_lost) {
        if (decideStkQuery(p, 0).kind === 'awaiting_receipt') {
          p.status = 'awaiting_receipt'
          p.resultCode = 0
          p.resultDesc = 'STK query: paid, no receipt yet (simulated)'
        }
      }
      if (p.status !== 'awaiting_receipt' || age < SIM_LOST_RECEIPT_AFTER_MS) continue
    } else if (p.status !== 'pending' || age < SIM_DELAY_MS[p.simulate]) {
      continue
    }
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
  // Charge the amount due now: an unpaid deposit first, else the balance (same as mpesa-stk).
  const outstanding = demoTrackedDelivery(s, order).dueNowMinor
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

/* ───────────── Bank transfer (NGN), SIMULATED ───────────── */

function virtualAccounts(s: DemoState): StoredVirtualAccount[] {
  s.virtualAccounts ??= []
  return s.virtualAccounts
}

/** Active simulated account for an order (or for its customer). Mirrors storefront_bank_transfer. */
function accountForOrder(s: DemoState, o: StoredOrder): StoredVirtualAccount | undefined {
  const active = virtualAccounts(s).filter((v) => v.status === 'active' && v.orgId === o.orgId)
  return active.find((v) => v.orderId === o.id) ?? (o.customerId ? active.find((v) => v.orderId === null && v.customerId === o.customerId) : undefined)
}

/** Tracking page: payment events + bank-transfer details (mirrors storefront_track_payments / storefront_bank_transfer). */
export function demoTrackPayments(s: DemoState, o: StoredOrder): { payments: TrackedPaymentEvent[]; bankTransfer: TrackedBankTransfer | null } {
  const payments = s.payments
    .filter((p) => p.orderId === o.id && p.status === 'succeeded')
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.createdAt.localeCompare(b.createdAt))
    .map((p) => ({ amountMinor: p.amountMinor, currency: p.currency, method: p.method, verified: p.verification === 'provider_verified', receivedAt: p.receivedAt }))
  let bankTransfer: TrackedBankTransfer | null = null
  if (o.currency === 'NGN' && o.paymentPreference === 'bank_transfer') {
    const va = accountForOrder(s, o)
    const provider = s.shopExtras?.[o.orgId]?.bankTransferProvider
    bankTransfer = {
      provider: va?.provider ?? (provider && provider !== 'none' ? provider : null),
      account: va ? { bankName: va.bankName, accountNumber: va.accountNumber, accountName: va.accountName } : null,
      dueNowMinor: demoTrackedDelivery(s, o).dueNowMinor,
      reference: o.number,
      simulated: true,
    }
  }
  return { payments, bankTransfer }
}

function randomDigits(n: number): string {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => String(b % 10)).join('')
}

function toVirtualAccount(s: DemoState, v: StoredVirtualAccount): VirtualAccountRecord {
  const { orgId: _o, ...rest } = v
  void _o
  return { ...rest, orderNumber: v.orderId ? (s.orders.find((o) => o.id === v.orderId)?.number ?? null) : null, simulated: true }
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
        const bank = r.source === 'bank_transfer'
        const paymentId = recordVerified(
          I,
          s,
          o,
          r.provider,
          r.amountMinor,
          r.receipt,
          r.transactedAt,
          bank ? 'Verified bank transfer attached by staff (simulated)' : 'Verified M-Pesa receipt attached by staff (simulated)',
          bank ? 'bank_transfer' : 'mpesa',
        )
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
          dueNowMinor: order ? demoTrackedDelivery(s, order).dueNowMinor : undefined,
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

    listVirtualAccounts: (orgId) =>
      I.read((s) => {
        I.requireMember(s, orgId)
        return virtualAccounts(s)
          .filter((v) => v.orgId === orgId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((v) => toVirtualAccount(s, v))
      }),
    // SIMULATED assignment: a made-up account number at "Demo Bank". No provider is called;
    // the real gateway answers not_configured until a Paystack DVA adapter exists.
    assignVirtualAccount: (orgId, orderId) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        const org = I.getOrg(s, orgId)
        if (org.baseCurrency !== 'NGN') I.fail('Dedicated bank accounts are only for NGN businesses', 'invalid')
        const provider = s.shopExtras?.[orgId]?.bankTransferProvider ?? 'none'
        if (provider === 'none') {
          return { status: 'not_configured' as const, reason: 'Choose a bank-transfer provider under Settings first.' }
        }
        const o = s.orders.find((x) => x.id === orderId && x.orgId === orgId) ?? I.fail('Order not found', 'not_found')
        if (o.currency !== 'NGN') I.fail('Order not found', 'not_found')
        for (const v of virtualAccounts(s)) {
          if (v.orderId === o.id && v.status === 'active') Object.assign(v, { status: 'retired' })
        }
        let accountNumber = `99${randomDigits(8)}`
        while (virtualAccounts(s).some((v) => v.accountNumber === accountNumber && v.status === 'active')) accountNumber = `99${randomDigits(8)}`
        const row: StoredVirtualAccount = {
          id: I.uuid(),
          orgId,
          provider,
          bankName: 'Demo Bank (simulated)',
          accountNumber,
          accountName: `${org.name} / Rafu`,
          orderId: o.id,
          customerId: o.customerId ?? null,
          status: 'active',
          createdAt: I.nowIso(),
        }
        virtualAccounts(s).push(row)
        I.writeAudit(s, orgId, 'virtual_accounts', row.id, 'insert', null, { orderNumber: o.number, simulated: true })
        return { status: 'assigned' as const, account: toVirtualAccount(s, row) }
      }),
    // SIMULATED credit: runs the same rule as reconcile_bank_transfer (decideBankTransfer).
    simulateBankTransfer: (orgId, input) =>
      I.tx((s) => {
        I.requirePermission(s, orgId, 'payments.record')
        if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) I.fail('Amount must be positive', 'invalid')
        const va =
          virtualAccounts(s).find((v) => v.orgId === orgId && v.status === 'active' && v.accountNumber === input.accountNumber) ??
          I.fail('No dedicated account with that number', 'not_found')
        const reference = `SIMDVA_${randomDigits(10)}`
        const candidates = s.orders
          .filter((o) => o.orgId === orgId && (va.orderId ? o.id === va.orderId : o.customerId === va.customerId))
          .map((o) => ({ ...reconOrder(I, s, o), id: o.id, dueNowMinor: demoTrackedDelivery(s, o).dueNowMinor }))
        const decision = decideBankTransfer({
          reference,
          amountMinor: input.amountMinor,
          currency: 'NGN',
          mapping: { orderId: va.orderId },
          referenceKnown: receipts(s).some((r) => r.receipt === reference),
          candidates,
        })
        const row: StoredMpesaReceipt = {
          id: I.uuid(),
          orgId,
          provider: va.provider === 'flutterwave_va' ? 'flutterwave' : 'paystack',
          source: 'bank_transfer',
          receipt: reference,
          amountMinor: input.amountMinor,
          currency: 'NGN',
          accountRef: va.accountNumber,
          payerHint: '···4821',
          transactedAt: I.nowIso(),
          status: 'unmatched',
          reason: null,
          orderId: va.orderId,
          paymentId: null,
          createdAt: I.nowIso(),
          resolvedAt: null,
        }
        if (decision.kind === 'record') {
          const order = s.orders.find((o) => o.id === decision.orderId) ?? I.fail('Order not found', 'not_found')
          row.paymentId = recordVerified(I, s, order, row.provider, input.amountMinor, reference, row.transactedAt, 'Simulated bank transfer (demo, no money moved)', 'bank_transfer')
          row.status = 'matched'
          row.orderId = order.id
          row.resolvedAt = I.nowIso()
        } else if (decision.kind === 'unmatched') {
          row.reason = REVIEW_REASON_TEXT[decision.reason]
          row.orderId = decision.orderId
        } else {
          I.fail('This transfer could not be simulated', 'invalid')
        }
        receipts(s).push(row)
      }),
  }
}
