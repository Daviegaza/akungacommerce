// WhatsApp Business Platform (Cloud API) webhook.
// Label: adapter_only — not connected until a Meta app, phone number, approved
// templates and this webhook URL are configured and an end-to-end test passes.
//
// GET  = Meta verification handshake.
// POST = signature-verified inbound events, deduplicated via webhook_events.
// This function never sends a reply.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex, verifyMetaSignature } from '../_shared/signatures.ts'
import { extractWhatsAppEvents } from '../_shared/providers.ts'
import { isOptOut } from '../_shared/consent.ts'

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? ''
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token') ?? ''
    const challenge = url.searchParams.get('hub.challenge') ?? ''
    if (expected && mode === 'subscribe' && constantTimeEqual(token, expected)) return text(challenge)
    return text('Forbidden', 403)
  }

  if (req.method !== 'POST') return text('Method not allowed', 405)

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return text('Server not configured', 503)
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { messages, statuses, entryIds } = extractWhatsAppEvents(payload)

  // One webhook_events row per inbound message; statuses/other changes get one row per delivery.
  const rows: { event_id: string; message?: (typeof messages)[number] }[] = messages.map((m) => ({ event_id: m.id, message: m }))
  if (rows.length === 0) {
    const key = statuses.length
      ? `statuses:${statuses.map((s) => `${s.id}:${s.status}:${s.timestamp ?? ''}`).join('|')}`
      : `entry:${entryIds.join(',')}:${await sha256Hex(rawBody)}`
    rows.push({ event_id: key.length > 500 ? `sha256:${await sha256Hex(key)}` : key })
  }

  for (const row of rows) {
    const { data: inserted, error } = await db
      .from('webhook_events')
      .upsert({ provider: 'whatsapp', event_id: row.event_id, payload }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error('whatsapp-webhook: failed to store event', error.code)
      return text('Storage error', 500) // Meta retries
    }
    if (!inserted || inserted.length === 0) continue // duplicate delivery: already stored, do not reprocess

    const m = row.message
    if (m && isOptOut(m.text) && m.phoneNumberId) {
      // TODO(whatsapp): minimal opt-out recording. Maps the receiving phone number
      // id to an org via integration_connections.public_config.phone_number_id and
      // withdraws marketing consent for the matching customer. Needs an end-to-end
      // test with a real number before this integration can be labelled verified.
      const { data: conn } = await db
        .from('integration_connections')
        .select('org_id')
        .eq('provider', 'whatsapp')
        .eq('public_config->>phone_number_id', m.phoneNumberId)
        .maybeSingle()
      if (conn?.org_id) {
        const { error: consentError } = await db
          .from('customers')
          .update({ marketing_consent: false, consent_updated_at: new Date().toISOString() })
          .eq('org_id', conn.org_id)
          .eq('phone_e164', m.fromE164)
        if (consentError) console.error('whatsapp-webhook: opt-out update failed', consentError.code)
        await db.from('webhook_events').update({ org_id: conn.org_id }).eq('provider', 'whatsapp').eq('event_id', row.event_id)
      }
    }

    await db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'whatsapp')
      .eq('event_id', row.event_id)
  }

  return text('OK')
})
