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
  /** bank_transfer: an NGN transfer into a dedicated account (receipt = provider reference). */
  source: 'stk' | 'c2b' | 'aggregator' | 'bank_transfer'
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

/** What staff may see about a shop's own Daraja credentials. Secrets never leave the server. */
export type MpesaCredentialsSummary =
  | { configured: false }
  | {
      configured: true
      environment: 'sandbox' | 'production'
      shortcode: string
      transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
      partyB: string | null
      keyHint: string
      updatedAt: string
    }

export interface MpesaCredentialsInput {
  environment: 'sandbox' | 'production'
  shortcode: string
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
  partyB: string | null
  /** Blank = keep the stored value. */
  consumerKey: string
  consumerSecret: string
  passkey: string
}

export interface CollectionsAdminGateway {
  getCollectionsSettings(orgId: string): Promise<CollectionsSettings>
  setCollectionsProvider(orgId: string, settings: CollectionsSettings): Promise<void>
  /* The shop's own Daraja credentials (migration 20261122000100): money goes to the shop's own Till/Paybill. */
  getMpesaCredentials(orgId: string): Promise<MpesaCredentialsSummary>
  saveMpesaCredentials(orgId: string, input: MpesaCredentialsInput): Promise<MpesaCredentialsSummary>
  clearMpesaCredentials(orgId: string): Promise<void>
  /** Owner/admin confirms a live test payment reached Fungua; prompts start only after this. */
  markMpesaVerified(orgId: string): Promise<void>
  listMpesaPrompts(orgId: string): Promise<MpesaPrompt[]>
  listMpesaReceipts(orgId: string): Promise<MpesaReceipt[]>
  /** Attach a queued (unmatched / mismatch / late) receipt to an order. Returns the payment id. */
  attachMpesaReceipt(orgId: string, receiptId: string, orderId: string): Promise<string>
  dismissMpesaReceipt(orgId: string, receiptId: string, reason: string): Promise<void>
  /** Check a pasted M-Pesa code against receipts that really reached the server. */
  verifyMpesaReceipt(orgId: string, code: string): Promise<ReceiptVerification>
  /** Demo workspace only: pretend a customer paid the Till/Paybill directly. Absent in Supabase mode. */
  simulateIncomingMpesa?(orgId: string, input: SimulatedIncomingInput): Promise<void>

  /* Nigeria bank transfer (dedicated virtual accounts), migration 20261120000060. */
  /** Dedicated accounts stored for this business (only ever ones a provider returned, or simulated in the demo). */
  listVirtualAccounts(orgId: string): Promise<VirtualAccountRecord[]>
  /**
   * Ask the shop's provider for a dedicated account for this order. adapter_only: the
   * Supabase gateway never calls a provider and answers not_configured; the demo simulates one.
   */
  assignVirtualAccount(orgId: string, orderId: string): Promise<AssignVirtualAccountResult>
  /** Demo workspace only: pretend a buyer transferred money into a dedicated account. Absent in Supabase mode. */
  simulateBankTransfer?(orgId: string, input: SimulatedTransferInput): Promise<void>
}

export interface VirtualAccountRecord {
  id: string
  provider: 'paystack_dva' | 'flutterwave_va'
  bankName: string
  accountNumber: string
  accountName: string | null
  orderId: string | null
  orderNumber: number | null
  customerId: string | null
  status: 'active' | 'retired'
  createdAt: string
  simulated: boolean
}

export type AssignVirtualAccountResult =
  | { status: 'assigned'; account: VirtualAccountRecord }
  | { status: 'not_configured'; reason: string }

export interface SimulatedTransferInput {
  /** The dedicated account the buyer paid into. */
  accountNumber: string
  /** Kobo (minor units). */
  amountMinor: number
}

/** Where a queued payment came from, in plain words. */
export function receiptSourceText(source: MpesaReceipt['source']): string {
  switch (source) {
    case 'c2b':
      return 'Paid to your Till/Paybill directly'
    case 'bank_transfer':
      return 'Bank transfer to a dedicated account'
    case 'aggregator':
      return 'Through your payment aggregator'
    default:
      return 'From an M-Pesa prompt'
  }
}

/** Short provider name for the queue's provider column. */
export function receiptProviderText(r: Pick<MpesaReceipt, 'provider' | 'source'>): string {
  if (r.source === 'bank_transfer') return r.provider === 'paystack' ? 'Paystack bank transfer' : r.provider === 'flutterwave' ? 'Flutterwave bank transfer' : 'Bank transfer'
  return r.provider === 'mpesa' ? 'M-Pesa' : r.provider
}

export const PROMPT_STATUS_LABEL: Record<PromptStatus, string> = {
  pending: 'Waiting for PIN',
  awaiting_receipt: 'M-Pesa says paid — waiting for receipt',
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
