import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  importTemplateCsv,
  parseImportCsv,
  planImport,
  toServerRows,
  type DuplicateMode,
  type ExistingSku,
  type ParsedImport,
  type RowAction,
} from '@/domain/catalogue-import'
import { downloadCsv } from '@/integrations/csv'
import type { ImportResult } from '@/gateway/expansion'
import { useAction, useOrg, useProducts } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Section, Table, Td, Th } from '../ui/layout'
import { Money } from '../ui/format'
import { Badge, Button, Skeleton, buttonClass, type Tone } from '../ui/primitives'

const ACTION_LABEL: Record<RowAction, string> = { create: 'New', update: 'Update', skip: 'Skip', error: 'Fix' }
const ACTION_TONE: Record<RowAction, Tone> = { create: 'pos', update: 'info', skip: 'neutral', error: 'neg' }
const PREVIEW_LIMIT = 200
const STEPS = ['Upload', 'Preview', 'Import'] as const

/** Where you are in the import: 1 upload, 2 preview, 3 ready to import (check passed), 4 finished. */
function StepStrip({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol aria-label="Import steps" className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'current' : 'todo'
        return (
          <li key={label} aria-current={n === current ? 'step' : undefined} className="flex items-center gap-2">
            <span
              className={cn(
                'tnum flex size-6 items-center justify-center rounded-md border text-xs font-medium',
                state === 'current' ? 'border-ink bg-ink text-canvas' : state === 'done' ? 'border-line-strong text-ink-2' : 'border-line text-ink-3',
              )}
              aria-hidden
            >
              {state === 'done' ? <Check className="size-3.5" /> : n}
            </span>
            <span className={state === 'todo' ? 'text-ink-3' : 'font-medium text-ink'}>{label}</span>
            {state === 'done' && <span className="sr-only">(done)</span>}
          </li>
        )
      })}
    </ol>
  )
}

