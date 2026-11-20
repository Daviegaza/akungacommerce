/**
 * WhatsApp webhook processing, separated from Deno.serve so it can be unit tested.
 *
 * Reliability rules:
 *   - An opt-out is marked processed only by whatsapp_apply_opt_out(), which changes consent and
 *     marks the event processed in one database transaction.
 *   - Any failure records a durable attempt (webhook_event_failed) and makes the request fail, so
 *     the provider re-delivers. A re-delivery of an event that is stored but not yet processed is
 *     processed again; a processed one is skipped (idempotent).
 *   - Nothing here sends a message.
 */
import { extractWhatsAppEvents, type WhatsAppInboundMessage } from './providers.ts'
import { isOptOut } from './consent.ts'

export interface StoredEventState {
  processed: boolean
  dead: boolean
}

export interface WhatsAppStore {
  /** Insert the event if new. Returns 'inserted', or the state of the existing row. */
  storeEvent(eventId: string, payload: unknown): Promise<'inserted' | StoredEventState>
  applyOptOut(eventId: string, phoneNumberId: string, fromE164: string): Promise<{ outcome: string; customers?: number }>
  markProcessed(eventId: string): Promise<void>
  markFailed(eventId: string, error: string): Promise<{ dead: boolean }>
}

export interface ProcessReport {
  /** True when every event is now processed (or already was, or is parked). False = ask for a retry. */
  ok: boolean
  processed: number
  duplicates: number
  optOuts: number
  failed: number
  parked: number
}

type Row = { eventId: string; message?: WhatsAppInboundMessage }

/** One webhook_events row per inbound message; a status-only delivery gets one row keyed on its content. */
export async function eventRows(payload: unknown, rawBodyHash: () => Promise<string>, hashKey: (k: string) => Promise<string>): Promise<Row[]> {
  const { messages, statuses, entryIds } = extractWhatsAppEvents(payload)
  const rows: Row[] = messages.map((m) => ({ eventId: m.id, message: m }))
  if (rows.length === 0) {
    const key = statuses.length
      ? `statuses:${statuses.map((s) => `${s.id}:${s.status}:${s.timestamp ?? ''}`).join('|')}`
      : `entry:${entryIds.join(',')}:${await rawBodyHash()}`
    rows.push({ eventId: key.length > 500 ? `sha256:${await hashKey(key)}` : key })
  }
  return rows
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 300)
  return 'unknown error'
}

/** Process one event row. Throws only if even the failure could not be recorded. */
async function processRow(store: WhatsAppStore, row: Row, report: ProcessReport): Promise<void> {
  const m = row.message
  try {
    if (m && m.phoneNumberId && isOptOut(m.text)) {
      const r = await store.applyOptOut(row.eventId, m.phoneNumberId, m.fromE164)
      if (r.outcome === 'duplicate') report.duplicates++
      else if (r.outcome === 'dead') report.parked++
      else {
        report.processed++
        if (r.outcome === 'opted_out') report.optOuts++
      }
      return
    }
    await store.markProcessed(row.eventId)
    report.processed++
  } catch (e) {
    report.failed++
    const { dead } = await store.markFailed(row.eventId, errorText(e))
    if (dead) report.parked++
  }
}

export async function processWhatsAppPayload(store: WhatsAppStore, payload: unknown, rows: Row[]): Promise<ProcessReport> {
  const report: ProcessReport = { ok: true, processed: 0, duplicates: 0, optOuts: 0, failed: 0, parked: 0 }
  for (const row of rows) {
    const stored = await store.storeEvent(row.eventId, payload) // throws on storage error -> caller returns 500
    if (stored !== 'inserted') {
      if (stored.processed) {
        report.duplicates++
        continue
      }
      if (stored.dead) {
        report.parked++
        continue
      }
      // Stored earlier but not processed (an earlier attempt failed): process it again now.
    }
    await processRow(store, row, report)
  }
  // A failure that was parked is acknowledged (a person must look at it); anything else is retried.
  report.ok = report.failed === 0 || report.failed === report.parked
  return report
}

/** Re-run stored, unprocessed events (scheduled retry). */
export async function retryPendingWhatsApp(
  store: WhatsAppStore,
  pending: { eventId: string; payload: unknown }[],
  rowsFor: (payload: unknown) => Promise<Row[]>,
): Promise<ProcessReport> {
  const report: ProcessReport = { ok: true, processed: 0, duplicates: 0, optOuts: 0, failed: 0, parked: 0 }
  for (const p of pending) {
    const rows = (await rowsFor(p.payload)).filter((r) => r.eventId === p.eventId)
    // A status-only row is keyed on content, not a message id; if it no longer maps, settle it.
    const row = rows[0] ?? { eventId: p.eventId }
    await processRow(store, row, report)
  }
  report.ok = report.failed === 0 || report.failed === report.parked
  return report
}
