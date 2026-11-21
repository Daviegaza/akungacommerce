// Payment provider webhooks: POST /payment-webhook?provider=stripe|paystack
// Label: adapter_only for Stripe and Paystack — signature verification and
// recording exist; nothing is connected until secrets are set, the URL is
// registered with the provider, and an end-to-end test passes.
//
// Order of operations (never changes):
//   1. read raw body  2. verify signature  3. parse JSON
//   4. insert into webhook_events (unique provider+event_id = replay protection)
//   5. record a provider_verified payment from the VERIFIED payload only
//   6. set processed_at
// Akunga never creates charges; it only records what a verified webhook proves.
//
// Paystack Dedicated Virtual Account credits (charge.success, channel
// dedicated_nuban) take a different step 5: reconcile_bank_transfer maps the
// receiving account to an order/customer (virtual_accounts), dedupes on the
// Paystack reference and records the payment only for the exact amount due now
// or the full balance; anything else waits in the merchant's unmatched queue.
// A credit for an account we don't know stays unprocessed for manual review.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex, verifyPaystackSignature, verifyStripeSignature } from '../_shared/signatures.ts'
import { parsePaystackEvent, parseStripeEvent, paystackEventKey, type NormalisedPaymentEvent } from '../_shared/providers.ts'
import { BANK_TRANSFER_PROCESSED, bankTransferRpcArgs, paystackDvaAdapter } from '../_shared/bank-transfer.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Postgres errors from record_verified_payment that retrying cannot fix.
const PERMANENT_ERRORS = new Set(['P0002', '22023', '23503', '23514', '42501'])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const provider = new URL(req.url).searchParams.get('provider')
  if (provider !== 'stripe' && provider !== 'paystack') return json({ error: 'Unknown provider' }, 400)

  const secret = Deno.env.get(provider === 'stripe' ? 'STRIPE_WEBHOOK_SECRET' : 'PAYSTACK_SECRET_KEY')
  if (!secret) return json({ error: `${provider} webhook not configured` }, 503)

  const rawBody = await req.text()
  const verdict =
    provider === 'stripe'
      ? await verifyStripeSignature(rawBody, req.headers.get('stripe-signature'), secret)
      : await verifyPaystackSignature(rawBody, req.headers.get('x-paystack-signature'), secret)
  if (!verdict.ok) return json({ error: 'Invalid signature' }, 401)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const event: NormalisedPaymentEvent | null = provider === 'stripe' ? parseStripeEvent(payload) : parsePaystackEvent(payload)
  let eventId: string | null = event?.eventId ?? null
  if (!eventId) {
    if (provider === 'stripe') {
      const id = (payload as { id?: unknown } | null)?.id
      eventId = typeof id === 'string' ? id : null
    } else {
      eventId = paystackEventKey(payload)
    }
  }
  eventId ??= `sha256:${await sha256Hex(rawBody)}`

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 503)
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Insert first. A conflict means we've seen this event before.
  const { data: inserted, error: insertError } = await db
    .from('webhook_events')
    .upsert({ provider, event_id: eventId, payload }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('id')
  if (insertError) {
    console.error('payment-webhook: failed to store event', insertError.code)
    return json({ error: 'Storage error' }, 500) // provider retries
  }
  if (!inserted || inserted.length === 0) {
    const { data: existing } = await db
      .from('webhook_events')
      .select('processed_at')
      .eq('provider', provider)
      .eq('event_id', eventId)
      .maybeSingle()
    // Already processed -> acknowledge without reprocessing. If a previous attempt
    // stored the event but failed before finishing, fall through and retry;
    // record_verified_payment is idempotent on provider + external reference.
    if (!existing || existing.processed_at) return json({ received: true, duplicate: true })
  }

  const markProcessed = (orgId: string | null = null) =>
    db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString(), ...(orgId ? { org_id: orgId } : {}) })
      .eq('provider', provider)
      .eq('event_id', eventId)

  // Bank transfer into a dedicated account (verified above; amounts assumed kobo, unconfirmed in sandbox).
  const credit = provider === 'paystack' ? paystackDvaAdapter.parseWebhook(payload) : null
  if (credit) {
    const { data: result, error: btError } = await db.rpc('reconcile_bank_transfer', bankTransferRpcArgs(credit))
    if (btError) {
      console.error('payment-webhook: reconcile_bank_transfer failed', btError.code)
      return json({ error: 'Could not reconcile' }, 500) // provider retries; the event stays unprocessed
    }
    const outcome = String((result as { outcome?: unknown } | null)?.outcome ?? '')
    const orgId = (result as { org_id?: unknown } | null)?.org_id
    if (BANK_TRANSFER_PROCESSED.has(outcome)) await markProcessed(typeof orgId === 'string' ? orgId : null)
    return json({ received: true, outcome })
  }

  if (!event || !event.succeeded || !event.orderId) {
    // Unsupported event type, or a payment not created for an Akunga order.
    await markProcessed()
    return json({ received: true, recorded: false })
  }

  // Amount, currency and reference come only from the signature-verified payload.
  const { data: paymentId, error: rpcError } = await db.rpc('record_verified_payment', {
    p_order: event.orderId,
    p_provider: event.provider,
    p_method: event.method,
    p_amount_minor: event.amountMinor,
    p_currency: event.currency,
    p_external_ref: event.externalRef,
    p_received_at: event.receivedAt,
  })

  if (rpcError) {
    console.error('payment-webhook: record_verified_payment failed', rpcError.code)
    if (rpcError.code && PERMANENT_ERRORS.has(rpcError.code)) {
      // Unknown order or currency mismatch: retrying will not help. Leave
      // processed_at NULL so the event stays visible for manual review.
      return json({ received: true, recorded: false, reason: 'rejected' })
    }
    return json({ error: 'Could not record payment' }, 500) // provider retries
  }

  const { data: order } = await db.from('orders').select('org_id').eq('id', event.orderId).maybeSingle()
  await markProcessed(order?.org_id ?? null)
  return json({ received: true, recorded: true, paymentId })
})
