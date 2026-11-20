// M-Pesa STK push: POST /mpesa-stk  { tracking_token, phone_e164 }
// Label: adapter_only. Returns 503 { status: 'not_configured' } unless the shop's
// collections provider (shop_settings.collections_provider) can prompt:
//   daraja      every Daraja secret is set AND the business has a verified 'mpesa'
//               connection (integration_connections.state = 'connected_verified')
//   aggregator  a verified adapter exists for the chosen aggregator (none yet) AND
//               its connection is verified
//   manual      never
//
// It only ASKS the provider to show a prompt on the customer's phone. It never
// marks anything paid: payment is recorded later by mpesa-callback through
// reconcile_mpesa_stk -> record_verified_payment.
//
// Called by the public storefront with the anon key (verify_jwt stays on).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { toDarajaPhone } from '../_shared/daraja.ts'
import { callbackUrlWithSecret, resolveCollectionsProvider } from '../_shared/collections.ts'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const notConfigured = () => json({ status: 'not_configured' }, 503)

const PAYABLE = new Set(['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ status: 'failed', error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const callbackBase = Deno.env.get('DARAJA_CALLBACK_URL')
  const callbackSecret = Deno.env.get('MPESA_CALLBACK_SECRET')
  if (!supabaseUrl || !serviceKey || !callbackBase || !callbackSecret) return notConfigured()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ status: 'failed', error: 'Body must be JSON' }, 400)
  }
  const token = (raw as { tracking_token?: unknown } | null)?.tracking_token
  const phone = (raw as { phone_e164?: unknown } | null)?.phone_e164
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return json({ status: 'failed', error: 'Order not found' }, 404)
  if (typeof phone !== 'string' || !toDarajaPhone(phone)) {
    return json({ status: 'failed', error: 'Enter a Kenyan mobile number, e.g. +254712345678' }, 400)
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: order, error: orderError } = await db
    .from('orders')
    .select('id, org_id, number, status, currency, total_minor')
    .eq('tracking_token', token)
    .maybeSingle()
  if (orderError) return json({ status: 'failed', error: 'Could not load the order' }, 500)
  if (!order) return json({ status: 'failed', error: 'Order not found' }, 404)

  const { data: shop } = await db
    .from('shop_settings')
    .select('collections_provider, collections_aggregator')
    .eq('org_id', order.org_id)
    .maybeSingle()
  const provider = resolveCollectionsProvider(
    { provider: shop?.collections_provider, aggregator: shop?.collections_aggregator },
    (k) => Deno.env.get(k),
    fetch,
  )
  if (!provider.supportsStk) return notConfigured()

  // The money goes to the configured account, so only a business whose connection
  // was verified end-to-end may trigger prompts.
  const { data: conn } = await db
    .from('integration_connections')
    .select('state')
    .eq('org_id', order.org_id)
    .eq('provider', provider.paymentProvider)
    .maybeSingle()
  if (conn?.state !== 'connected_verified') return notConfigured()

  if (order.currency !== 'KES') return json({ status: 'failed', error: 'M-Pesa is only available for KES orders' }, 422)
  if (!PAYABLE.has(order.status)) return json({ status: 'failed', error: 'This order is not accepting payments' }, 409)

  const [{ data: pays }, { data: refunds }] = await Promise.all([
    db.from('payments').select('amount_minor').eq('order_id', order.id).eq('status', 'succeeded'),
    db.from('refunds').select('amount_minor').eq('order_id', order.id).eq('status', 'succeeded'),
  ])
  const sum = (rows: { amount_minor: number }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount_minor), 0)
  const balance = Number(order.total_minor) - (sum(pays) - sum(refunds))
  if (balance <= 0) return json({ status: 'failed', error: 'This order is already paid' }, 409)
  // Charge the amount due now: an unpaid deposit first, else the balance (20261120000030_deposits_handoff.sql).
  // Falls back to the balance on a database without that migration.
  const { data: dueNow, error: dueError } = await db.rpc('order_amount_due_now', { p_order: order.id })
  const outstanding = !dueError && Number(dueNow) > 0 ? Math.min(Number(dueNow), balance) : balance

  // Throttle prompts per order (re-uses the storefront rate limiter; service role only).
  const { error: limitError } = await db.rpc('_rate_limit', { p_key: `stk:${order.id}`, p_max: 5, p_window: '1 hour' })
  if (limitError) {
    return limitError.code === '54000'
      ? json({ status: 'failed', error: 'Too many payment prompts. Please wait a few minutes.' }, 429)
      : json({ status: 'failed', error: 'Could not send the prompt' }, 500)
  }

  const outcome = await provider.requestPrompt({
    orderNumber: Number(order.number),
    amountMinor: outstanding,
    currency: order.currency,
    phoneE164: phone,
    callbackUrl: callbackUrlWithSecret(callbackBase, callbackSecret),
  })
  if (outcome.status === 'not_configured') return notConfigured()
  if (outcome.status === 'failed') return json({ status: 'failed', error: outcome.error }, 502)

  const { error: insertError } = await db.from('mpesa_requests').insert({
    checkout_request_id: outcome.checkoutRequestId,
    org_id: order.org_id,
    order_id: order.id,
    amount_minor: outstanding,
    provider: provider.paymentProvider,
    status: 'pending',
    phone_hint: phone.replace(/\D/g, '').slice(-3),
  })
  if (insertError) {
    // The prompt is already on the phone; without this row the callback cannot be matched,
    // so the payment stays in webhook_events for manual review instead of auto-recording.
    console.error('mpesa-stk: failed to record request', insertError.code)
  }
  return json({ status: 'prompt_sent', checkout_request_id: outcome.checkoutRequestId })
})
