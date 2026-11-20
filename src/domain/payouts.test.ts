import { describe, expect, it } from 'vitest'
import { HOLD_REASON_TEXT, HOLD_REASONS, moneyFlowFor, PAYOUT_RULES, totalsByState, validSettlements, type Settlement } from './payouts'

const base = { aggregator: null, aggregatorConnected: false, mpesaTill: null, mpesaPaybill: null, registeredName: null }

describe('money flow', () => {
  it('Daraja and manual collection go straight to the merchant: nothing held, nothing to settle', () => {
    expect(moneyFlowFor({ ...base, provider: 'daraja', mpesaTill: '5123456', registeredName: 'MTO HOME' })).toEqual({
      kind: 'direct',
      provider: 'daraja',
      destination: { type: 'till', number: '5123456' },
      registeredName: 'MTO HOME',
    })
    expect(moneyFlowFor({ ...base, provider: 'manual', mpesaPaybill: '400200' })).toMatchObject({ kind: 'direct', destination: { type: 'paybill', number: '400200' } })
    expect(moneyFlowFor({ ...base, provider: 'manual' })).toMatchObject({ kind: 'direct', destination: null })
  })

  it('an unconnected aggregator never shows settlement rows', () => {
    const rows: Settlement[] = [{ id: '1', amountMinor: 1000, currency: 'KES', state: 'settled', expectedAt: null, settledAt: '2026-11-20T00:00:00Z', holdReason: null }]
    const flow = moneyFlowFor({ ...base, provider: 'aggregator', aggregator: 'intasend', settlements: rows })
    expect(flow).toEqual({ kind: 'aggregator', aggregator: 'intasend', connected: false, settlements: [] })
  })

  it('a held settlement must have a reason, and only holds may have one', () => {
    const rows: Settlement[] = [
      { id: 'a', amountMinor: 500, currency: 'KES', state: 'held', expectedAt: null, settledAt: null, holdReason: 'dispute' },
      { id: 'b', amountMinor: 500, currency: 'KES', state: 'held', expectedAt: null, settledAt: null, holdReason: null },
      { id: 'c', amountMinor: 900, currency: 'KES', state: 'pending', expectedAt: null, settledAt: null, holdReason: 'dispute' },
      { id: 'd', amountMinor: 900, currency: 'KES', state: 'pending', expectedAt: '2026-11-21T00:00:00Z', settledAt: null, holdReason: null },
    ]
    expect(validSettlements(rows).map((r) => r.id)).toEqual(['a', 'd'])
    const flow = moneyFlowFor({ ...base, provider: 'aggregator', aggregator: 'intasend', aggregatorConnected: true, settlements: rows })
    expect(flow.kind === 'aggregator' && flow.settlements.map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('totals by state and currency, never mixing currencies', () => {
    const rows: Settlement[] = [
      { id: '1', amountMinor: 100, currency: 'KES', state: 'settled', expectedAt: null, settledAt: null, holdReason: null },
      { id: '2', amountMinor: 200, currency: 'KES', state: 'settled', expectedAt: null, settledAt: null, holdReason: null },
      { id: '3', amountMinor: 50, currency: 'UGX', state: 'pending', expectedAt: null, settledAt: null, holdReason: null },
    ]
    expect(totalsByState(rows)).toEqual([
      { state: 'pending', currency: 'UGX', totalMinor: 50, count: 1 },
      { state: 'settled', currency: 'KES', totalMinor: 300, count: 2 },
    ])
  })

  it('every hold reason has an action, and the rules say Rafu never holds money', () => {
    for (const r of HOLD_REASONS) expect(HOLD_REASON_TEXT[r].action.length).toBeGreaterThan(10)
    expect(PAYOUT_RULES[0]).toContain('Rafu never holds your money')
  })
})
