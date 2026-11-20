/**
 * Buyer-visible payment events on the tracking timeline (pure, no React).
 *
 * Payments never move status timestamps: each payment is shown under the status step
 * that was current when it arrived (the latest step reached at or before it), so a
 * partial payment, or one received after confirmation, is visible on its own line.
 */
import type { TrackedPaymentEvent } from '@/gateway/storefront'

export interface StepTime {
  key: string
  /** First time the status was reached (null for upcoming steps). */
  at: string | null
}

/** step key -> payments that arrived while that step was current, oldest first. */
export function attachPaymentEvents(steps: StepTime[], payments: TrackedPaymentEvent[]): Map<string, TrackedPaymentEvent[]> {
  const out = new Map<string, TrackedPaymentEvent[]>()
  const reached = steps.filter((s): s is StepTime & { at: string } => s.at !== null).sort((a, b) => a.at.localeCompare(b.at))
  if (steps.length === 0) return out
  const sorted = [...payments].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  for (const p of sorted) {
    let owner = reached[0]?.key ?? steps[0].key
    for (const s of reached) if (s.at <= p.receivedAt) owner = s.key
    const list = out.get(owner) ?? []
    list.push(p)
    out.set(owner, list)
  }
  return out
}

/** Who confirmed the money, in buyer words. */
export function paymentSourceText(p: Pick<TrackedPaymentEvent, 'method' | 'verified'>): string {
  if (!p.verified) return 'recorded by the shop'
  switch (p.method) {
    case 'mobile_money':
      return 'confirmed by M-Pesa'
    case 'bank_transfer':
      return 'confirmed by the bank transfer provider'
    case 'card':
      return 'confirmed by the card provider'
    default:
      return 'confirmed by the payment provider'
  }
}
