import { describe, expect, it } from 'vitest'
import { eventRows, processWhatsAppPayload, retryPendingWhatsApp, type StoredEventState, type WhatsAppStore } from './whatsapp-process.ts'

type Ev = { processed: boolean; dead: boolean; attempts: number; error?: string }

/** In-memory store with the same semantics as the SQL functions in 20261121000080_webhook_retry.sql. */
function fakeStore(opts: { failOptOut?: number; failMarkFailed?: boolean; maxAttempts?: number } = {}) {
  const events = new Map<string, Ev>()
  const consent = new Map<string, boolean>([['+254712345678', true]])
  let optOutFailuresLeft = opts.failOptOut ?? 0
  let optOutCalls = 0
  const store: WhatsAppStore = {
    async storeEvent(id) {
      const e = events.get(id)
      if (!e) {
        events.set(id, { processed: false, dead: false, attempts: 0 })
        return 'inserted'
      }
      return { processed: e.processed, dead: e.dead } satisfies StoredEventState
    },
    async applyOptOut(id, _pn, from) {
      optOutCalls++
      const e = events.get(id)!
      if (e.processed) return { outcome: 'duplicate' }
      if (optOutFailuresLeft > 0) {
        optOutFailuresLeft--
        throw new Error('connection reset') // the transaction rolls back: nothing changed
      }
      const had = consent.get(from) === true
      consent.set(from, false)
      e.processed = true
      e.attempts++
      return { outcome: 'opted_out', customers: had ? 1 : 0 }
    },
    async markProcessed(id) {
      const e = events.get(id)!
      e.processed = true
      e.attempts++
    },
    async markFailed(id, error) {
      if (opts.failMarkFailed) throw new Error('db down')
      const e = events.get(id)!
      e.attempts++
      e.error = error
      if (e.attempts >= (opts.maxAttempts ?? 8)) e.dead = true
      return { dead: e.dead }
    },
  }
  return { store, events, consent, calls: () => optOutCalls }
}

const stopPayload = (id = 'wamid.STOP1', text = 'STOP') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba1',
      changes: [{ value: { metadata: { phone_number_id: 'PN1' }, messages: [{ id, from: '254712345678', type: 'text', text: { body: text } }] } }],
    },
  ],
})

const hash = async (s: string) => `h${s.length}`
const rowsOf = (p: unknown) => eventRows(p, async () => 'raw', hash)

describe('WhatsApp webhook processing', () => {
  it('a successful opt-out withdraws consent and marks the event processed', async () => {
    const f = fakeStore()
    const p = stopPayload()
    const r = await processWhatsAppPayload(f.store, p, await rowsOf(p))
    expect(r).toMatchObject({ ok: true, processed: 1, optOuts: 1, failed: 0 })
    expect(f.consent.get('+254712345678')).toBe(false)
    expect(f.events.get('wamid.STOP1')).toMatchObject({ processed: true })
  })

  it('a duplicate delivery is skipped and has no second side effect', async () => {
    const f = fakeStore()
    const p = stopPayload()
    await processWhatsAppPayload(f.store, p, await rowsOf(p))
    const again = await processWhatsAppPayload(f.store, p, await rowsOf(p))
    expect(again).toMatchObject({ ok: true, duplicates: 1, processed: 0, optOuts: 0 })
    expect(f.calls()).toBe(1)
  })

  it('a failed consent update is NOT marked processed, is recorded, and asks for a retry', async () => {
    const f = fakeStore({ failOptOut: 1 })
    const p = stopPayload()
    const r = await processWhatsAppPayload(f.store, p, await rowsOf(p))
    expect(r).toMatchObject({ ok: false, failed: 1, processed: 0 })
    expect(f.events.get('wamid.STOP1')).toMatchObject({ processed: false, attempts: 1, error: 'connection reset' })
    expect(f.consent.get('+254712345678')).toBe(true)

    // Meta re-delivers the same event: it is stored but unprocessed, so it is processed now.
    const retry = await processWhatsAppPayload(f.store, p, await rowsOf(p))
    expect(retry).toMatchObject({ ok: true, processed: 1, optOuts: 1 })
    expect(f.consent.get('+254712345678')).toBe(false)
  })

  it('the scheduled retry also completes a failed opt-out', async () => {
    const f = fakeStore({ failOptOut: 1 })
    const p = stopPayload()
    await processWhatsAppPayload(f.store, p, await rowsOf(p))
    const r = await retryPendingWhatsApp(f.store, [{ eventId: 'wamid.STOP1', payload: p }], rowsOf)
    expect(r).toMatchObject({ ok: true, optOuts: 1 })
    expect(f.consent.get('+254712345678')).toBe(false)
  })

  it('after the last attempt the event is parked, not processed, and acknowledged', async () => {
    const f = fakeStore({ failOptOut: 99, maxAttempts: 2 })
    const p = stopPayload()
    expect((await processWhatsAppPayload(f.store, p, await rowsOf(p))).ok).toBe(false)
    const second = await processWhatsAppPayload(f.store, p, await rowsOf(p))
    expect(second).toMatchObject({ ok: true, parked: 1 })
    expect(f.events.get('wamid.STOP1')).toMatchObject({ processed: false, dead: true })
    // Further deliveries do nothing.
    expect(await processWhatsAppPayload(f.store, p, await rowsOf(p))).toMatchObject({ parked: 1, failed: 0 })
  })

  it('if even the failure cannot be recorded, the whole request fails (provider retries)', async () => {
    const f = fakeStore({ failOptOut: 1, failMarkFailed: true })
    const p = stopPayload()
    await expect(processWhatsAppPayload(f.store, p, await rowsOf(p))).rejects.toThrow('db down')
    expect(f.events.get('wamid.STOP1')?.processed).toBe(false)
  })

  it('a normal message is just marked processed; consent is untouched', async () => {
    const f = fakeStore()
    const p = stopPayload('wamid.HI', 'Hi, is the basket in stock?')
    expect(await processWhatsAppPayload(f.store, p, await rowsOf(p))).toMatchObject({ ok: true, processed: 1, optOuts: 0 })
    expect(f.consent.get('+254712345678')).toBe(true)
    expect(f.calls()).toBe(0)
  })

  it('status-only deliveries get one content-keyed row', async () => {
    const p = { entry: [{ id: 'w', changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'read', timestamp: '1' }] } }] }] }
    expect(await rowsOf(p)).toEqual([{ eventId: 'statuses:wamid.X:read:1' }])
  })
})
