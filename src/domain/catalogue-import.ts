/**
 * CSV product import: parse, validate and plan (pure, no I/O).
 *
 * One CSV row = one variant. Rows with the same product name (case-insensitive)
 * become one product with several variants. A row whose SKU already exists in
 * the business is either updated or skipped, as the merchant chooses. Rows
 * without a SKU are always created as new.
 *
 * The database re-checks the same rules in `import_products`
 * (supabase/migrations/20261120000050_parity_and_expansion.sql). Keep them in step.
 */
import { MoneyError, parseMajor, toMajorString, money } from './money'
import { parseCsv } from '@/integrations/csv-parse'
import { toCsv } from '@/integrations/csv'

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_MAX_STOCK = 1_000_000

export type ImportField =
  | 'name'
  | 'description'
  | 'category'
  | 'variantName'
  | 'sku'
  | 'price'
  | 'compareAtPrice'
  | 'stock'
  | 'imageUrl'

export const IMPORT_COLUMNS: { field: ImportField; header: string; required: boolean; aliases: string[] }[] = [
  { field: 'name', header: 'name', required: true, aliases: ['product', 'product name', 'title', 'product title'] },
  { field: 'description', header: 'description', required: false, aliases: ['details', 'product description'] },
  { field: 'category', header: 'category', required: false, aliases: ['collection', 'type', 'product type'] },
  { field: 'variantName', header: 'variant name', required: false, aliases: ['variant', 'option', 'size', 'variant title'] },
  { field: 'sku', header: 'sku', required: false, aliases: ['code', 'product code', 'item code', 'variant sku'] },
  { field: 'price', header: 'price', required: true, aliases: ['selling price', 'unit price', 'variant price'] },
  { field: 'compareAtPrice', header: 'compare-at price', required: false, aliases: ['compare at price', 'was price', 'old price', 'original price', 'variant compare at price'] },
  { field: 'stock', header: 'stock', required: false, aliases: ['quantity', 'qty', 'inventory', 'on hand', 'variant inventory qty'] },
  { field: 'imageUrl', header: 'image url', required: false, aliases: ['image', 'image src', 'photo', 'photo url', 'picture'] },
]

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/\s*-\s*/g, '-')

export interface ImportRow {
  /** 1-based line in the file (the header is line 1). */
  line: number
  name: string
  description: string | null
  category: string | null
  variantName: string | null
  sku: string | null
  priceMinor: number | null
  compareAtMinor: number | null
  stock: number | null
  imageUrl: string | null
  errors: string[]
}

export interface ParsedImport {
  rows: ImportRow[]
  /** Problems with the file itself (missing columns, too many rows, broken quoting). */
  fileErrors: string[]
  /** Column headers that were not recognised and will be ignored. */
  ignoredHeaders: string[]
}

function mapHeaders(header: string[]): { index: Partial<Record<ImportField, number>>; ignored: string[] } {
  const index: Partial<Record<ImportField, number>> = {}
  const ignored: string[] = []
  header.forEach((raw, i) => {
    const h = norm(raw)
    const col = IMPORT_COLUMNS.find((c) => norm(c.header) === h || c.aliases.some((a) => norm(a) === h))
    if (col && index[col.field] === undefined) index[col.field] = i
    else if (h) ignored.push(raw.trim())
  })
  return { index, ignored }
}

/** Money cell -> minor units. Accepts "1500", "1,500.50", "1 500". Rejects symbols, so mistakes are caught. */
export function parsePriceCell(raw: string, currency: string): { ok: true; minor: number } | { ok: false; error: string } {
  const v = raw.trim()
  if (!/^[0-9][0-9\s,_]*(\.[0-9]+)?$/.test(v)) return { ok: false, error: 'use numbers only, e.g. 1500 or 1500.00 (no currency sign)' }
  try {
    const m = parseMajor(v, currency)
    return { ok: true, minor: m.amountMinor }
  } catch (e) {
    return { ok: false, error: e instanceof MoneyError ? e.message : 'is not a valid amount' }
  }
}

const URL_RE = /^https:\/\/[^\s"<>]+$/

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t ? t : null
}

