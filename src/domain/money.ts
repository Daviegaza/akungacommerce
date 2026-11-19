/**
 * Money is always an integer number of minor units plus an explicit ISO 4217
 * currency code. Binary floating point is never used for stored amounts.
 */

export type CurrencyCode = string // ISO 4217, upper-case, 3 letters

export interface Money {
  readonly amountMinor: number
  readonly currency: CurrencyCode
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} with ${b}. Amounts in different currencies are kept separate.`)
    this.name = 'CurrencyMismatchError'
  }
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/

export function assertCurrency(code: string): CurrencyCode {
  if (!CURRENCY_RE.test(code)) throw new MoneyError(`Invalid ISO 4217 currency code: "${code}"`)
  return code
}

/** Minor-unit exponent for a currency (USD 2, JPY 0, KWD 3). Uses Intl data. */
export function currencyExponent(currency: CurrencyCode): number {
  assertCurrency(currency)
  // Intl reports the ISO 4217 minor unit via maximumFractionDigits for style currency.
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits
  return digits ?? 2
}

function assertSafeInt(n: number, label = 'amount'): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${label} must be a safe integer of minor units, got ${n}`)
  return n
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  return { amountMinor: assertSafeInt(amountMinor), currency: assertCurrency(currency) }
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency)
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
  return money(a.amountMinor - b.amountMinor, a.currency)
}

export function multiply(a: Money, quantity: number): Money {
  assertSafeInt(quantity, 'quantity')
  return money(a.amountMinor * quantity, a.currency)
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency))
}

/**
 * Round a/b to the nearest integer, halves away from zero. Inputs are integers,
 * so the computation is exact (no floating point accumulation).
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertSafeInt(numerator, 'numerator')
  assertSafeInt(denominator, 'denominator')
  if (denominator === 0) throw new MoneyError('Division by zero')
  const sign = Math.sign(numerator) * Math.sign(denominator)
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  const q = Math.floor(n / d)
  const r = n - q * d
  return sign * (r * 2 >= d ? q + 1 : q)
}

/** Apply a rate expressed in basis points (1% = 100 bps). */
export function applyBasisPoints(a: Money, bps: number): Money {
  assertSafeInt(bps, 'basis points')
  return money(divRoundHalfUp(a.amountMinor * bps, 10_000), a.currency)
}

/** Parse a user-entered decimal string (e.g. "12.50") into minor units without floats. */
export function parseMajor(input: string, currency: CurrencyCode): Money {
  const exp = currencyExponent(currency)
  const cleaned = input.trim().replace(/[\s,_]/g, '')
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned)
  if (!match) throw new MoneyError(`"${input}" is not a valid amount`)
  const [, neg, whole, frac = ''] = match
  if (frac.length > exp) {
    throw new MoneyError(
      exp === 0 ? `${currency} has no minor unit; enter a whole amount` : `${currency} allows at most ${exp} decimal places`,
    )
  }
  const minor = Number(whole + frac.padEnd(exp, '0'))
  return money(neg ? -minor : minor, currency)
}

/** Convert minor units to a plain decimal string for inputs ("1250" USD -> "12.50"). */
export function toMajorString(m: Money): string {
  const exp = currencyExponent(m.currency)
  const neg = m.amountMinor < 0
  const digits = String(Math.abs(m.amountMinor)).padStart(exp + 1, '0')
  const whole = exp === 0 ? digits : digits.slice(0, -exp)
  const frac = exp === 0 ? '' : '.' + digits.slice(-exp)
  return (neg ? '-' : '') + whole + frac
}

export function formatMoney(m: Money, locale = 'en'): string {
  const exp = currencyExponent(m.currency)
  // Format from the exact decimal string so large values never lose precision.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(toMajorString(m) as unknown as number)
}

/** Group amounts by currency. Never merges unlike currencies. */
export function totalsByCurrency(items: Money[]): Map<CurrencyCode, Money> {
  const out = new Map<CurrencyCode, Money>()
  for (const m of items) {
    const prev = out.get(m.currency)
    out.set(m.currency, prev ? add(prev, m) : m)
  }
  return out
}
