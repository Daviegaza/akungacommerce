// Health check: GET /health
// Label: built. For uptime monitors and pre-go-live checks.
//
//   Anyone:                       { ok, db, time }            (no configuration details)
//   Bearer <service role key>:    + readiness (which integrations have their secrets set: booleans
//                                   and missing secret NAMES, never values) + scheduled job status.
//
// Returns 503 when the database does not answer, so a monitor can alert on status code alone.
// Deploy with --no-verify-jwt so a monitor can call it without a key.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/signatures.ts'
import { integrationReadiness } from '../_shared/readiness.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const enc = new TextEncoder()

Deno.serve(async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const time = new Date().toISOString()
  if (!supabaseUrl || !serviceKey) return json({ ok: false, db: false, time }, 503)

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const started = Date.now()
  const { error } = await db.from('organisations').select('id', { head: true, count: 'exact' }).limit(1)
  const dbOk = !error
  const dbMs = Date.now() - started
  if (error) console.error('health: database check failed', error.code)

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const operator = bearer.length > 0 && timingSafeEqual(enc.encode(bearer), enc.encode(serviceKey))
  if (!operator) return json({ ok: dbOk, db: dbOk, time }, dbOk ? 200 : 503)

  const { data: jobs, error: jobsError } = await db.rpc('rafu_job_status')
  return json(
    {
      ok: dbOk,
      db: dbOk,
      db_ms: dbMs,
      time,
      readiness: integrationReadiness((k) => Deno.env.get(k)),
      jobs: jobsError ? { error: jobsError.code } : jobs,
    },
    dbOk ? 200 : 503,
  )
})