/** Parse and validate a whole CSV file. Never throws. */
export function parseImportCsv(text: string, opts: { currency: string; maxRows?: number }): ParsedImport {
  const maxRows = opts.maxRows ?? IMPORT_MAX_ROWS
  const fileErrors: string[] = []
  const parsed = parseCsv(text, { maxRecords: maxRows + 2 })
  if (parsed.error) fileErrors.push(parsed.error)
  if (parsed.records.length === 0) return { rows: [], fileErrors: ['The file is empty'], ignoredHeaders: [] }

  const [header, ...body] = parsed.records
  const { index, ignored } = mapHeaders(header)
  for (const col of IMPORT_COLUMNS) {
    if (col.required && index[col.field] === undefined) fileErrors.push(`Missing the "${col.header}" column`)
  }
  if (body.length > maxRows) fileErrors.push(`Import at most ${maxRows.toLocaleString('en')} rows at a time. Split the file and import each part.`)
  if (body.length === 0) fileErrors.push('The file has a header but no product rows')
  if (fileErrors.length > 0) return { rows: [], fileErrors, ignoredHeaders: ignored }

  const cell = (rec: string[], f: ImportField) => (index[f] === undefined ? undefined : rec[index[f] as number])
  const skuLines = new Map<string, number>()

  const rows = body.map((rec, i): ImportRow => {
    const line = i + 2
    const errors: string[] = []
    const name = clean(cell(rec, 'name')) ?? ''
    if (!name) errors.push('Name is missing')
    else if (name.length > 160) errors.push('Name is longer than 160 characters')
    const description = clean(cell(rec, 'description'))
    if (description && description.length > 5000) errors.push('Description is longer than 5,000 characters')
    const category = clean(cell(rec, 'category'))
    if (category && category.length > 80) errors.push('Category is longer than 80 characters')
    const variantName = clean(cell(rec, 'variantName'))
    if (variantName && variantName.length > 120) errors.push('Variant name is longer than 120 characters')

    const sku = clean(cell(rec, 'sku'))
    if (sku) {
      if (sku.length > 64) errors.push('SKU is longer than 64 characters')
      const seen = skuLines.get(sku.toLowerCase())
      if (seen) errors.push(`SKU "${sku}" is also on line ${seen}`)
      else skuLines.set(sku.toLowerCase(), line)
    }

    let priceMinor: number | null = null
    const priceRaw = clean(cell(rec, 'price'))
    if (!priceRaw) errors.push('Price is missing')
    else {
      const p = parsePriceCell(priceRaw, opts.currency)
      if (p.ok) priceMinor = p.minor
      else errors.push(`Price: ${p.error}`)
    }

    let compareAtMinor: number | null = null
    const compareRaw = clean(cell(rec, 'compareAtPrice'))
    if (compareRaw) {
      const p = parsePriceCell(compareRaw, opts.currency)
      if (!p.ok) errors.push(`Compare-at price: ${p.error}`)
      else if (priceMinor !== null && p.minor <= priceMinor) errors.push('Compare-at price must be higher than the price (it is shown as the "was" price)')
      else compareAtMinor = p.minor
    }

    let stock: number | null = null
    const stockRaw = clean(cell(rec, 'stock'))
    if (stockRaw) {
      if (!/^[0-9]+$/.test(stockRaw.replace(/[,\s]/g, ''))) errors.push('Stock must be a whole number, 0 or more')
      else {
        stock = Number(stockRaw.replace(/[,\s]/g, ''))
        if (stock > IMPORT_MAX_STOCK) {
          errors.push(`Stock must be at most ${IMPORT_MAX_STOCK.toLocaleString('en')}`)
          stock = null
        }
      }
    }

    const imageUrl = clean(cell(rec, 'imageUrl'))
    if (imageUrl && (!URL_RE.test(imageUrl) || imageUrl.length > 2000)) errors.push('Image URL must be a full https:// link')

    return { line, name, description, category, variantName, sku, priceMinor, compareAtMinor, stock, imageUrl, errors }
  })

  return { rows, fileErrors: [], ignoredHeaders: ignored }
}

export type DuplicateMode = 'update' | 'skip'
export type RowAction = 'create' | 'update' | 'skip' | 'error'

export interface ExistingSku {
  productName: string
  variantName: string
}

export interface ImportPlanRow extends ImportRow {
  action: RowAction
  /** When updating or skipping: what the SKU belongs to today. */
  existing: ExistingSku | null
}

export interface ImportPlan {
  rows: ImportPlanRow[]
  counts: Record<RowAction, number>
  /** New products that will be created (rows grouped by name). */
  newProducts: number
  canImport: boolean
}

