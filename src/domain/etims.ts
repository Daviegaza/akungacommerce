/**
 * Kenya KRA eTIMS tax invoice data (pure).
 *
 * Rafu prepares a numbered tax invoice per order and a CSV laid out for manual
 * entry into eTIMS Lite (eCitizen / USSD). It does NOT submit to KRA: direct
 * API submission is 'not_implemented'. Tax figures come from the order's own
 * line snapshot (computed by computeLine in orders.ts and by the database), so
 * an invoice always agrees with the order total. Tax treatment must be checked
 * with a qualified adviser.
 *
 * Mirrors issue_tax_invoice in supabase/migrations/20261120000050_parity_and_expansion.sql.
 */
import type { TaxMode } from './orders'
import { money, toMajorString } from './money'
import { toCsv, type CsvColumn } from '@/integrations/csv'

/** Letter, 9 digits, letter. Individuals usually start with A, companies with P. */
export const KRA_PIN_RE = /^[A-Z][0-9]{9}[A-Z]$/

export type PinResult = { ok: true; value: string | null } | { ok: false; error: string }

export function normaliseKraPin(input: string | null | undefined): PinResult {
  const v = String(input ?? '').replace(/\s/g, '').toUpperCase()
  if (!v) return { ok: true, value: null }
  return KRA_PIN_RE.test(v) ? { ok: true, value: v } : { ok: false, error: 'A KRA PIN is a letter, 9 digits and a letter, e.g. P051234567X' }
}

export const KRA_SUBMISSION = {
  status: 'not_implemented' as const,
  label: 'Not sent to KRA',
  detail:
    'Rafu does not submit invoices to KRA. Enter each invoice in eTIMS Lite (eCitizen or *222#) yourself, using the CSV export. Direct eTIMS API submission is not built.',
}

export interface InvoiceSourceLine {
  productName: string
  variantName: string
  sku: string | null
  quantity: number
  unitPriceMinor: number
  discountMinor: number
  taxRateBps: number
  /** Line amount after discount (includes tax when taxMode is inclusive). */
  subtotalMinor: number
  taxMinor: number
}

export interface InvoiceLine {
  description: string
  sku: string | null
  quantity: number
  unitPriceMinor: number
  discountMinor: number
  taxRateBps: number
  /** Excludes tax, in both tax modes. */
  netMinor: number
  taxMinor: number
  /** Net + tax. */
  grossMinor: number
}

export interface InvoiceTotals {
  netMinor: number
  taxMinor: number
  deliveryMinor: number
  totalMinor: number
}

export function invoiceLine(l: InvoiceSourceLine, taxMode: TaxMode): InvoiceLine {
  const net = taxMode === 'inclusive' ? l.subtotalMinor - l.taxMinor : l.subtotalMinor
  return {
    description: l.productName + (l.variantName && l.variantName !== 'Default' ? ` - ${l.variantName}` : ''),
    sku: l.sku,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    discountMinor: l.discountMinor,
    taxRateBps: l.taxRateBps,
    netMinor: net,
    taxMinor: l.taxMinor,
    grossMinor: net + l.taxMinor,
  }
}

export function invoiceTotals(lines: InvoiceLine[], deliveryMinor: number): InvoiceTotals {
  const netMinor = lines.reduce((a, l) => a + l.netMinor, 0)
  const taxMinor = lines.reduce((a, l) => a + l.taxMinor, 0)
  return { netMinor, taxMinor, deliveryMinor, totalMinor: netMinor + taxMinor + deliveryMinor }
}

