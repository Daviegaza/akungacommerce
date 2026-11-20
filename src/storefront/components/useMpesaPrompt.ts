import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PromptStatus } from '@/domain/reconciliation'
import type { SimulatedOutcome } from '@/gateway/storefront'
import { getStorefrontGateway } from '@/storefront/gateway'

/** How long we actively wait for M-Pesa before handing back control (the phone prompt itself expires sooner). */
export const WAIT_SECONDS = 90
/** Resend is offered only after this, so a slow prompt is not doubled by an impatient tap. */
export const RESEND_AFTER_SECONDS = 20

export type PromptPhase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string }
  /** Prompt is on the phone; polling every 3 s. */
  | { kind: 'waiting'; id: string; startedAt: number }
  /** Buyer stopped waiting, or the window ran out: we keep checking slowly so a late payment still shows. */
  | { kind: 'stopped'; id: string; reason: 'cancelled_by_buyer' | 'no_answer' }
  /** M-Pesa answered (paid, cancelled, timeout, failed, mismatch, late). */
  | { kind: 'done'; id: string; status: Exclude<PromptStatus, 'pending'>; resultCode: number | null }

/**
 * STK prompt lifecycle for one order. Status comes only from the server
 * (verified provider callbacks); this hook never decides that money arrived.
 */
export function useMpesaPrompt(token: string, onSettled: (status: PromptStatus) => void) {
  const [phase, setPhase] = useState<PromptPhase>({ kind: 'idle' })
  const settledRef = useRef(onSettled)
  useEffect(() => {
    settledRef.current = onSettled
  }, [onSettled])

  // awaiting_receipt (STK query said paid, no receipt yet) is shown as an outcome but keeps polling slowly.
  const awaitingId = phase.kind === 'done' && phase.status === 'awaiting_receipt' ? phase.id : null
  const activeId = phase.kind === 'waiting' || phase.kind === 'stopped' ? phase.id : awaitingId
  const statusQuery = useQuery({
    queryKey: ['mpesa-prompt', token, activeId],
    queryFn: async () => (await getStorefrontGateway()).getMpesaPromptStatus(token, activeId as string),
    enabled: activeId !== null,
    refetchInterval: phase.kind === 'waiting' ? 3_000 : 10_000,
    refetchIntervalInBackground: false,
    retry: 2,
    gcTime: 0,
  })

  const data = statusQuery.data
  useEffect(() => {
    if (!data || data.status === 'pending' || activeId === null) return
    const status = data.status
    // Server state is the source of truth: adopt it once it stops being pending.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external (server) state into local phase
    setPhase((p) =>
      p.kind === 'waiting' || p.kind === 'stopped' || (p.kind === 'done' && p.status === 'awaiting_receipt' && status !== 'awaiting_receipt')
        ? { kind: 'done', id: p.id, status, resultCode: data.resultCode }
        : p,
    )
    settledRef.current(status)
  }, [data, activeId])

  async function send(phoneE164: string, simulate?: SimulatedOutcome) {
    setPhase({ kind: 'sending' })
    try {
      const g = await getStorefrontGateway()
      const r = await g.requestMpesaPrompt(token, phoneE164, simulate ? { simulate } : undefined)
      if (r.status === 'prompt_sent') setPhase({ kind: 'waiting', id: r.checkoutRequestId, startedAt: Date.now() })
      else if (r.status === 'not_configured') setPhase({ kind: 'not_configured' })
      else setPhase({ kind: 'error', message: r.error })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error && e.message ? e.message : 'Could not send the M-Pesa prompt' })
    }
  }

  function stopWaiting(reason: 'cancelled_by_buyer' | 'no_answer') {
    setPhase((p) => (p.kind === 'waiting' ? { kind: 'stopped', id: p.id, reason } : p))
  }

  function reset() {
    setPhase({ kind: 'idle' })
  }

  return { phase, send, stopWaiting, reset }
}
