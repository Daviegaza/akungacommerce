import { money, toMajorString } from '@/domain/money'
import type { OrderSummary, Payment, Refund } from '@/gateway/types'

/**
 * Accounting CSV exports. RFC 4180 output (CRLF, quoted where needed) with
 * spreadsheet formula-injection protection. Amounts are exact decimal strings
 * in major units with an explicit currency column; currencies are never summed.
 */

export type CsvCell = string | number | null
export type CsvRow = Record<string, CsvCell>
export interface CsvColumn {
  key: string
  header: string
}

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/

function cellText(value: CsvCell | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  // A plain decimal like "-12.50" cannot be a formula; everything else that
  // starts with a trigger character is neutralised with a leading quote.
  if (FORMULA_TRIGGER_RE.test(value) && !PLAIN_NUMBER_RE.test(value)) return `'${value}`
  return value
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: CsvRow[], columns: CsvColumn[]): string {
  const lines = [columns.map((c) => quote(cellText(c.header))).join(',')]
  for (const row of rows) lines.push(columns.map((c) => quote(cellText(row[c.key]))).join(','))
  return lines.join('\r\n') + '\r\n'
}

const major = (amountMinor: number, currency: string) => toMajorString(money(amountMinor, currency))

export function ordersCsv(orders: OrderSummary[], locale = 'en-CA'): string {
  const dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
  const columns: CsvColumn[] = [
    { key: 'number', header: 'Order number' },
    { key: 'date', header: 'Date (UTC)' },
    { key: 'createdAt', header: 'Created at (ISO 8601)' },
    { key: 'status', header: 'Status' },
    { key: 'channel', header: 'Channel' },
    { key: 'customer', header: 'Customer' },
    { key: 'customerPhone', header: 'Customer phone' },
    { key: 'currency', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'discount', header: 'Discount' },
    { key: 'tax', header: 'Tax' },
    { key: 'taxMode', header: 'Tax mode' },
    { key: 'deliveryFee', header: 'Delivery fee' },
    { key: 'total', header: 'Total' },
    { key: 'netPaid', header: 'Net paid' },
    { key: 'fulfilment', header: 'Fulfilment' },
    { key: 'id', header: 'Order ID' },
  ]
  const rows = orders.map((o) => ({
    number: o.number,
    date: dateFmt.format(new Date(o.createdAt)),
    createdAt: o.createdAt,
    status: o.status,
    channel: o.channel,
    customer: o.customerName,
    customerPhone: o.customerPhone,
    currency: o.currency,
    subtotal: major(o.subtotalMinor, o.currency),
    discount: major(o.discountMinor, o.currency),
    tax: major(o.taxMinor, o.currency),
    taxMode: o.taxMode,
    deliveryFee: major(o.deliveryFeeMinor, o.currency),
    total: major(o.totalMinor, o.currency),
    netPaid: major(o.netPaidMinor, o.currency),
    fulfilment: o.fulfilmentMethod,
    id: o.id,
  }))
  return toCsv(rows, columns)
}

export function paymentsCsv(payments: Payment[]): string {
  const columns: CsvColumn[] = [
    { key: 'orderNumber', header: 'Order number' },
    { key: 'receivedAt', header: 'Received at (ISO 8601)' },
    { key: 'provider', header: 'Provider' },
    { key: 'method', header: 'Method' },
    { key: 'status', header: 'Status' },
    { key: 'verification', header: 'Verification' },
    { key: 'currency', header: 'Currency' },
    { key: 'amount', header: 'Amount' },
    { key: 'externalRef', header: 'External reference' },
    { key: 'reversedReason', header: 'Reversed reason' },
    { key: 'note', header: 'Note' },
    { key: 'id', header: 'Payment ID' },
    { key: 'orderId', header: 'Order ID' },
  ]
  const rows = payments.map((p) => ({
    orderNumber: p.orderNumber,
    receivedAt: p.receivedAt,
    provider: p.provider,
    method: p.method,
    status: p.status,
    verification: p.verification,
    currency: p.currency,
    amount: major(p.amountMinor, p.currency),
    externalRef: p.externalRef,
    reversedReason: p.reversedReason,
    note: p.note,
    id: p.id,
    orderId: p.orderId,
  }))
  return toCsv(rows, columns)
}

export function refundsCsv(refunds: Refund[]): string {
  const columns: CsvColumn[] = [
    { key: 'orderNumber', header: 'Order number' },
    { key: 'createdAt', header: 'Created at (ISO 8601)' },
    { key: 'status', header: 'Status' },
    { key: 'verification', header: 'Verification' },
    { key: 'currency', header: 'Currency' },
    { key: 'amount', header: 'Amount' },
    { key: 'reason', header: 'Reason' },
    { key: 'id', header: 'Refund ID' },
    { key: 'paymentId', header: 'Payment ID' },
    { key: 'orderId', header: 'Order ID' },
  ]
  const rows = refunds.map((r) => ({
    orderNumber: r.orderNumber,
    createdAt: r.createdAt,
    status: r.status,
    verification: r.verification,
    currency: r.currency,
    amount: major(r.amountMinor, r.currency),
    reason: r.reason,
    id: r.id,
    paymentId: r.paymentId,
    orderId: r.orderId,
  }))
  return toCsv(rows, columns)
}

/**
 * Trigger a browser download. Returns false outside a browser. A UTF-8 BOM is
 * prepended so Excel reads non-ASCII names correctly.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
