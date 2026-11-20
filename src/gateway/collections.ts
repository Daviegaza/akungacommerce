/**
 * Merchant-side M-Pesa collections and reconciliation contract.
 * Mirrors supabase/migrations/20261120000020_mpesa_reconciliation.sql.
 * Implemented by the Supabase gateway (collections-supabase.ts) and the demo
 * gateway (collections-demo.ts, simulated, clearly labelled).
 */
import type { CollectionsProviderId, PromptStatus, ReceiptStatus, ReceiptVerification } from '@/domain/reconciliation'

export type { CollectionsProviderId, PromptStatus, ReceiptStatus, ReceiptVerification }

export interface CollectionsSettings {
  provider: CollectionsProviderId
  /** Aggregator id when provider = 'aggregator' (e.g. 'intasend'). */
  aggregator: string | null
}

/** One STK prompt sent to a customer's phone. */
export interface MpesaPrompt {
  checkoutRequestId: string
  orderId: string
  orderNumber: number | null
  provider: string
  amountMinor: number
  status: PromptStatus
  resultCode: number | null
  resultDesc: string | null
  receipt: string | null
  /** Last 3 digits of the phone that was prompted. */
  phoneHint: string | null
  createdAt: string
  resolvedAt: string | null
  /** True only in the demo workspace. */
  simulated: boolean
}

/** One verified M-Pesa receipt that reached the server (STK callback or C2B confirmation). */
export interface MpesaReceipt {
  id: string
  provider: string
  source: 'stk' | 'c2b' | 'aggregator'
  receipt: string
  amountMinor: number
  currency: string
  accountRef: string | null
  payerHint: string | null
  transactedAt: string
  status: ReceiptStatus
  reason: string | null
  orderId: string | null
  orderNumber: number | null
  paymentId: string | null
  createdAt: string
  resolvedAt: string | null
  simulated: boolean
}

export interface SimulatedIncomingInput {
  amountMinor: number
  accountRef: string | null
}

export interface CollectionsAdminGateway {
  getCollectionsSettings(orgId: string): Promise<CollectionsSettings>
  setCollectionsProvider(orgId: string, settings: CollectionsSettings): Promise<void>
  listMpesaPrompts(orgId: string): Promise<MpesaPrompt[]>
  listMpesaReceipts(orgId: string): Promise<MpesaReceipt[]>
  /** Attach a queued (unmatched / mismatch / late) receipt to an order. Returns the payment id. */
  attachMpesaReceipt(orgId: string, receiptId: string, orderId: string): Promise<string>
  dismissMpesaReceipt(orgId: string, receiptId: string, reason: string): Promise<void>
  /** Check a pasted M-Pesa code against receipts that really reached the server. */
  verifyMpesaReceipt(orgId: string, code: string): Promise<ReceiptVerification>
  /** Demo workspace only: pretend a customer paid the Till/Paybill directly. Absent in Supabase mode. */
  simulateIncomingMpesa?(orgId: string, input: SimulatedIncomingInput): Promise<void>
}

export const PROMPT_STATUS_LABEL: Record<PromptStatus, string> = {
  pending: 'Waiting for PIN',
  paid: 'Paid',
  cancelled: 'Cancelled by customer',
  timeout: 'Expired',
  failed: 'Failed',
  mismatch: 'Paid, needs review',
  late: 'Paid late, needs review',
}

export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  matched: 'Matched automatically',
  unmatched: 'Unmatched',
  mismatch: 'Amount mismatch',
  late: 'Late or extra payment',
  attached: 'Attached by staff',
  dismissed: 'Dismissed',
}
