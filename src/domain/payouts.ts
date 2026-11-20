/**
 * "Where's my money": where a shop's M-Pesa money goes and when (pure, no I/O).
 *
 * With Daraja (direct) or manual collection, buyers pay the merchant's own
 * Till or Paybill. The money lands in the merchant's M-Pesa account straight
 * away and Rafu never holds it, so there is nothing to settle.
 *
 * With an aggregator (for Pochi la Biashara or a personal number), the
 * aggregator collects and later settles to the merchant. Settlement states are
 * modelled here so the UI can show them honestly, but no aggregator is
 * connected in this build: there is no settlement data, and the UI says so.
 */
import type { CollectionsProviderId } from './reconciliation'

export const SETTLEMENT_STATES = ['pending', 'settled', 'held'] as const
export type SettlementState = (typeof SETTLEMENT_STATES)[number]

export const HOLD_REASONS = ['kyc_incomplete', 'dispute', 'risk_review', 'payout_details_missing', 'provider_reserve'] as const
export type HoldReason = (typeof HOLD_REASONS)[number]

export const SETTLEMENT_STATE_TEXT: Record<SettlementState, { label: string; meaning: string }> = {
  pending: { label: 'On its way', meaning: 'Collected by the aggregator and scheduled to reach you.' },
  settled: { label: 'Paid out to you', meaning: 'Sent to your payout account. Check your M-Pesa or bank statement.' },
  held: { label: 'Held', meaning: 'Not sent yet. The reason is shown, with what you can do about it.' },
}

/** Every hold must come with a reason the merchant can act on. */
export const HOLD_REASON_TEXT: Record<HoldReason, { label: string; action: string }> = {
  kyc_incomplete: { label: 'Identity check not finished', action: 'Finish the identity check with the aggregator.' },
  dispute: { label: 'A buyer disputed this payment', action: 'Reply to the dispute with proof of delivery.' },
  risk_review: { label: 'Under review by the aggregator', action: 'The aggregator must tell you what they need and by when.' },
  payout_details_missing: { label: 'No payout account set', action: 'Add the M-Pesa or bank account to pay out to.' },
  provider_reserve: { label: 'Kept as a reserve by the aggregator', action: 'Ask the aggregator for the release date.' },
}

export interface Settlement {
  id: string
  amountMinor: number
  currency: string
  state: SettlementState
  /** When the aggregator says the money should arrive. */
  expectedAt: string | null
  settledAt: string | null
  /** Required when state = 'held'; null otherwise. */
  holdReason: HoldReason | null
}

export type MoneyFlow =
  | {
      kind: 'direct'
      provider: Exclude<CollectionsProviderId, 'aggregator'>
      /** Where buyers pay. Null when the shop has not set a Till or Paybill yet. */
      destination: { type: 'till' | 'paybill'; number: string } | null
      registeredName: string | null
    }
  | {
      kind: 'aggregator'
      aggregator: string | null
      /** False in this build: no aggregator is connected, so there is no settlement data. */
      connected: boolean
      settlements: Settlement[]
    }

export interface MoneyFlowInput {
  provider: CollectionsProviderId
  aggregator: string | null
  aggregatorConnected: boolean
  mpesaTill: string | null
  mpesaPaybill: string | null
  registeredName: string | null
  /** Only ever non-empty from a connected aggregator. */
  settlements?: Settlement[]
}

export function moneyFlowFor(input: MoneyFlowInput): MoneyFlow {
  if (input.provider === 'aggregator') {
    return {
      kind: 'aggregator',
      aggregator: input.aggregator,
      connected: input.aggregatorConnected,
      // Never show settlement rows from an unconnected source.
      settlements: input.aggregatorConnected ? validSettlements(input.settlements ?? []) : [],
    }
  }
  const destination = input.mpesaTill
    ? { type: 'till' as const, number: input.mpesaTill }
    : input.mpesaPaybill
      ? { type: 'paybill' as const, number: input.mpesaPaybill }
      : null
  return { kind: 'direct', provider: input.provider, destination, registeredName: input.registeredName }
}

/** A held settlement without a reason is not allowed: it would be "money held without explanation". */
export function validSettlements(rows: Settlement[]): Settlement[] {
  return rows.filter((r) => (r.state === 'held' ? r.holdReason !== null : r.holdReason === null))
}

export function totalsByState(rows: Settlement[]): { state: SettlementState; currency: string; totalMinor: number; count: number }[] {
  const map = new Map<string, { state: SettlementState; currency: string; totalMinor: number; count: number }>()
  for (const r of rows) {
    const k = `${r.state}:${r.currency}`
    const t = map.get(k) ?? { state: r.state, currency: r.currency, totalMinor: 0, count: 0 }
    t.totalMinor += r.amountMinor
    t.count += 1
    map.set(k, t)
  }
  return [...map.values()].sort((a, b) => SETTLEMENT_STATES.indexOf(a.state) - SETTLEMENT_STATES.indexOf(b.state) || a.currency.localeCompare(b.currency))
}

/** Plain rules shown to every merchant. */
export const PAYOUT_RULES: readonly string[] = [
  'Rafu never holds your money. It does not sit between your buyer and your M-Pesa.',
  'With your own Till or Paybill, each payment lands in your M-Pesa account the moment the buyer pays. Safaricom’s normal tariff for your Till or Paybill applies.',
  'With an aggregator, the aggregator holds the money until it pays you out. Their payout timing and fees apply, and they must give a reason for any hold.',
  'Rafu only marks an order paid from a confirmed M-Pesa record, never from a screenshot or an SMS someone forwards.',
]
