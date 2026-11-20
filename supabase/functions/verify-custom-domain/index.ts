// Custom-domain DNS verifier: POST /verify-custom-domain
//
// Merchant "Check now":  body { org_id }  with the merchant's own JWT (Authorization: Bearer <user access token>).
//   request_custom_domain_check(org) runs AS THAT USER: owners/admins only, 5 checks per 15 minutes per shop.
// Scheduled run:          body { scheduled: true, limit?: 1..100 }  with `x-cron-secret: <DOMAIN_CHECK_CRON_SECRET>`
//   or `Authorization: Bearer <service role key>`. Checks domains waiting for DNS (or failed) not checked in the last hour.
//
// DNS is resolved over HTTPS (Cloudflare DoH JSON API, see _shared/dns-verify.ts). The routing record must point at
// CUSTOM_DOMAIN_CNAME_TARGET (subdomains) or CUSTOM_DOMAIN_A_RECORD (apex domains), and the TXT record
// `_rafu-verification.<host>` must hold `rafu-verify=<token>`. The result is written with the service-role
// mark_custom_domain_status(). 'verified' means DNS only: certificates and hosting for custom domains are not set up.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { DnsLookupError, checkDomainDns, dnsTargetsFromServerEnv, isApexDomain, parseVerifyRequest, type FetchLike } from '../_shared/dns-verify.ts'
import { safeEqual } from '../_shared/media-cleanup.ts'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json({ status: 'not_configured', missing: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] }, 503)

  let raw: unknown
  try {
    const text = await req.text()
    raw = text ? JSON.parse(text) : {}
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const parsed = parseVerifyRequest(raw)
  if (typeof parsed === 'string') return json({ error: parsed }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const targets = dnsTargetsFromServerEnv((k) => Deno.env.get(k))
  const doh: FetchLike = (input, init) => fetch(input, init)
  const authHeader = req.headers.get('authorization') ?? ''

  async function checkOne(hostname: string, token: string) {
    try {
      const outcome = await checkDomainDns(doh, { hostname, verificationToken: token, isApex: isApexDomain(hostname), ...targets })
      const { error } = await admin.rpc('mark_custom_domain_status', { p_hostname: hostname, p_status: outcome.status, p_reason: outcome.reason })
      if (error) throw new Error(error.message)
      return { hostname, status: outcome.status, routing: outcome.routing, ownership: outcome.ownership, reason: outcome.reason }
    } catch (e) {
      // Resolver trouble: leave the domain as it was and say so.
      const reason = e instanceof DnsLookupError ? `${e.message}. Try again in a few minutes.` : 'The check could not be completed. Try again in a few minutes.'
      return { hostname, status: 'error' as const, routing: 'unknown' as const, ownership: 'unknown' as const, reason }
    }
  }

  if (parsed.kind === 'scheduled') {
    const cronSecret = Deno.env.get('DOMAIN_CHECK_CRON_SECRET') ?? ''
    const given = req.headers.get('x-cron-secret') ?? ''
    const bearer = authHeader.replace(/^Bearer\s+/i, '')
    if (!((cronSecret.length >= 16 && safeEqual(given, cronSecret)) || (bearer && safeEqual(bearer, serviceKey)))) return json({ error: 'Not allowed' }, 401)
    const { data, error } = await admin.rpc('list_custom_domains_to_check', { p_limit: parsed.limit })
    if (error) return json({ error: 'Could not list domains' }, 500)
    const results = []
    for (const d of (data ?? []) as { hostname: string; verification_token: string }[]) results.push(await checkOne(d.hostname, d.verification_token))
    console.log(JSON.stringify({ fn: 'verify-custom-domain', scheduled: true, checked: results.length }))
    return json({ checked: results.length, results })
  }

  // Merchant check: permission + rate limit enforced in SQL as the calling user.
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: 'Sign in again' }, 401)
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: domain, error: reqErr } = await asUser.rpc('request_custom_domain_check', { p_org: parsed.orgId })
  if (reqErr) {
    const status = reqErr.code === '54000' ? 429 : reqErr.code === '42501' ? 403 : reqErr.code === 'P0002' ? 404 : 400
    return json({ error: reqErr.message }, status)
  }
  const d = domain as { hostname: string; verification_token: string }
  const result = await checkOne(d.hostname, d.verification_token)
  return json({ ...result, checkedAt: new Date().toISOString(), certificate: 'not_set_up' })
})
