// WhatsApp Business Platform (Cloud API) webhook.
// Label: adapter_only — not connected until a Meta app, phone number, approved
// templates and this webhook URL are configured and an end-to-end test passes.
//
// GET  = Meta verification handshake.
// POST = signature-verified inbound events, deduplicated via webhook_events.
// POST ?retry=1 = scheduled retry of stored, unprocessed events. Caller auth:
//        `x-retry-secret: <WEBHOOK_RETRY_SECRET>` (>= 16 chars) or `Authorization: Bearer <service role key>`.
//
// Reliability: an opt-out is marked processed only in the same database transaction that
// withdraws consent (whatsapp_apply_opt_out). A failure is recorded (webhook_event_failed) and the
// request returns 500 so Meta re-delivers; re-deliveries of unprocessed events are processed again,
// processed ones are skipped. After 8 failed attempts an event is parked for a person to review.
// This function never sends a reply.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex, verifyMetaSignature } from '../_shared/signatures.ts'
import { eventRows, processWhatsAppPayload, retryPendingWhatsApp, type WhatsAppStore } from '../_shared/whatsapp-process.ts'
import { safeEqual } from '../_shared/media-cleanup.ts'

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Db = SupabaseClient

function storeFor(db: Db): WhatsAppStore {
  return {
    async storeEvent(eventId, payload) {
      const { data: inserted, error } = await db
        .from('webhook_events')
        .upsert({ provider: 'whatsapp', event_id: eventId, payload }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(`store failed: ${error.code}`)
      if (inserted && inserted.length > 0) return 'inserted'
      const { data: existing, error: readError } = await db
        .from('webhook_events')
        .select('processed_at, dead_at')
        .eq('provider', 'whatsapp')
        .eq('event_id', eventId)
        .maybeSingle()
      if (readError || !existing) throw new Error(`read failed: ${readError?.code ?? 'missing'}`)
      const row = existing as { processed_at: string | null; dead_at: string | null }
      return { processed: row.processed_at !== null, dead: row.dead_at !== null }
    },
    async applyOptOut(eventId, phoneNumberId, fromE164) {
      const { data, error } = await db.rpc('whatsapp_apply_opt_out', {
        p_event_id: eventId,
        p_phone_number_id: phoneNumberId,
        p_from_e164: fromE164,
      })
      if (error) throw new Error(`opt-out failed: ${error.code}`)
      return data as { outcome: string; customers?: number }
    },
    async markProcessed(eventId) {
      const { error } = await db.rpc('webhook_event_processed', { p_provider: 'whatsapp', p_event_id: eventId })
      if (error) throw new Error(`mark processed failed: ${error.code}`)
    },
    async markFailed(eventId, message) {
      const { data, error } = await db.rpc('webhook_event_failed', { p_provider: 'whatsapp', p_event_id: eventId, p_error: message })
      if (error) throw new Error(`record failure failed: ${error.code}`) // caller returns 500; the event stays unprocessed
      return { dead: Boolean((data as { dead?: boolean } | null)?.dead) }
    },
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? ''
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token') ?? ''
    const challenge = url.searchParams.get('hub.challenge') ?? ''
    if (expected && mode === 'subscribe' && safeEqual(token, expected)) return text(challenge)
    return text('Forbidden', 403)
  }

  if (req.method !== 'POST') return text('Method not allowed', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  // Scheduled retry of stored events that are not processed yet.
  if (url.searchParams.get('retry') === '1') {
    if (!supabaseUrl || !serviceKey) return json({ status: 'not_configured' }, 503)
    const secret = Deno.env.get('WEBHOOK_RETRY_SECRET') ?? ''
    const given = req.headers.get('x-retry-secret') ?? ''
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const allowed = (secret.length >= 16 && safeEqual(given, secret)) || (bearer.length > 0 && safeEqual(bearer, serviceKey))
    if (!allowed) return json({ error: 'Not allowed' }, 401)
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data, error } = await db.rpc('webhook_events_pending', { p_provider: 'whatsapp', p_limit: 50 })
    if (error) return json({ error: 'Could not list pending events' }, 500)
    const pending = ((data ?? []) as { event_id: string; payload: unknown }[]).map((r) => ({ eventId: r.event_id, payload: r.payload }))
    try {
      const report = await retryPendingWhatsApp(storeFor(db), pending, (p) => eventRows(p, async () => sha256Hex(JSON.stringify(p)), sha256Hex))
      console.log(JSON.stringify({ fn: 'whatsapp-webhook', mode: 'retry', ...report }))
      return json(report, report.ok ? 200 : 500)
    } catch (e) {
      console.error('whatsapp-webhook retry: could not record a failure', e instanceof Error ? e.message : 'unknown')
      return json({ error: 'Retry failed' }, 500)
    }
  }

  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!appSecret) return text('WhatsApp webhook not configured', 503)

  // Raw body first: the signature covers the exact bytes.
  const rawBody = await req.text()
  const verdict = await verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'), appSecret)
  if (!verdict.ok) return text('Invalid signature', 401)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return text('Invalid JSON', 400)
  }

  if (!supabaseUrl || !serviceKey) return text('Server not configured', 503)
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    const rows = await eventRows(payload, () => sha256Hex(rawBody), sha256Hex)
    const report = await processWhatsAppPayload(storeFor(db), payload, rows)
    // Counts only: no phone numbers or message text in logs.
    console.log(JSON.stringify({ fn: 'whatsapp-webhook', ...report }))
    return report.ok ? text('OK') : text('Retry later', 500)
  } catch (e) {
    console.error('whatsapp-webhook: storage error', e instanceof Error ? e.message : 'unknown')
    return text('Storage error', 500) // Meta retries
  }
})
