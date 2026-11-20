/**
 * Custom shop domains (pure). Model, validation and DNS instructions only:
 * Rafu does not yet check DNS or issue certificates, so a domain never becomes
 * 'verified' from the app. The database mirrors the hostname rule in
 * set_custom_domain and only resolves verified domains (storefront_resolve_host).
 */

export const DOMAIN_STATUSES = ['pending_dns', 'verified', 'failed'] as const
export type DomainStatus = (typeof DOMAIN_STATUSES)[number]

export const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  pending_dns: 'Waiting for DNS',
  verified: 'Verified',
  failed: 'Check failed',
}

/** Hosts that can never be a merchant's own domain. */
const RESERVED = /(^|\.)(localhost|vercel\.app|supabase\.co|example\.com|example\.org|example\.net)$/
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

export type HostnameResult = { ok: true; hostname: string; isApex: boolean } | { ok: false; error: string }

/**
 * Accepts what people paste ("https://Shop.Example.co.ke/", "www.myshop.com")
 * and returns the bare lower-case (punycode) hostname.
 */
export function normaliseHostname(input: string): HostnameResult {
  let v = input.trim().toLowerCase()
  if (!v) return { ok: false, error: 'Enter your domain, e.g. shop.yourbrand.com' }
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  v = v.split(/[/?#]/, 1)[0]
  if (v.includes('@') || v.includes(':')) return { ok: false, error: 'Enter only the domain, without a port or login' }
  v = v.replace(/\.$/, '')
  try {
    // Converts international names to punycode (xn--) exactly as browsers do.
    v = new URL(`http://${v}`).hostname
  } catch {
    return { ok: false, error: 'That is not a valid domain' }
  }
  if (/^\d+(\.\d+){3}$/.test(v) || v.startsWith('[')) return { ok: false, error: 'Use a domain name, not an IP address' }
  if (v.length < 4 || v.length > 253) return { ok: false, error: 'That is not a valid domain' }
  const labels = v.split('.')
  if (labels.length < 2) return { ok: false, error: 'Include the ending, e.g. .com or .co.ke' }
  if (!labels.every((l) => LABEL_RE.test(l)) || !TLD_RE.test(labels[labels.length - 1])) {
    return { ok: false, error: 'Use letters, numbers and hyphens only, e.g. shop.yourbrand.com' }
  }
  if (RESERVED.test(v)) return { ok: false, error: 'Use a domain you own' }
  return { ok: true, hostname: v, isApex: isApexDomain(v) }
}

/** Second-level public suffixes common in our markets (co.ke, com.ng, co.uk ...). Heuristic only. */
const TWO_PART_SUFFIX = /\.(co|or|ne|go|ac|sc|com|org|net|gov|edu|me)\.[a-z]{2}$/

export function isApexDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return TWO_PART_SUFFIX.test(hostname) ? parts.length === 3 : parts.length === 2
}

export interface DnsTargets {
  /** Where a subdomain should point (CNAME). null = not decided yet (not connected). */
  cname: string | null
  /** IPv4 for an apex domain (A record). null = not decided yet. */
  aRecord: string | null
}

export interface DnsRecord {
  type: 'CNAME' | 'A' | 'TXT'
  host: string
  value: string | null
  purpose: string
}

/** Records the merchant would add at their DNS provider. */
export function dnsInstructions(hostname: string, verificationToken: string, targets: DnsTargets): DnsRecord[] {
  const apex = isApexDomain(hostname)
  const records: DnsRecord[] = [
    apex
      ? { type: 'A', host: '@', value: targets.aRecord, purpose: 'Points your domain at Rafu' }
      : { type: 'CNAME', host: hostname.split('.')[0], value: targets.cname, purpose: 'Points your domain at Rafu' },
    { type: 'TXT', host: `_rafu-verification.${hostname}`, value: `rafu-verify=${verificationToken}`, purpose: 'Proves you own the domain' },
  ]
  return records
}

/** Read the optional DNS targets from the build environment. */
export function dnsTargetsFromEnv(env: Record<string, unknown>): DnsTargets {
  const cname = typeof env.VITE_CUSTOM_DOMAIN_CNAME_TARGET === 'string' && env.VITE_CUSTOM_DOMAIN_CNAME_TARGET.trim() ? env.VITE_CUSTOM_DOMAIN_CNAME_TARGET.trim() : null
  const a = typeof env.VITE_CUSTOM_DOMAIN_A_RECORD === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(env.VITE_CUSTOM_DOMAIN_A_RECORD.trim()) ? env.VITE_CUSTOM_DOMAIN_A_RECORD.trim() : null
  return { cname, aRecord: a }
}

/**
 * Is this the platform's own host (where /s/:slug routing applies) rather than a
 * merchant domain? Platform hosts: localhost, IPs, *.vercel.app and any host in
 * VITE_PLATFORM_HOSTS (comma-separated).
 */
export function isPlatformHost(hostname: string, extra: string[] = []): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || /^\d+(\.\d+){3}$/.test(h) || h.startsWith('[')) return true
  if (h.endsWith('.vercel.app')) return true
  return extra.map((x) => x.trim().toLowerCase()).filter(Boolean).some((p) => h === p || h.endsWith(`.${p}`))
}
