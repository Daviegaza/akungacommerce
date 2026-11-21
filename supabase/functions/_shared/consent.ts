/**
 * Messaging consent rules. Marketing needs an explicit, recorded opt-in;
 * an opt-out keyword from the customer must switch it off.
 */

export function canSendMarketing(customer: { marketingConsent: boolean }): boolean {
  return customer.marketingConsent === true
}

const OPT_OUT_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE', 'STOPALL', 'CANCEL', 'END', 'QUIT'])

/** True when the whole message (trimmed, case-insensitive) is an opt-out keyword. */
export function isOptOut(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false
  return OPT_OUT_KEYWORDS.has(text.trim().toUpperCase())
}
