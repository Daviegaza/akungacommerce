// M-Pesa Daraja C2B confirmation: POST /mpesa-c2b?secret=<MPESA_CALLBACK_SECRET>
// Label: adapter_only. Receives "customer paid the Till/Paybill directly" events
// (registered with Daraja's C2B Register URL API as the ConfirmationURL; no
// ValidationURL is used, so Safaricom never waits on us before completing a payment).
//
//   1. shared-secret check (constant time)  2. parse
//   3. webhook_events (provider 'mpesa_c2b', event id = TransID) for replay protection
//   4. reconcile_mpesa_c2b: shortcode -> the one business whose Daraja connection is
//      verified; auto-match only when the account reference is a live KES order
//      number AND the amount equals its balance due; otherwise -> unmatched queue
//   5. processed_at set for every outcome except unknown shortcode / invalid
import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/signatures.ts'
import { parseC2bConfirmation } from '../_shared/daraja.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ack = (extra: Record<string, unknown> = {}) => json({ ResultCode: 0, ResultDesc: 'Accepted', ...extra })
const enc = new TextEncoder()
const PROCESSED = new Set(['recorded', 'unmatched', 'duplicate'])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('MPESA_CALLBACK_SECRET')
  if (!secret) return json({ error: 'mpesa c2b not configured' }, 503)
  const given = new URL(req.url).searchParams.get('secret') ?? ''
  if (!timingSafeEqual(enc.encode(given), enc.encode(secret))) return json({ error: 'Forbidden' }, 401)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const c2b = parseC2bConfirmation(payload)
  if (!c2b) return json({ error: 'Not a C2B confirmation' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 503)
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data: inserted, error: insertError } = await db
    .from('webhook_events')
    .upsert({ provider: 'mpesa_c2b', event_id: c2b.transId, payload }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('id')
  if (insertError) {
    console.error('mpesa-c2b: failed to store event', insertError.code)
    return json({ error: 'Storage error' }, 500)
  }
  if (!inserted || inserted.length === 0) {
    const { data: existing } = await db
      .from('webhook_events')
      .select('processed_at')
      .eq('provider', 'mpesa_c2b')
      .eq('event_id', c2b.transId)
      .maybeSingle()
    if (!existing || existing.processed_at) return ack({ duplicate: true })
  }

  const { data: result, error: rpcError } = await db.rpc('reconcile_mpesa_c2b', {
    p_shortcode: c2b.shortcode,
    p_receipt: c2b.transId,
    p_amount_minor: c2b.amountMinor,
    p_account_ref: c2b.accountRef,
    p_payer_hint: c2b.payerHint,
    p_transacted_at: c2b.transactedAt,
  })
  if (rpcError) {
    console.error('mpesa-c2b: reconcile failed', rpcError.code)
    return json({ error: 'Could not reconcile' }, 500)
  }
  const outcome = String((result as { outcome?: unknown } | null)?.outcome ?? '')
  const orgId = (result as { org_id?: unknown } | null)?.org_id
  if (PROCESSED.has(outcome)) {
    await db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString(), ...(typeof orgId === 'string' ? { org_id: orgId } : {}) })
      .eq('provider', 'mpesa_c2b')
      .eq('event_id', c2b.transId)
  }
  return ack({ outcome })
})