export default function ProductImportPage() {
  const { org, can } = useOrg()
  const products = useProducts()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [mode, setMode] = useState<DuplicateMode>('update')
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [dryRun, setDryRun] = useState<ImportResult | null>(null)
  const [done, setDone] = useState<ImportResult | null>(null)
  const [dragging, setDragging] = useState(false)

  const run = useAction((g, o, input: { dryRun: boolean }) =>
    g.importProducts(o, toServerRows(parsed?.rows ?? []), { onDuplicate: mode, dryRun: input.dryRun }),
  )

  const existing = useMemo(() => {
    const m = new Map<string, ExistingSku>()
    for (const p of products.data ?? []) for (const v of p.variants) if (v.sku) m.set(v.sku.toLowerCase(), { productName: p.name, variantName: v.name })
    return m
  }, [products.data])

  const plan = useMemo(() => (parsed ? planImport(parsed.rows, existing, mode) : null), [parsed, existing, mode])
  const hasDuplicates = (plan?.rows ?? []).some((r) => r.existing)
  const validRows = plan ? plan.counts.create + plan.counts.update + plan.counts.skip : 0
  const ready = plan !== null && plan.counts.create + plan.counts.update > 0 && (plan.counts.error === 0 || skipInvalid)

  function reset() {
    setParsed(null)
    setFileName(null)
    setReadError(null)
    setDryRun(null)
    setDone(null)
    setSkipInvalid(false)
    run.reset()
    if (fileInput.current) fileInput.current.value = ''
  }

  async function readFile(file: File) {
    reset()
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) {
      setReadError('Choose a .csv file. In Excel or Google Sheets use File → Download / Save as → CSV.')
      return
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setReadError(`This file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Split it into smaller files.`)
      return
    }
    try {
      const text = await file.text()
      setFileName(file.name)
      setParsed(parseImportCsv(text, { currency: org.baseCurrency }))
    } catch {
      setReadError('Could not read that file. Try saving it again as CSV (UTF-8).')
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void readFile(f)
  }

  async function check() {
    setDryRun(null)
    try {
      setDryRun(await run.mutateAsync({ dryRun: true }))
    } catch {
      /* shown via run.error */
    }
  }

  async function importNow() {
    try {
      const r = await run.mutateAsync({ dryRun: false })
      if (r.ok) setDone(r)
      else setDryRun(r)
    } catch {
      /* shown via run.error */
    }
  }

  const header = (
    <PageHeader
      back={
        <Link to="/app/products" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Products
        </Link>
      }
      title="Import products"
      description={`Add or update up to ${IMPORT_MAX_ROWS.toLocaleString()} products from a spreadsheet. Prices are in ${org.baseCurrency}.`}
      actions={
        <Button
          size="sm"
          icon={<Download className="size-4" aria-hidden />}
          onClick={() => downloadCsv(`fungua-product-template-${org.baseCurrency}.csv`, importTemplateCsv(org.baseCurrency))}
        >
          Download template
        </Button>
      }
    />
  )

  if (!can('catalogue.write')) {
    return (
      <>
        {header}
        <Notice tone="warn">Only owners, admins and managers can import products. Ask one of them to do it.</Notice>
      </>
    )
  }

  if (done) {
    return (
      <>
        {header}
        <StepStrip current={4} />
        <div role="status" className="flex flex-col items-start gap-3 border-t border-line pt-6 text-ink">
          <p className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <CheckCircle2 className="size-5 text-pos" aria-hidden /> Import finished
          </p>
          <p className="tnum max-w-2xl text-sm leading-relaxed text-ink-2">
            {done.createdProducts} new {done.createdProducts === 1 ? 'product' : 'products'} ({done.createdVariants} variants), {done.updatedVariants} updated,{' '}
            {done.skipped} skipped. New products are live on your shop straight away; add photos from Products.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Link to="/app/products" className={buttonClass('primary', 'sm')}>
              See products
            </Link>
            <Button size="sm" onClick={reset}>
              Import another file
            </Button>
          </div>
        </div>
      </>
    )
  }

  const shown = (plan?.rows ?? []).filter((r) => !onlyProblems || r.action === 'error').slice(0, PREVIEW_LIMIT)
  const previewing = Boolean(plan && parsed && parsed.fileErrors.length === 0)
  const step: 1 | 2 | 3 = !previewing ? 1 : dryRun?.ok ? 3 : 2

  return (
    <>
      {header}
      <StepStrip current={step} />

      <Section title="1 · Choose your file" description="Columns: name, description, category, variant name, sku, price, compare-at price, stock, image url. Only name and price are required.">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed px-5 py-8 text-center transition-colors',
            dragging ? 'border-brand bg-brand-soft/40' : 'border-line-strong',
          )}
        >
          <FileSpreadsheet className="size-6 text-ink-3" aria-hidden />
          <p className="min-w-0 text-sm break-words text-ink-2">{fileName ? <span className="font-medium text-ink">{fileName}</span> : 'Drop a CSV file here, or'}</p>
          <input
            ref={fileInput}
            id="csv-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
            }}
          />
          <label htmlFor="csv-file" className={buttonClass(fileName ? 'secondary' : 'primary', 'md', 'cursor-pointer focus-within:ring-2')}>
            <Upload className="size-4" aria-hidden /> {fileName ? 'Choose another file' : 'Choose file'}
          </label>
          <p className="text-xs text-ink-3">Rows with the same name become one product with several variants. Rows without a SKU are always added as new.</p>
        </div>
        {readError && (
          <div className="mt-3">
            <ErrorNotice error={new Error(readError)} />
          </div>
        )}
      </Section>

      {parsed && parsed.fileErrors.length > 0 && (
        <div className="mb-8">
          <Notice tone="warn">
            <p className="font-semibold">This file can't be imported yet</p>
            <ul className="mt-1 list-disc pl-5">
              {parsed.fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {plan && parsed && parsed.fileErrors.length === 0 && (
        <Section title="2 · Check what will happen" className="border-t border-line pt-6">
          {products.isPending ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-wrap gap-2" aria-label="Summary">
                <li><Badge tone="pos">{plan.counts.create} new {plan.counts.create === 1 ? 'variant' : 'variants'} ({plan.newProducts} {plan.newProducts === 1 ? 'product' : 'products'})</Badge></li>
                <li><Badge tone="info">{plan.counts.update} to update</Badge></li>
                {plan.counts.skip > 0 && <li><Badge>{plan.counts.skip} skipped</Badge></li>}
                {plan.counts.error > 0 && <li><Badge tone="neg">{plan.counts.error} with problems</Badge></li>}
              </ul>
              {parsed.ignoredHeaders.length > 0 && (
                <p className="text-xs text-ink-3">Ignored columns: {parsed.ignoredHeaders.join(', ')}</p>
              )}

              {hasDuplicates && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-[13px] font-semibold text-ink">Some SKUs already exist in your shop</legend>
                  {(['update', 'skip'] as const).map((m) => (
                    <label key={m} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-sunken">
                      <input type="radio" name="dup" value={m} checked={mode === m} onChange={() => { setMode(m); setDryRun(null) }} className="mt-1 size-4 shrink-0 accent-[var(--ak-brand)]" />
                      <span className="text-sm">
                        <span className="font-medium text-ink">{m === 'update' ? 'Update them' : 'Leave them as they are'}</span>
                        <span className="block text-ink-3">
                          {m === 'update'
                            ? 'Price, compare-at price and stock come from the file. A blank compare-at price removes it. Blank description or category keeps the current one.'
                            : 'Only new rows are added.'}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {plan.counts.error > 0 && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-warn/25 bg-warn-soft p-3 text-sm text-ink">
                  <input type="checkbox" checked={skipInvalid} onChange={(e) => { setSkipInvalid(e.target.checked); setDryRun(null) }} className="mt-0.5 size-5 accent-[var(--ak-brand)]" />
                  <span>
                    Import the {validRows} good rows and leave out the {plan.counts.error} with problems. Or fix them in your spreadsheet and upload again.
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="tnum text-xs text-ink-3">
                  {shown.length < (onlyProblems ? plan.counts.error : plan.rows.length) ? `Showing the first ${PREVIEW_LIMIT} rows.` : `${plan.rows.length} rows.`}
                </p>
                {plan.counts.error > 0 && (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="size-4 accent-[var(--ak-brand)]" />
                    Only rows with problems
                  </label>
                )}
              </div>

              {shown.length === 0 ? (
                <EmptyState title="Nothing to show" />
              ) : (
                <Table className="min-w-[560px]">
                  <caption className="sr-only">Import preview</caption>
                  <thead>
                    <tr>
                      <Th>Line</Th>
                      <Th>Product</Th>
                      <Th className="hidden sm:table-cell">SKU</Th>
                      <Th align="right">Price</Th>
                      <Th align="right">Stock</Th>
                      <Th>Result</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.line} className={r.action === 'error' ? 'bg-neg-soft/40' : undefined}>
                        <Td className="tnum text-ink-3">{r.line}</Td>
                        <Td>
                          <p className="font-medium text-ink">{r.name || <span className="text-ink-3">No name</span>}</p>
                          {(r.variantName || r.sku) && (
                            <p className="text-xs text-ink-3">
                              {r.variantName}
                              {r.sku && <span className="sm:hidden">{r.variantName ? ' · ' : ''}{r.sku}</span>}
                            </p>
                          )}
                          {r.errors.length > 0 && (
                            <ul className="mt-1 text-xs text-neg">
                              {r.errors.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          )}
                          {r.existing && r.action !== 'error' && (
                            <p className="text-xs text-ink-3">
                              Now: {r.existing.productName}
                              {r.existing.variantName !== 'Default' ? ` · ${r.existing.variantName}` : ''}
                            </p>
                          )}
                        </Td>
                        <Td className="hidden text-xs text-ink-2 sm:table-cell">{r.sku ?? '—'}</Td>
                        <Td align="right" className="tnum whitespace-nowrap">
                          {r.priceMinor !== null ? <Money minor={r.priceMinor} currency={org.baseCurrency} /> : '—'}
                          {r.compareAtMinor !== null && (
                            <span className="block text-xs text-ink-3 line-through">
                              <Money minor={r.compareAtMinor} currency={org.baseCurrency} />
                            </span>
                          )}
                        </Td>
                        <Td align="right" className="tnum">{r.stock ?? '—'}</Td>
                        <Td>
                          <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </Section>
      )}

      {plan && parsed && parsed.fileErrors.length === 0 && (
        <Section title="3 · Import" className="border-t border-line pt-6">
          <div className="flex flex-col gap-3">
            {run.isError && <ErrorNotice error={run.error} />}
            {dryRun && !dryRun.ok && (
              <Notice tone="warn">
                <p className="font-semibold">The server found problems. Nothing was changed.</p>
                <ul className="mt-1 list-disc pl-5">
                  {dryRun.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      {e.line > 0 ? `Line ${e.line}: ` : ''}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {dryRun?.ok && (
              <p role="status" className="tnum rounded-lg border border-pos/25 bg-pos-soft px-4 py-3 text-sm text-ink">
                Check passed: {dryRun.createdProducts} new products ({dryRun.createdVariants} variants), {dryRun.updatedVariants} updates, {dryRun.skipped} skipped. Nothing has changed yet.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void check()} disabled={!ready} loading={run.isPending && !dryRun}>
                Check import
              </Button>
              <Button variant="brand" onClick={() => void importNow()} disabled={!ready || !dryRun?.ok} loading={run.isPending && Boolean(dryRun?.ok)}>
                Import now
              </Button>
              <Button variant="ghost" onClick={reset}>
                Start over
              </Button>
            </div>
            <p className="text-xs text-ink-3">"Check import" runs the whole import on the server and then undoes it, so you see exactly what will happen. The real import is all or nothing.</p>
          </div>
        </Section>
      )}
    </>
  )
}
