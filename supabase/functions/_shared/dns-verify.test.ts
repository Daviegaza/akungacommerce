import { describe, expect, it, vi } from 'vitest'
import {
  DOH_ENDPOINT,
  DnsLookupError,
  checkDomainDns,
  dnsTargetsFromServerEnv,
  dohQuery,
  isApexDomain,
  parseVerifyRequest,
  txtValue,
  type FetchLike,
} from './dns-verify'
import { isApexDomain as uiIsApex } from '../../../src/domain/custom-domain'

const TOKEN = '0123456789abcdef0123456789abcdef'

/** Fake DoH resolver: records keyed by "name|TYPE". No real network calls. */
function resolver(records: Record<string, { type: number; data: string }[] | 'nx' | 'servfail' | 'http500' | 'throw'>) {
  const calls: { url: string; accept: string | undefined }[] = []
  const fetchFn: FetchLike = vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: input, accept: init?.headers?.accept })
    const u = new URL(input)
    const key = `${u.searchParams.get('name')}|${u.searchParams.get('type')}`
    const r = records[key]
    if (r === 'throw') throw new TypeError('network down')
    if (r === 'http500') return { ok: false, status: 500, json: async () => ({}) }
    if (r === 'nx') return { ok: true, status: 200, json: async () => ({ Status: 3 }) }
    if (r === 'servfail') return { ok: true, status: 200, json: async () => ({ Status: 2 }) }
    return { ok: true, status: 200, json: async () => ({ Status: 0, Answer: (r ?? []).map((a) => ({ name: u.searchParams.get('name'), TTL: 300, ...a })) }) }
  })
  return { fetchFn, calls }
}

const sub = { hostname: 'shop.mtohome.co.ke', verificationToken: TOKEN, isApex: false, cnameTarget: 'domains.rafu.example', aRecord: null }