/** Per-rate VAT summary, e.g. 16% -> net / tax. */
export function taxBreakdown(lines: InvoiceLine[]): { taxRateBps: number; netMinor: number; taxMinor: number }[] {
  const by = new Map<number, { netMinor: number; taxMinor: number }>()
  for (const l of lines) {
    const prev = by.get(l.taxRateBps) ?? { netMinor: 0, taxMinor: 0 }
    by.set(l.taxRateBps, { netMinor: prev.netMinor + l.netMinor, taxMinor: prev.taxMinor + l.taxMinor })
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([taxRateBps, v]) => ({ taxRateBps, ...v }))
}

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(6, '0')}`
}

/** Next number in a gapless per-business sequence. */
export function nextInvoiceNumber(issued: number[]): number {
  return issued.length === 0 ? 1 : Math.max(...issued) + 1
}

export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}

/**
 * eTIMS tax band commonly used for a rate. Only the two standard VAT rates are
 * suggested; anything else (0%, exempt, non-VAT) must be chosen by the merchant.
 */
export function suggestedTaxBand(bps: number): string {
  if (bps === 1600) return 'B (16%)'
  if (bps === 800) return 'E (8%)'
  return 'Check'
}

export interface TaxInvoiceRecord {
  id: string
  orderId: string
  orderNumber: number | null
  invoiceNumber: number
  sellerName: string
  sellerPin: string
  buyerPin: string | null
  buyerName: string | null
  currency: string
  taxMode: TaxMode
  lines: InvoiceLine[]
  netMinor: number
  taxMinor: number
  deliveryMinor: number
  totalMinor: number
  issuedAt: string
  kraStatus: 'not_submitted'
}

/** One row per invoice line, in the order you type them into eTIMS Lite. */
export function invoicesCsv(invoices: TaxInvoiceRecord[], timeZone = 'Africa/Nairobi'): string {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const m = (minor: number, currency: string) => toMajorString(money(minor, currency))
  const columns: CsvColumn[] = [
    { key: 'invoice', header: 'Invoice number' },
    { key: 'date', header: 'Invoice date' },
    { key: 'order', header: 'Order number' },
    { key: 'sellerPin', header: 'Seller KRA PIN' },
    { key: 'buyerPin', header: 'Buyer KRA PIN' },
    { key: 'buyerName', header: 'Buyer name' },
    { key: 'item', header: 'Item description' },
    { key: 'sku', header: 'Item code' },
    { key: 'qty', header: 'Quantity' },
    { key: 'unitNet', header: 'Unit price excl. VAT' },
    { key: 'rate', header: 'VAT rate' },
    { key: 'band', header: 'eTIMS tax band (confirm)' },
    { key: 'net', header: 'Line amount excl. VAT' },
    { key: 'tax', header: 'VAT amount' },
    { key: 'gross', header: 'Line amount incl. VAT' },
    { key: 'currency', header: 'Currency' },
    { key: 'kra', header: 'KRA submission' },
  ]
  const rows = invoices.flatMap((inv) => {
    const base = {
      invoice: formatInvoiceNumber(inv.invoiceNumber),
      date: dateFmt.format(new Date(inv.issuedAt)),
      order: inv.orderNumber,
      sellerPin: inv.sellerPin,
      buyerPin: inv.buyerPin,
      buyerName: inv.buyerName,
      currency: inv.currency,
      kra: 'Not submitted (enter manually)',
    }
    const lines = inv.lines.map((l) => ({
      ...base,
      item: l.description,
      sku: l.sku,
      qty: l.quantity,
      // Exact when divisible; otherwise rounded to the currency's minor unit (the line totals stay exact).
      unitNet: m(Math.round(l.netMinor / l.quantity), inv.currency),
      rate: formatRate(l.taxRateBps),
      band: suggestedTaxBand(l.taxRateBps),
      net: m(l.netMinor, inv.currency),
      tax: m(l.taxMinor, inv.currency),
      gross: m(l.grossMinor, inv.currency),
    }))
    if (inv.deliveryMinor > 0) {
      lines.push({
        ...base,
        item: 'Delivery (confirm VAT treatment)',
        sku: null,
        qty: 1,
        unitNet: m(inv.deliveryMinor, inv.currency),
        rate: formatRate(0),
        band: 'Check',
        net: m(inv.deliveryMinor, inv.currency),
        tax: m(0, inv.currency),
        gross: m(inv.deliveryMinor, inv.currency),
      })
    }
    return lines
  })
  return toCsv(rows, columns)
}
