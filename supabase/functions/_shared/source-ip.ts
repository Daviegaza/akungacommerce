/**
 * Optional source-IP allowlist for unsigned callbacks (M-Pesa Daraja does not sign its callbacks).
 *
 *   MPESA_ALLOWED_IPS       comma-separated IPv4 addresses or CIDR ranges (e.g. "196.201.214.0/24, 196.201.213.114")
 *   MPESA_CLIENT_IP_HEADER  the request header that carries the TRUE caller IP on your hosting
 *                           (for example a header your CDN or load balancer sets and overwrites).
 *
 * Both unset = no IP check (the URL secret still applies). Allowlist set without a header = refuse
 * (misconfiguration), because guessing a header could trust a value the caller controls.
 * Take Safaricom's current callback IP list from Safaricom; this file ships none.
 */
export type IpVerdict = { ok: true } | { ok: false; status: 401 | 503; reason: string }

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim())
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

export function parseAllowList(raw: string): { base: number; mask: number }[] | null {
  const out: { base: number; mask: number }[] = []
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, bitsRaw] = item.split('/')
    const base = ipv4ToInt(addr)
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw)
    if (base === null || !Number.isInteger(bits) || bits < 8 || bits > 32) return null
    const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
    out.push({ base: (base & mask) >>> 0, mask })
  }
  return out.length ? out : null
}

export function checkSourceIp(headers: Headers, allowRaw: string | undefined, headerName: string | undefined): IpVerdict {
  if (!allowRaw || !allowRaw.trim()) return { ok: true }
  const list = parseAllowList(allowRaw)
  if (!list) return { ok: false, status: 503, reason: 'MPESA_ALLOWED_IPS is not a valid IPv4/CIDR list' }
  if (!headerName || !headerName.trim()) return { ok: false, status: 503, reason: 'MPESA_CLIENT_IP_HEADER must be set with MPESA_ALLOWED_IPS' }
  const value = headers.get(headerName.trim()) ?? ''
  const ip = ipv4ToInt(value.split(',')[0] ?? '')
  if (ip === null) return { ok: false, status: 401, reason: 'Caller IP missing' }
  return list.some((r) => ((ip & r.mask) >>> 0) === r.base) ? { ok: true } : { ok: false, status: 401, reason: 'Caller IP not allowed' }
}
