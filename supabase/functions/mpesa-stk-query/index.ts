// M-Pesa STK Push Query fallback: POST /mpesa-stk-query
// Label: adapter_only. Called every 3 minutes by the pg_cron job rafu-mpesa-stk-query
// (migration 20261122000100; idle until the rafu_* Vault secrets exist).
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
import { chooseDarajaConfig, type DarajaConfig } from '../_shared/collections.ts'
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

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: due, error: dueError } = await db.rpc('mpesa_prompts_due_for_query', { p_limit: BATCH })
  if (dueError) {
    console.error('mpesa-stk-query: listing failed', dueError.code)
    return json({ error: 'Could not list prompts' }, 500)
  }
  const prompts = (due ?? []) as { checkout_request_id: string; org_id: string }[]
  if (prompts.length === 0) return json({ checked: 0 })

  // Each shop is queried with its own credentials (the prompt was sent with them).
  const auth = new Map<string, { cfg: DarajaConfig; token: string } | null>()
  async function authFor(orgId: string) {
    if (auth.has(orgId)) return auth.get(orgId) ?? null
    let entry: { cfg: DarajaConfig; token: string } | null = null
    const { data: creds } = await db.rpc('mpesa_credentials_for', { p_org: orgId })
    const chosen = chooseDarajaConfig(creds ?? null, (k) => Deno.env.get(k))
    if (chosen) {
      try {
        entry = { cfg: chosen.cfg, token: await getDarajaToken(fetch, chosen.cfg.env, chosen.cfg.consumerKey, chosen.cfg.consumerSecret) }
      } catch (e) {
        console.error('mpesa-stk-query: auth failed', e instanceof DarajaError ? e.message : 'unknown')
      }
    }
    auth.set(orgId, entry)
    return entry
  }

  const tally: Record<string, number> = {}
  // Sequential on purpose: Daraja rate-limits, and 25 prompts every few minutes is plenty.
  for (const p of prompts) {
    const a = await authFor(p.org_id)
    if (!a) {
      tally.not_configured = (tally.not_configured ?? 0) + 1
      continue
    }
    const { cfg, token } = a
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
