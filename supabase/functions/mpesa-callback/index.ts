// M-Pesa Daraja STK callback: POST /mpesa-callback?secret=<MPESA_CALLBACK_SECRET>
// Label: adapter_only.
//
// Daraja does not sign callbacks, so the URL carries a long random shared
// secret (set by mpesa-stk from MPESA_CALLBACK_SECRET) that is compared in
// constant time. Order of operations:
//   1. check secret  2. parse  3. insert into webhook_events (provider 'mpesa',
//   event id = CheckoutRequestID; unique = replay protection)
//   4. reconcile_mpesa_stk (one transaction): maps CheckoutRequestID -> order,
//      dedupes on the M-Pesa receipt, records the payment ONLY when the amount
//      equals the request and fits the balance due, confirms a fully paid new
//      order, and puts mismatches / late payments in the merchant's review queue
//   5. set processed_at (unknown requests and invalid bodies stay unprocessed)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/signatures.ts'
import { checkSourceIp } from '../_shared/source-ip.ts'
import { normaliseStkCallback } from '../_shared/collections.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// What Daraja expects back; it does not act on it, but a 200 stops noisy retries.
const ack = (extra: Record<string, unknown> = {}) => json({ ResultCode: 0, ResultDesc: 'Accepted', ...extra })

const enc = new TextEncoder()
const PROCESSED = new Set(['recorded', 'not_paid', 'review', 'duplicate'])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('MPESA_CALLBACK_SECRET')
  if (!secret) return json({ error: 'mpesa callback not configured' }, 503)
  const given = new URL(req.url).searchParams.get('secret') ?? ''
  if (!timingSafeEqual(enc.encode(given), enc.encode(secret))) return json({ error: 'Forbidden' }, 401)
  // Optional: only accept calls from Safaricom's addresses (see _shared/source-ip.ts).
  const ipCheck = checkSourceIp(req.headers, Deno.env.get('MPESA_ALLOWED_IPS'), Deno.env.get('MPESA_CLIENT_IP_HEADER'))
  if (!ipCheck.ok) return json({ error: ipCheck.reason }, ipCheck.status)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const cb = normaliseStkCallback(payload)
  if (!cb) return json({ error: 'Not an STK callback' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 503)
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data: inserted, error: insertError } = await db
    .from('webhook_events')
    .upsert({ provider: 'mpesa', event_id: cb.checkoutRequestId, payload }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('id')
  if (insertError) {
    console.error('mpesa-callback: failed to store event', insertError.code)
    return json({ error: 'Storage error' }, 500)
  }
  if (!inserted || inserted.length === 0) {
    const { data: existing } = await db
      .from('webhook_events')
      .select('processed_at')
      .eq('provider', 'mpesa')
      .eq('event_id', cb.checkoutRequestId)
      .maybeSingle()
    if (!existing || existing.processed_at) return ack({ duplicate: true })
  }

  const { data: result, error: rpcError } = await db.rpc('reconcile_mpesa_stk', {
    p_checkout_request_id: cb.checkoutRequestId,
    p_result_code: cb.resultCode,
    p_result_desc: cb.resultDesc,
    p_amount_minor: cb.amountMinor,
    p_receipt: cb.receipt,
    p_phone_hint: cb.phoneHint,
    p_transacted_at: cb.transactedAt,
  })
  if (rpcError) {
    console.error('mpesa-callback: reconcile failed', rpcError.code)
    return json({ error: 'Could not reconcile' }, 500) // Daraja retries; the event is still unprocessed
  }
  const outcome = String((result as { outcome?: unknown } | null)?.outcome ?? '')
  const orgId = (result as { org_id?: unknown } | null)?.org_id
  if (PROCESSED.has(outcome)) {
    await db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString(), ...(typeof orgId === 'string' ? { org_id: orgId } : {}) })
      .eq('provider', 'mpesa')
      .eq('event_id', cb.checkoutRequestId)
  }
  return ack({ outcome })
})
