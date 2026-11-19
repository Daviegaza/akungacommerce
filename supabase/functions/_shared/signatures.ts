/**
 * Webhook signature verification. Runtime-agnostic: uses only Web Crypto
 * (`crypto.subtle`) and TextEncoder, so the same code runs in Supabase Edge
 * Functions (Deno) and in Node/vitest.
 *
 * Every verifier works on the RAW request body text. Parsing JSON first and
 * re-serialising changes the bytes and breaks verification.
 */

export type VerifyResult = { ok: true } | { ok: false; reason: string }

const encoder = new TextEncoder()

type HashName = 'SHA-256' | 'SHA-512'

async function hmac(hash: HashName, secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return new Uint8Array(sig)
}

/** Decode a hex string to bytes. Returns null for anything that is not even-length hex. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/**
 * Constant-time byte comparison. Length is not secret (it is fixed by the
 * hash algorithm), so a length mismatch returns early.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** HMAC-SHA256 hex digest, exported for tests and tooling. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmac('SHA-256', secret, message))
}

export async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmac('SHA-512', secret, message))
}

/**
 * Meta (WhatsApp Cloud API) — header `X-Hub-Signature-256: sha256=<hex>`,
 * HMAC-SHA256 of the raw body keyed with the app secret.
 */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<VerifyResult> {
  if (!appSecret) return { ok: false, reason: 'App secret not configured' }
  if (!header) return { ok: false, reason: 'Missing X-Hub-Signature-256 header' }
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(header.trim())
  if (!match) return { ok: false, reason: 'Malformed signature header' }
  const provided = hexToBytes(match[1])
  if (!provided || provided.length !== 32) return { ok: false, reason: 'Malformed signature header' }
  const expected = await hmac('SHA-256', appSecret, rawBody)
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'Signature mismatch' }
}

export interface StripeVerifyOptions {
  /** Maximum allowed age (and future skew) of the signed timestamp. Default 300 seconds. */
  toleranceSeconds?: number
  /** Current time in Unix SECONDS. Defaults to the system clock. Injected in tests. */
  now?: number
}

/**
 * Stripe — header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]`.
 * Signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint secret.
 * Any matching v1 is accepted (Stripe sends several during secret rolling).
 * Timestamps outside the tolerance are rejected as possible replays.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  { toleranceSeconds = 300, now }: StripeVerifyOptions = {},
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: 'Webhook secret not configured' }
  if (!header) return { ok: false, reason: 'Missing Stripe-Signature header' }

  let timestamp: string | null = null
  const v1: Uint8Array[] = []
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k === 't') timestamp = v
    else if (k === 'v1') {
      const bytes = hexToBytes(v)
      if (bytes && bytes.length === 32) v1.push(bytes)
    }
  }
  if (!timestamp || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'Malformed signature header: missing timestamp' }
  if (v1.length === 0) return { ok: false, reason: 'Malformed signature header: no v1 signature' }

  const t = Number(timestamp)
  const current = now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(current - t) > toleranceSeconds) return { ok: false, reason: 'Timestamp outside tolerance (possible replay)' }

  const expected = await hmac('SHA-256', secret, `${timestamp}.${rawBody}`)
  // Compare against every candidate without short-circuiting on the first match.
  let matched = false
  for (const candidate of v1) if (timingSafeEqual(expected, candidate)) matched = true
  return matched ? { ok: true } : { ok: false, reason: 'Signature mismatch' }
}

/**
 * Paystack — header `x-paystack-signature: <hex>`, HMAC-SHA512 of the raw
 * body keyed with the Paystack secret key. Paystack signatures carry no
 * timestamp, so replay protection relies on webhook_events (provider, event_id).
 */
export async function verifyPaystackSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: 'Secret key not configured' }
  if (!header) return { ok: false, reason: 'Missing x-paystack-signature header' }
  const provided = hexToBytes(header.trim())
  if (!provided || provided.length !== 64) return { ok: false, reason: 'Malformed signature header' }
  const expected = await hmac('SHA-512', secret, rawBody)
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'Signature mismatch' }
}

/** SHA-256 hex digest of a string; used as a fallback event id for payloads without one. */
export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}