/** Decide what happens to each row. `existing` maps lower-case SKU -> what owns it now. */
export function planImport(rows: ImportRow[], existing: Map<string, ExistingSku>, mode: DuplicateMode): ImportPlan {
  const counts: Record<RowAction, number> = { create: 0, update: 0, skip: 0, error: 0 }
  const newNames = new Set<string>()
  const planned = rows.map((r): ImportPlanRow => {
    const hit = r.sku ? (existing.get(r.sku.toLowerCase()) ?? null) : null
    let action: RowAction
    if (r.errors.length > 0) action = 'error'
    else if (hit) action = mode
    else {
      action = 'create'
      newNames.add(r.name.toLowerCase())
    }
    counts[action]++
    return { ...r, action, existing: hit }
  })
  return { rows: planned, counts, newProducts: newNames.size, canImport: counts.error === 0 && counts.create + counts.update > 0 }
}

/** Rows the server receives (snake_case, minor units). Only valid rows. */
export function toServerRows(rows: ImportRow[]): ServerImportRow[] {
  return rows
    .filter((r) => r.errors.length === 0)
    .map((r) => ({
      line: r.line,
      name: r.name,
      description: r.description,
      category: r.category,
      variant_name: r.variantName,
      sku: r.sku,
      price_minor: r.priceMinor,
      compare_at_minor: r.compareAtMinor,
      stock: r.stock,
      image_url: r.imageUrl,
    }))
}

/** Downloadable template with two example products (one with variants). */
export function importTemplateCsv(currency: string): string {
  const m = (minor: number) => toMajorString(money(minor, currency))
  const columns = IMPORT_COLUMNS.map((c) => ({ key: c.field, header: c.header }))
  const rows = [
    { name: 'Kikoi beach towel', description: 'Hand-woven cotton, 90 x 170 cm', category: 'Home', variantName: 'Blue stripe', sku: 'KIK-BLU', price: m(250000), compareAtPrice: m(300000), stock: 12, imageUrl: '' },
    { name: 'Kikoi beach towel', description: '', category: 'Home', variantName: 'Red stripe', sku: 'KIK-RED', price: m(250000), compareAtPrice: '', stock: 8, imageUrl: '' },
    { name: 'Sisal basket', description: 'Medium, leather handles', category: 'Baskets', variantName: '', sku: 'BSK-M', price: m(180000), compareAtPrice: '', stock: '', imageUrl: '' },
  ]
  return toCsv(rows, columns)
}

export interface ServerImportRow {
  line: number
  name: string
  description: string | null
  category: string | null
  variant_name: string | null
  sku: string | null
  price_minor: number | null
  compare_at_minor: number | null
  stock: number | null
  image_url: string | null
}

/**
 * Re-check of rows as the server receives them (mirrors step 1 of import_products).
 * Used by the demo gateway so both modes reject exactly the same input.
 */
export function validateServerRows(rows: ServerImportRow[], maxRows = IMPORT_MAX_ROWS): { line: number; message: string }[] {
  if (!Array.isArray(rows) || rows.length === 0) return [{ line: 0, message: 'The file has no product rows' }]
  if (rows.length > maxRows) return [{ line: 0, message: `Import at most ${maxRows.toLocaleString('en')} rows at a time` }]
  const errors: { line: number; message: string }[] = []
  const seen = new Set<string>()
  const isMinor = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  for (const r of rows) {
    const line = Number.isSafeInteger(r.line) ? r.line : 0
    const push = (message: string) => errors.push({ line, message })
    const name = (r.name ?? '').trim()
    if (name.length < 1 || name.length > 160) push('Product name must be 1-160 characters')
    if ((r.description ?? '').length > 5000) push('Description is longer than 5,000 characters')
    if ((r.category ?? '').length > 80) push('Category is longer than 80 characters')
    if ((r.variant_name ?? '').length > 120) push('Variant name is longer than 120 characters')
    const sku = (r.sku ?? '').trim()
    if (sku.length > 64) push('SKU is longer than 64 characters')
    if (sku && seen.has(sku.toLowerCase())) push('SKU appears more than once in this file')
    if (sku) seen.add(sku.toLowerCase())
    if (!isMinor(r.price_minor)) push('Price must be zero or more')
    else if (r.compare_at_minor !== null && r.compare_at_minor !== undefined && (!isMinor(r.compare_at_minor) || r.compare_at_minor <= r.price_minor)) {
      push('Compare-at price must be higher than the price')
    }
    if (r.stock !== null && r.stock !== undefined && (!Number.isSafeInteger(r.stock) || r.stock < 0 || r.stock > IMPORT_MAX_STOCK)) {
      push('Stock must be a whole number from 0 to 1,000,000')
    }
    if (r.image_url && (!URL_RE.test(r.image_url) || r.image_url.length > 2000)) push('Image URL must start with https://')
  }
  return errors
}