describe('DNS-over-HTTPS custom domain check', () => {
  it('queries the documented Cloudflare JSON endpoint with the dns-json accept header', async () => {
    const { fetchFn, calls } = resolver({ 'example.org|TXT': [{ type: 16, data: '"hello"' }] })
    expect(await dohQuery(fetchFn, 'example.org', 'TXT')).toEqual([{ name: 'example.org', TTL: 300, type: 16, data: '"hello"' }])
    expect(calls[0].url).toBe(`${DOH_ENDPOINT}?name=example.org&type=TXT`)
    expect(calls[0].accept).toBe('application/dns-json')
  })

  it('treats NXDOMAIN as no records and resolver failures as errors', async () => {
    const { fetchFn } = resolver({ 'a.test|A': 'nx', 'b.test|A': 'servfail', 'c.test|A': 'http500', 'd.test|A': 'throw' })
    expect(await dohQuery(fetchFn, 'a.test', 'A')).toEqual([])
    await expect(dohQuery(fetchFn, 'b.test', 'A')).rejects.toBeInstanceOf(DnsLookupError)
    await expect(dohQuery(fetchFn, 'c.test', 'A')).rejects.toThrow(/HTTP 500/)
    await expect(dohQuery(fetchFn, 'd.test', 'A')).rejects.toThrow(/network/)
  })

  it('verifies a subdomain with the right CNAME (trailing dot, any case) and TXT token', async () => {
    const { fetchFn } = resolver({
      'shop.mtohome.co.ke|CNAME': [{ type: 5, data: 'Domains.Rafu.Example.' }],
      '_rafu-verification.shop.mtohome.co.ke|TXT': [{ type: 16, data: '"google-site-verification=x"' }, { type: 16, data: `"rafu-verify=${TOKEN}"` }],
    })
    expect(await checkDomainDns(fetchFn, sub)).toMatchObject({ status: 'verified', routing: 'ok', ownership: 'ok', reason: null })
  })

  it('fails with plain reasons when records are missing, wrong or the token differs', async () => {
    const missing = await checkDomainDns(resolver({}).fetchFn, sub)
    expect(missing).toMatchObject({ status: 'failed', routing: 'missing', ownership: 'missing' })
    expect(missing.reason).toMatch(/No CNAME record found for shop.mtohome.co.ke yet.*No TXT record.*48 hours/)

    const wrong = await checkDomainDns(
      resolver({
        'shop.mtohome.co.ke|CNAME': [{ type: 5, data: 'someone-else.example.' }],
        '_rafu-verification.shop.mtohome.co.ke|TXT': [{ type: 16, data: '"rafu-verify=ffffffffffffffffffffffffffffffff"' }],
      }).fetchFn,
      sub,
    )
    expect(wrong).toMatchObject({ status: 'failed', routing: 'wrong', ownership: 'wrong' })
    expect(wrong.reason).toMatch(/points to someone-else.example, not domains.rafu.example.*different code/)
  })

  it('checks the A record for an apex domain, and never verifies when Rafu has no target configured', async () => {
    const records = {
      'mtohome.com|A': [{ type: 1, data: '203.0.113.10' }],
      '_rafu-verification.mtohome.com|TXT': [{ type: 16, data: `"rafu-verify=${TOKEN}"` }],
    }
    const apex = { hostname: 'mtohome.com', verificationToken: TOKEN, isApex: true, cnameTarget: null, aRecord: '203.0.113.10' }
    expect(await checkDomainDns(resolver(records).fetchFn, apex)).toMatchObject({ status: 'verified', routing: 'ok' })
    expect(await checkDomainDns(resolver(records).fetchFn, { ...apex, aRecord: '198.51.100.1' })).toMatchObject({ status: 'failed', routing: 'wrong' })
    const unset = await checkDomainDns(resolver(records).fetchFn, { ...apex, aRecord: null })
    expect(unset).toMatchObject({ status: 'failed', routing: 'not_configured', ownership: 'ok' })
    expect(unset.reason).toMatch(/not set up its address/)
  })

  it('propagates resolver trouble so the domain is left unchanged', async () => {
    await expect(checkDomainDns(resolver({ 'shop.mtohome.co.ke|CNAME': 'servfail' }).fetchFn, sub)).rejects.toBeInstanceOf(DnsLookupError)
  })

  it('joins split TXT strings and unescapes quotes', () => {
    expect(txtValue('"rafu-verify=0123" "4567"')).toBe('rafu-verify=01234567')
    expect(txtValue('"a\\"b"')).toBe('a"b')
    expect(txtValue('plain')).toBe('plain')
  })

  it('parses requests, server env targets and apex domains', () => {
    expect(parseVerifyRequest({ org_id: '0b0e7c4a-1d2f-4a55-9a8e-2f5c1c3d4e5f' })).toEqual({ kind: 'merchant', orgId: '0b0e7c4a-1d2f-4a55-9a8e-2f5c1c3d4e5f' })
    expect(parseVerifyRequest({ scheduled: true })).toEqual({ kind: 'scheduled', limit: 25 })
    expect(parseVerifyRequest({ scheduled: true, limit: 500 })).toMatch(/limit/)
    expect(parseVerifyRequest({ org_id: 'nope' })).toMatch(/org_id/)
    const env = (m: Record<string, string>) => (k: string) => m[k]
    expect(dnsTargetsFromServerEnv(env({ CUSTOM_DOMAIN_CNAME_TARGET: 'Domains.Rafu.Example.', CUSTOM_DOMAIN_A_RECORD: '203.0.113.10' }))).toEqual({
      cnameTarget: 'domains.rafu.example',
      aRecord: '203.0.113.10',
    })
    expect(dnsTargetsFromServerEnv(env({ CUSTOM_DOMAIN_CNAME_TARGET: 'bad target!', CUSTOM_DOMAIN_A_RECORD: 'x' }))).toEqual({ cnameTarget: null, aRecord: null })
    expect(isApexDomain('mtohome.co.ke')).toBe(true)
    expect(isApexDomain('shop.mtohome.co.ke')).toBe(false)
    expect(isApexDomain('mtohome.com')).toBe(true)
    // Same heuristic as the merchant UI, so the record Rafu asks for is the record it checks.
    for (const h of ['a.com', 'shop.a.com', 'a.co.ke', 'shop.a.co.ke', 'x.y.a.com.ng', 'a.com.ng', 'a.co.uk', 'b.a.io']) {
      expect(isApexDomain(h), h).toBe(uiIsApex(h))
    }
  })
})
