// M-Pesa STK Push Query fallback: POST /mpesa-stk-query
// Label: adapter_only. Intended to be called by a scheduler every 2-5 minutes
// (see supabase/functions/README.md); nothing schedules it in this repository.
//
// Callers must present the service role key as a Bearer token (compared in
// constant time), so only the scheduler / operators can trigger Daraja calls.
//
// For each prompt pending > 2 minutes and < 24 hours (mpesa_prompts_due_for_query):
//   1. ask Daraja's STK Push Query API what happened
//   2. apply_mpesa_stk_query:
//        ResultCode 0        -> 'awaiting_receipt'. The query has NO receipt and NO
//                               amount, so NO money is recorded; the merchant sees
//                               "M-Pesa says paid — waiting for receipt" until the
//                               callback / C2B confirmation arrives.
//        1032 / 1037 / 1019 / other -> cancelled / timeout / failed (resolved, no money)
//        still processing / query error -> stays pending (bookkeeping only)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/signatures.ts'
import { readDarajaConfig } from '../_shared/collections.ts'
import { buildStkQueryPayload, getDarajaToken, queryStkPush, stkQueryAction, stkQueryRpcArgs, DarajaError } from '../_shared/daraja.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const enc = new TextEncoder()
const BATCH = 25

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 503)
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!timingSafeEqual(enc.encode(bearer), enc.encode(serviceKey))) return json({ error: 'Forbidden' }, 401)

  const cfg = readDarajaConfig((k) => Deno.env.get(k))
  if (!cfg) return json({ status: 'not_configured' }, 503)

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: due, error: dueError } = await db.rpc('mpesa_prompts_due_for_query', { p_limit: BATCH })
  if (dueError) {
    console.error('mpesa-stk-query: listing failed', dueError.code)
    return json({ error: 'Could not list prompts' }, 500)
  }
  const prompts = (due ?? []) as { checkout_request_id: string }[]
  if (prompts.length === 0) return json({ checked: 0 })

  let token: string
  try {
    token = await getDarajaToken(fetch, cfg.env, cfg.consumerKey, cfg.consumerSecret)
  } catch (e) {
    console.error('mpesa-stk-query: auth failed', e instanceof DarajaError ? e.message : 'unknown')
    return json({ error: 'Daraja auth failed' }, 502)
  }

  const tally: Record<string, number> = {}
  // Sequential on purpose: Daraja rate-limits, and 25 prompts every few minutes is plenty.
  for (const p of prompts) {
    const payload = buildStkQueryPayload({ shortcode: cfg.shortcode, passkey: cfg.passkey, checkoutRequestId: p.checkout_request_id })
    const result = await queryStkPush(fetch, cfg.env, token, payload)
    const action = stkQueryAction(result)
    const { data, error } = await db.rpc('apply_mpesa_stk_query', stkQueryRpcArgs(p.checkout_request_id, action))
    const outcome = error ? 'error' : String((data as { outcome?: unknown } | null)?.outcome ?? 'unknown')
    if (error) console.error('mpesa-stk-query: apply failed', error.code)
    tally[outcome] = (tally[outcome] ?? 0) + 1
  }
  return json({ checked: prompts.length, outcomes: tally })
})
