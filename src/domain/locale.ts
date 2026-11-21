import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'

export interface CountryPreset {
  code: CountryCode
  name: string
  currency: string
  timezone: string
  locale: string
}

/** Starting presets only; any ISO country / currency / IANA zone can be chosen. */
export const COUNTRY_PRESETS: CountryPreset[] = [
  { code: 'KE', name: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi', locale: 'en-KE' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', locale: 'en-NG' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', timezone: 'Africa/Johannesburg', locale: 'en-ZA' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', locale: 'en-GB' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', locale: 'en-US' },
  { code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin', locale: 'de-DE' },
  { code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris', locale: 'fr-FR' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' },
  { code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN' },
  { code: 'JP', name: 'Japan', currency: 'JPY', timezone: 'Asia/Tokyo', locale: 'ja-JP' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', timezone: 'America/Sao_Paulo', locale: 'pt-BR' },
  { code: 'AU', name: 'Australia', currency: 'AUD', timezone: 'Australia/Sydney', locale: 'en-AU' },
]

export function listCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf('currency')
  } catch {
    return [...new Set(COUNTRY_PRESETS.map((c) => c.currency))].sort()
  }
}

export function listTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [...new Set(COUNTRY_PRESETS.map((c) => c.timezone))].sort()
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string }

/** Normalise any user-typed number to E.164 using the business country as the default region. */
export function toE164(input: string, defaultCountry?: CountryCode): PhoneResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Enter a phone number' }
  const parsed = parsePhoneNumberFromString(raw, defaultCountry)
  if (!parsed || !parsed.isValid()) {
    return { ok: false, error: 'Not a valid phone number. Include the country code, e.g. +44 20 7946 0958' }
  }
  return { ok: true, e164: parsed.number }
}

export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164)
  return p ? p.formatInternational() : e164
}

/** Timestamps are stored in UTC and rendered in the business time zone. */
export function formatDateTime(isoUtc: string, locale: string, timeZone: string, withTime = true): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(isoUtc))
}

/** Calendar date (YYYY-MM-DD) of a UTC instant in a given zone; used for daily reports. */
export function businessDate(isoUtc: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoUtc))
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
