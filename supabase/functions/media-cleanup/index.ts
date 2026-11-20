// Scheduled cleanup of orphaned product photos: POST /media-cleanup
// Body (all optional): { dry_run?: boolean, min_age_hours?: number (>= 1, default 24), limit?: 1..1000 (default 500) }
//
// Lists objects in the public 'product-images' bucket that no product (and no shop cover/logo)
// references and that are older than min_age_hours (SQL: list_orphan_product_images), then
// deletes them through the Storage API with the service role. Meant for a scheduled run
// (see README: "Orphaned photo cleanup"); scheduling is NOT enabled anywhere.
//
// Caller auth: `x-cleanup-secret: <MEDIA_CLEANUP_SECRET>` or `Authorization: Bearer <service role key>`.
// The anon key (which also passes Supabase's JWT check) is refused.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseCleanupRequest, runCleanup, safeEqual, type OrphanRow } from '../_shared/media-cleanup.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ status: 'not_configured', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] }, 503)

  const secret = Deno.env.get('MEDIA_CLEANUP_SECRET') ?? ''
  const given = req.headers.get('x-cleanup-secret') ?? ''
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const allowed = (secret.length >= 16 && safeEqual(given, secret)) || (bearer.length > 0 && safeEqual(bearer, serviceKey))
  if (!allowed) return json({ error: 'Not allowed' }, 401)

  let body: unknown
  try {
    const text = await req.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const opts = parseCleanupRequest(body)
  if (typeof opts === 'string') return json({ error: opts }, 400)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const report = await runCleanup(
      {
        async listOrphans(minAgeHours, limit) {
          const { data, error } = await sb.rpc('list_orphan_product_images', { p_min_age: `${minAgeHours} hours`, p_limit: limit })
          if (error) throw new Error(error.message)
          return (data ?? []) as OrphanRow[]
        },
        async removeObjects(names) {
          const { data, error } = await sb.storage.from('product-images').remove(names)
          if (error) throw new Error(error.message)
          return (data ?? []).map((o: { name: string }) => o.name)
        },
      },
      opts,
    )
    // Object names are random ids, not personal data; still, only counts go to the log.
    console.log(JSON.stringify({ fn: 'media-cleanup', dryRun: report.dryRun, listed: report.listed, deleted: report.deleted, failedBatches: report.failedBatches }))
    return json(report)
  } catch (e) {
    console.error('media-cleanup failed', e instanceof Error ? e.message : 'unknown')
    return json({ error: 'Cleanup failed' }, 500)
  }
})
