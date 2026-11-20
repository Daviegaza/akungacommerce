import { describe, expect, it } from 'vitest'
import { checkSourceIp, parseAllowList } from './source-ip.ts'

const h = (v: Record<string, string>) => new Headers(v)

describe('checkSourceIp (optional M-Pesa callback allowlist)', () => {
  it('does nothing when no allowlist is configured', () => {
    expect(checkSourceIp(h({}), undefined, undefined)).toEqual({ ok: true })
  })
  it('refuses a misconfiguration instead of guessing a header', () => {
    expect(checkSourceIp(h({ 'x-real-ip': '1.2.3.4' }), '1.2.3.4', undefined)).toMatchObject({ ok: false, status: 503 })
    expect(checkSourceIp(h({}), 'not-an-ip', 'x-real-ip')).toMatchObject({ ok: false, status: 503 })
  })
  it('allows single addresses and CIDR ranges, refuses everything else', () => {
    const allow = '196.201.214.0/24, 10.0.0.5'
    expect(checkSourceIp(h({ 'x-real-ip': '196.201.214.77' }), allow, 'x-real-ip')).toEqual({ ok: true })
    expect(checkSourceIp(h({ 'x-real-ip': '10.0.0.5' }), allow, 'x-real-ip')).toEqual({ ok: true })
    expect(checkSourceIp(h({ 'x-real-ip': '196.201.215.1' }), allow, 'x-real-ip')).toMatchObject({ ok: false, status: 401 })
    expect(checkSourceIp(h({}), allow, 'x-real-ip')).toMatchObject({ ok: false, status: 401 })
  })
  it('parses lists strictly', () => {
    expect(parseAllowList('1.2.3.4/33')).toBeNull()
    expect(parseAllowList('300.1.1.1')).toBeNull()
    expect(parseAllowList('1.2.3.4/16')).toEqual([{ base: (1 << 24) + (2 << 16), mask: 0xffff0000 }])
  })
})
