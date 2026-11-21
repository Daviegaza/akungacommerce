/**
 * WhatsApp click-to-chat link. Opens the merchant's own WhatsApp with a
 * prefilled message. Needs no credentials and is NOT an API integration.
 */

const E164_RE = /^\+[1-9]\d{6,14}$/

export function isE164(value: string): boolean {
  return E164_RE.test(value)
}

export function whatsappChatLink(e164: string, text: string): string {
  if (!isE164(e164)) throw new Error(`"${e164}" is not an E.164 phone number (e.g. +254712345678)`)
  const base = `https://wa.me/${e164.slice(1)}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
