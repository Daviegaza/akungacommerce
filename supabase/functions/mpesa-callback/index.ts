// M-Pesa Daraja STK callback: POST /mpesa-callback?secret=<MPESA_CALLBACK_SECRET>
// Label: adapter_only.
//
// Daraja does not sign callbacks, so the URL carries a long random shared
// secret (set by mpesa-stk from MPESA_CALLBACK_SECRET) that is compared in
// constant time. Order of operations (mirrors payment-webhook):
//   1. check secret  2. parse  3. insert into webhook_events (provider 'mpesa',
//   event id = CheckoutRequestID; unique = replay protection)
//   4. map CheckoutRequestID -> order via mpesa_requests and check the amount
//   5. on ResultCode 0 only: record_verified_payment (refuses unless the org's
//      'mpesa' connection is connected_verified)  6. set processed_at
// Anything unexpected is left unprocessed in webhook_events for manual review.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/signatures.ts'
import { kesToMinor, parseStkCallback } from '../_shared/daraja.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// What Daraja expects back; it does not act on it, but a 200 stops noisy retries.
const ack = (extra: Record<string, unknown> = {}) => json({ ResultCode: 0, ResultDesc: 'Accepted', ...extra })

const PERMANENT_ERRORS = new Set(['P0002', '22023', '23503', '23514', '42501'])
const enc = new TextEncoder()

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('MPESA_CALLBACK_SECRET')
  if (!secret) return json({ error: 'mpesa callback not configured' }, 503)
  const given = new URL(req.url).searchParams.get('secret') ?? ''
  if (!timingSafeEqual(enc.encode(given), enc.encode(secret))) return json({ error: 'Forbidden' }, 401)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const cb = parseStkCallback(payload)
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

  const markProcessed = (orgId: string | null = null) =>
    db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString(), ...(orgId ? { org_id: orgId } : {}) })
      .eq('provider', 'mpesa')
      .eq('event_id', cb.checkoutRequestId)

  const { data: request } = await db
    .from('mpesa_requests')
    .select('org_id, order_id, amount_minor')
    .eq('checkout_request_id', cb.checkoutRequestId)
    .maybeSingle()
  if (!request) {
    // Not a prompt we sent (or its row failed to save): keep for manual review.
    return ack({ recorded: false, reason: 'unknown_request' })
  }

  if (!cb.succeeded) {
    // Cancelled, timed out, wrong PIN, insufficient funds...: nothing was paid.
    await markProcessed(request.org_id)
    return ack({ recorded: false, resultCode: cb.resultCode })
  }

  const amountMinor = kesToMinor(cb.amount)
  if (amountMinor === null || !cb.mpesaReceipt || amountMinor !== Number(request.amount_minor)) {
    // Amount differs from what we asked for, or the receipt is missing: manual review.
    return ack({ recorded: false, reason: 'mismatch' })
  }

  const { data: paymentId, error: rpcError } = await db.rpc('record_verified_payment', {
    p_order: request.order_id,
    p_provider: 'mpesa',
    p_method: 'mobile_money',
    p_amount_minor: amountMinor,
    p_currency: 'KES',
    p_external_ref: cb.mpesaReceipt,
    p_received_at: cb.transactionDate,
  })
  if (rpcError) {
    console.error('mpesa-callback: record_verified_payment failed', rpcError.code)
    if (rpcError.code && PERMANENT_ERRORS.has(rpcError.code)) return ack({ recorded: false, reason: 'rejected' })
    return json({ error: 'Could not record payment' }, 500)
  }
  await markProcessed(request.org_id)
  return ack({ recorded: true, paymentId })
})
