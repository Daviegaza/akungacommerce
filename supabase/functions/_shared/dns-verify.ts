// Custom-domain DNS check over DNS-over-HTTPS (runtime-agnostic; tested with a mocked fetch).
//
// Resolver: Cloudflare's public DoH JSON API, GET https://cloudflare-dns.com/dns-query?name=..&type=..
// with `accept: application/dns-json` (documented at developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/
// make-api-requests/dns-json/). Response: { Status, Answer?: [{ name, type, TTL, data }] }; Status 0 = NOERROR,
// 3 = NXDOMAIN. This proves DNS only: it says nothing about certificates or hosting.

export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'
export const TXT_PREFIX = '_fungua-verification.'

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface DnsAnswer {
  name: string
  type: number
  data: string
}

export class DnsLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DnsLookupError'
  }
}

const TYPE_CODE = { A: 1, CNAME: 5, TXT: 16 } as const

/** One DoH JSON query. NXDOMAIN / no data -> []. Resolver trouble -> DnsLookupError (try again later). */
export async function dohQuery(fetchFn: FetchLike, name: string, type: keyof typeof TYPE_CODE, timeoutMs = 5000): Promise<DnsAnswer[]> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let body: unknown
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/dns-json' }, signal: ctrl?.signal })
    if (!res.ok) throw new DnsLookupError(`DNS lookup failed (HTTP ${res.status})`)
    body = await res.json()
  } catch (e) {
    if (e instanceof DnsLookupError) throw e
    throw new DnsLookupError('DNS lookup failed (network)')
  } finally {
    if (timer) clearTimeout(timer)
  }
  const b = (body ?? {}) as { Status?: unknown; Answer?: unknown }
  if (b.Status === 3) return [] // NXDOMAIN
  if (b.Status !== 0) throw new DnsLookupError(`DNS lookup failed (status ${String(b.Status)})`)
  if (!Array.isArray(b.Answer)) return []
  return b.Answer.filter(
    (a): a is DnsAnswer => !!a && typeof (a as DnsAnswer).data === 'string' && (a as DnsAnswer).type === TYPE_CODE[type],
  )
}

const bareName = (v: string) => v.trim().toLowerCase().replace(/\.$/, '')

/** TXT data arrives quoted and may be split into several strings: "\"abc\" \"def\"" -> "abcdef". */
export function txtValue(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g)
  if (!parts) return data.trim()
  return parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('')
}

export type RoutingResult = 'ok' | 'missing' | 'wrong' | 'not_configured'
export type OwnershipResult = 'ok' | 'missing' | 'wrong'

export interface DomainCheckInput {
  hostname: string
  verificationToken: string
  isApex: boolean
  /** Server-side env CUSTOM_DOMAIN_CNAME_TARGET / CUSTOM_DOMAIN_A_RECORD (null = not decided yet). */
  cnameTarget: string | null
  aRecord: string | null
}

export interface DomainCheckOutcome {
  status: 'verified' | 'failed'
  routing: RoutingResult
  ownership: OwnershipResult
  reason: string | null
  found: { cname: string[]; a: string[]; txt: string[] }
}

/**
 * Checks the two records Fungua asks for (see src/domain/custom-domain.ts dnsInstructions):
 * routing (CNAME for a subdomain, A for an apex) and the ownership TXT token.
 * Throws DnsLookupError when the resolver itself fails (the domain is left unchanged).
 */
export async function checkDomainDns(fetchFn: FetchLike, i: DomainCheckInput): Promise<DomainCheckOutcome> {
  const host = bareName(i.hostname)
  const [txt, routing] = await Promise.all([
    dohQuery(fetchFn, TXT_PREFIX + host, 'TXT'),
    i.isApex ? dohQuery(fetchFn, host, 'A') : dohQuery(fetchFn, host, 'CNAME'),
  ])
  const found = {
    txt: txt.map((a) => txtValue(a.data)),
    cname: i.isApex ? [] : routing.map((a) => bareName(a.data)),
    a: i.isApex ? routing.map((a) => a.data.trim()) : [],
  }
  const expectedTxt = `fungua-verify=${i.verificationToken}`
  const ownership: OwnershipResult = found.txt.includes(expectedTxt)
    ? 'ok'
    : found.txt.some((t) => t.startsWith('fungua-verify='))
      ? 'wrong'
      : 'missing'

  let route: RoutingResult
  if (i.isApex) {
    if (!i.aRecord) route = 'not_configured'
    else route = found.a.length === 0 ? 'missing' : found.a.includes(i.aRecord.trim()) ? 'ok' : 'wrong'
  } else if (!i.cnameTarget) {
    route = 'not_configured'
  } else {
    route = found.cname.length === 0 ? 'missing' : found.cname.includes(bareName(i.cnameTarget)) ? 'ok' : 'wrong'
  }

  const reasons: string[] = []
  if (route === 'not_configured') reasons.push('Fungua has not set up its address for custom domains yet, so the pointing record cannot be checked.')
  else if (route === 'missing') reasons.push(i.isApex ? `No A record found for ${host} yet.` : `No CNAME record found for ${host} yet.`)
  else if (route === 'wrong')
    reasons.push(
      i.isApex
        ? `The A record for ${host} points to ${found.a.join(', ')}, not ${i.aRecord}.`
        : `The CNAME for ${host} points to ${found.cname.join(', ')}, not ${bareName(i.cnameTarget ?? '')}.`,
    )
  if (ownership === 'missing') reasons.push(`No TXT record found at ${TXT_PREFIX}${host} yet.`)
  else if (ownership === 'wrong') reasons.push(`The TXT record at ${TXT_PREFIX}${host} has a different code. Copy it again from Fungua.`)
  if (reasons.length && (route === 'missing' || ownership === 'missing')) reasons.push('New DNS records can take up to 48 hours to appear.')

  const ok = route === 'ok' && ownership === 'ok'
  return { status: ok ? 'verified' : 'failed', routing: route, ownership, reason: ok ? null : reasons.join(' ').slice(0, 300), found }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VerifyRequest = { kind: 'merchant'; orgId: string } | { kind: 'scheduled'; limit: number }

export function parseVerifyRequest(raw: unknown): VerifyRequest | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.scheduled === true) {
    const limit = r.limit === undefined ? 25 : r.limit
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) return 'limit must be an integer between 1 and 100'
    return { kind: 'scheduled', limit }
  }
  if (typeof r.org_id !== 'string' || !UUID_RE.test(r.org_id)) return 'org_id must be a UUID'
  return { kind: 'merchant', orgId: r.org_id }
}

/** Second-level public suffixes common in our markets (co.ke, com.ng ...). Same heuristic as src/domain/custom-domain.ts. */
export function isApexDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return /\.(co|or|ne|go|ac|sc|com|org|net|gov|edu|me)\.[a-z]{2}$/.test(hostname) ? parts.length === 3 : parts.length === 2
}

export function dnsTargetsFromServerEnv(get: (k: string) => string | undefined): { cnameTarget: string | null; aRecord: string | null } {
  const cname = (get('CUSTOM_DOMAIN_CNAME_TARGET') ?? '').trim()
  const a = (get('CUSTOM_DOMAIN_A_RECORD') ?? '').trim()
  return {
    cnameTarget: cname && /^[a-z0-9.-]+$/i.test(cname) ? bareName(cname) : null,
    aRecord: /^\d{1,3}(\.\d{1,3}){3}$/.test(a) ? a : null,
  }
}
