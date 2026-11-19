import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Product, ProductInput, ProductStatus, VariantInput } from '@/gateway/types'
import type { ProductMerchandising as ProductMerch, VariantMerchandising } from '@/gateway/storefront'
import { currencyExponent, money, parseMajor, toMajorString } from '@/domain/money'
import { useAction, useOrg } from '../context'
import { useNow } from '../live/clock'
import {
  ProductMerchandising,
  SWATCH_RE,
  SwatchPicker,
  imageUrlError,
  isoToLocalInput,
  localInputToIso,
  type ImageDraft,
} from './ProductMerchandising'
import { ErrorNotice, Notice, Sheet } from '../ui/layout'
import { Button, Field, Input, Select, Switch, Textarea } from '../ui/primitives'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS: { value: ProductStatus; label: string }[] = [
  { value: 'active', label: 'Active — can be sold' },
  { value: 'draft', label: 'Draft — hidden from new orders' },
  { value: 'archived', label: 'Archived — no longer sold' },
]

interface VariantDraft {
  key: string
  id?: string
  currency: string
  name: string
  sku: string
  price: string
  threshold: string
  isActive: boolean
  cost: string
  costTouched: boolean
  onHand: number
  reserved: number
  /** Strike-through "was" price (major units string); '' = none. Saved variants only. */
  compareAt: string
  swatch: string
  origCompareAtMinor: number | null
  origSwatch: string | null
}

interface RowErrors {
  name?: string
  sku?: string
  price?: string
  threshold?: string
  cost?: string
  compareAt?: string
  swatch?: string
}

interface SavePayload {
  input: ProductInput
  /** null = storefront details unchanged, skip the call. */
  merch: ProductMerch | null
  variantMerch: { variantId: string; m: VariantMerchandising }[]
}

function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100)
  const frac = bps % 100
  if (!frac) return String(whole)
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`
}

/** "16" -> 1600, "7.5" -> 750. Exact string arithmetic, at most two decimals. */
function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return bps <= 10_000 ? bps : null
}

function draftFromVariant(v: Product['variants'][number]): VariantDraft {
  return {
    key: v.id,
    id: v.id,
    currency: v.currency,
    name: v.name,
    sku: v.sku ?? '',
    price: toMajorString(money(v.priceMinor, v.currency)),
    threshold: String(v.lowStockThreshold),
    isActive: v.isActive,
    cost: v.costMinor != null ? toMajorString(money(v.costMinor, v.currency)) : '',
    costTouched: false,
    onHand: v.onHand,
    reserved: v.reserved,
    compareAt: v.compareAtMinor != null ? toMajorString(money(v.compareAtMinor, v.currency)) : '',
    swatch: v.swatch ?? '',
    origCompareAtMinor: v.compareAtMinor ?? null,
    origSwatch: v.swatch ?? null,
  }
}

function newDraft(currency: string, name = ''): VariantDraft {
  return {
    key: crypto.randomUUID(),
    currency,
    name,
    sku: '',
    price: '',
    threshold: '5',
    isActive: true,
    cost: '',
    costTouched: false,
    onHand: 0,
    reserved: 0,
    compareAt: '',
    swatch: '',
    origCompareAtMinor: null,
    origSwatch: null,
  }
}

function tryParse(value: string, currency: string): { minor: number } | { error: string } {
  if (!value.trim()) return { error: 'Enter a price' }
  try {
    const m = parseMajor(value, currency)
    if (m.amountMinor < 0) return { error: 'Must not be negative' }
    return { minor: m.amountMinor }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Not a valid amount' }
  }
}

/** Build a save payload from a stored product unchanged, except for status. */
function storedInput(p: Product, status: ProductStatus): ProductInput {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    status,
    trackStock: p.trackStock,
    taxRateBps: p.taxRateBps,
    taxCode: p.taxCode,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      priceMinor: v.priceMinor,
      lowStockThreshold: v.lowStockThreshold,
      isActive: v.isActive,
    })),
  }
}

function MoneyInput({
  currency,
  value,
  onChange,
  fieldProps,
}: {
  currency: string
  value: string
  onChange: (v: string) => void
  fieldProps: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }
}) {
  const exp = currencyExponent(currency)
  return (
    <div className="relative">
      <Input
        {...fieldProps}
        inputMode={exp === 0 ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={exp === 0 ? '0' : `0.${'0'.repeat(exp)}`}
        className="tnum pr-14"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-ink-3">{currency}</span>
    </div>
  )
}

/**
 * Product create/edit sheet. Mount only while open so state starts fresh.
 * `readOnly` shows the same form disabled for roles without catalogue.write.
 */
export function ProductEditorSheet({ product, readOnly, onClose }: { product?: Product; readOnly?: boolean; onClose: () => void }) {
  const { org, can } = useOrg()
  const formId = useId()
  const showCost = can('cost.read')
  const qc = useQueryClient()
  const nowMs = useNow()
  // Id of a product created in this sheet, so a retry after a storefront error never creates a duplicate.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const save = useAction(async (g, o, { input, merch, variantMerch }: SavePayload) => {
    const id = await g.saveProduct(o, input)
    if (!input.id) setCreatedId(id)
    try {
      if (merch) await g.setProductMerchandising(o, id, merch)
      for (const vm of variantMerch) await g.setVariantMerchandising(o, vm.variantId, vm.m)
    } catch (err) {
      void qc.invalidateQueries({ queryKey: [o] })
      const reason = err instanceof Error ? err.message : 'unknown error'
      throw new Error(`Product details were saved, but the storefront details were not: ${reason}`, { cause: err })
    }
    return id
  })

  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? 'active')
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true)
  const [taxRate, setTaxRate] = useState(product ? bpsToPercent(product.taxRateBps) : '0')
  const [taxCode, setTaxCode] = useState(product?.taxCode ?? '')
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    product && product.variants.length ? product.variants.map(draftFromVariant) : [newDraft(org.baseCurrency, 'Default')],
  )
  const [images, setImages] = useState<ImageDraft[]>(() =>
    (product?.images ?? []).map((i) => ({ key: crypto.randomUUID(), url: i.url, alt: i.alt ?? '' })),
  )
  const [featured, setFeatured] = useState(product?.featured ?? false)
  const [dropAt, setDropAt] = useState(() => isoToLocalInput(product?.availableFrom ?? null))
  const [attempted, setAttempted] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const update = (key: string, patch: Partial<VariantDraft>) =>
    setVariants((list) => list.map((v) => (v.key === key ? { ...v, ...patch } : v)))
  const addVariant = () => {
    const draft = newDraft(org.baseCurrency)
    setVariants((list) => [...list, draft])
  }
  const removeVariant = (key: string) => setVariants((list) => list.filter((v) => v.key !== key || v.id))

  // Validation is derived from state; it is only displayed after the first save attempt.
  const taxBps = percentToBps(taxRate)
  const skuCounts = new Map<string, number>()
  for (const v of variants) {
    const k = v.sku.trim().toLowerCase()
    if (k) skuCounts.set(k, (skuCounts.get(k) ?? 0) + 1)
  }
  const rowErrors = new Map<string, RowErrors>()
  const parsed = new Map<string, { priceMinor: number; costMinor: number | null | undefined; compareAtMinor: number | null }>()
  for (const v of variants) {
    const e: RowErrors = {}
    if (!v.name.trim()) e.name = 'Name this variant, e.g. Default or Large'
    const sku = v.sku.trim().toLowerCase()
    if (sku && (skuCounts.get(sku) ?? 0) > 1) e.sku = 'SKU is used by another variant above'
    const price = tryParse(v.price, v.currency)
    if ('error' in price) e.price = price.error
    if (!/^\d+$/.test(v.threshold.trim())) e.threshold = 'Whole number, 0 or more'
    let costMinor: number | null | undefined
    if (showCost && v.costTouched) {
      if (!v.cost.trim()) costMinor = null
      else {
        const c = tryParse(v.cost, v.currency)
        if ('error' in c) e.cost = c.error
        else costMinor = c.minor
      }
    }
    let compareAtMinor: number | null = null
    if (v.id && v.compareAt.trim()) {
      const c = tryParse(v.compareAt, v.currency)
      if ('error' in c) e.compareAt = c.error
      else if ('minor' in price && c.minor <= price.minor) e.compareAt = 'Must be higher than the price, or leave empty'
      else compareAtMinor = c.minor
    }
    if (v.swatch && !SWATCH_RE.test(v.swatch)) e.swatch = 'Pick a colour'
    rowErrors.set(v.key, e)
    if ('minor' in price) parsed.set(v.key, { priceMinor: price.minor, costMinor, compareAtMinor })
  }
  const formErrors = {
    name: !name.trim() ? 'Enter a product name' : undefined,
    taxRate: taxBps == null ? 'Enter a percentage between 0 and 100, up to two decimals' : undefined,
    variants: variants.length === 0 ? 'Add at least one variant' : undefined,
    images: images.some((i) => imageUrlError(i.url)) ? 'Fix or remove the highlighted photo links' : undefined,
    dropAt: dropAt.trim() && localInputToIso(dropAt) == null ? 'Pick a valid drop time' : undefined,
  }
  const hasErrors =
    Boolean(formErrors.name || formErrors.taxRate || formErrors.variants || formErrors.images || formErrors.dropAt) ||
    [...rowErrors.values()].some((e) => Object.keys(e).length > 0)
  const shown = (msg: string | undefined) => (attempted ? msg : undefined)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    setAttempted(true)
    if (hasErrors || taxBps == null) return
    const input: ProductInput = {
      id: product?.id ?? createdId ?? undefined,
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      status,
      trackStock,
      taxRateBps: taxBps,
      taxCode: taxCode.trim() || null,
      variants: variants.map((v): VariantInput => {
        const p = parsed.get(v.key)!
        return {
          id: v.id,
          name: v.name.trim(),
          sku: v.sku.trim() || null,
          priceMinor: p.priceMinor,
          lowStockThreshold: Number(v.threshold.trim()),
          isActive: v.isActive,
          costMinor: p.costMinor,
        }
      }),
    }
    const merchNext: ProductMerch = {
      images: images.map((i) => ({ url: i.url.trim(), ...(i.alt.trim() ? { alt: i.alt.trim() } : {}) })),
      featured,
      availableFrom: localInputToIso(dropAt),
    }
    const merchBefore: ProductMerch = {
      images: (product?.images ?? []).map((i) => ({ url: i.url, ...(i.alt ? { alt: i.alt } : {}) })),
      featured: product?.featured ?? false,
      availableFrom: product?.availableFrom ?? null,
    }
    // datetime-local has minute precision; treat sub-minute differences as unchanged.
    const sameDrop =
      merchNext.availableFrom === merchBefore.availableFrom ||
      (merchNext.availableFrom != null &&
        merchBefore.availableFrom != null &&
        Math.abs(Date.parse(merchNext.availableFrom) - Date.parse(merchBefore.availableFrom)) < 60_000)
    const merchChanged =
      JSON.stringify(merchNext.images) !== JSON.stringify(merchBefore.images) || merchNext.featured !== merchBefore.featured || !sameDrop
    const variantMerch = variants.flatMap((v) => {
      if (!v.id) return []
      const cmp = parsed.get(v.key)?.compareAtMinor ?? null
      const sw = v.swatch ? v.swatch.toLowerCase() : null
      if (cmp === v.origCompareAtMinor && sw === (v.origSwatch?.toLowerCase() ?? null)) return []
      return [{ variantId: v.id, m: { compareAtMinor: cmp, swatch: sw } }]
    })
    save.mutate({ input, merch: merchChanged ? merchNext : null, variantMerch }, { onSuccess: onClose })
  }

  function archive() {
    if (!product) return
    save.mutate({ input: storedInput(product, 'archived'), merch: null, variantMerch: [] }, { onSuccess: onClose })
  }

  const hasUnsaved = variants.some((v) => !v.id)
  const canArchive = !readOnly && product && product.status !== 'archived'

  const footer = readOnly ? (
    <Button onClick={onClose}>Close</Button>
  ) : confirmArchive ? (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-2">Archive this product? It stays on past orders but can’t be added to new ones.</p>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="ghost" onClick={() => setConfirmArchive(false)} disabled={save.isPending}>
          Keep it
        </Button>
        <Button variant="danger" onClick={archive} loading={save.isPending}>
          Archive
        </Button>
      </div>
    </div>
  ) : (
    <>
      {canArchive && (
        <Button variant="ghost" className="mr-auto text-neg hover:text-neg" onClick={() => setConfirmArchive(true)} disabled={save.isPending}>
          Archive
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
        {product ? 'Save changes' : 'Add product'}
      </Button>
    </>
  )

  return (
    <Sheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={readOnly ? product?.name ?? 'Product' : product ? 'Edit product' : 'Add product'}
      description={readOnly ? 'Your role can view products but not change them.' : `Prices are in ${org.baseCurrency}.`}
      footer={footer}
    >
      <form id={formId} onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
          {save.isError && <ErrorNotice error={save.error} />}
          {attempted && hasErrors && (
            <p role="alert" className="text-sm font-medium text-neg">
              Check the highlighted fields.
            </p>
          )}

          <Field label="Name" error={shown(formErrors.name)}>
            {(p) => <Input {...p} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Description" optional>
            {(p) => <Textarea {...p} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" optional>
              {(p) => <Input {...p} value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Dresses" />}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <ProductMerchandising
            productName={name.trim()}
            images={images}
            onImagesChange={setImages}
            featured={featured}
            onFeaturedChange={setFeatured}
            dropAt={dropAt}
            onDropAtChange={setDropAt}
            readOnly={readOnly}
            attempted={attempted}
            nowMs={nowMs}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax rate (metadata)" error={shown(formErrors.taxRate)} hint="Applied to new orders using your business's tax setting. Treat it as configuration, not tax advice; confirm rates with an adviser.">
              {(p) => (
                <div className="relative">
                  <Input {...p} inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="tnum pr-9" />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-ink-3">%</span>
                </div>
              )}
            </Field>
            <Field label="Tax code" optional>
              {(p) => <Input {...p} value={taxCode} maxLength={40} onChange={(e) => setTaxCode(e.target.value)} />}
            </Field>
          </div>

          <div className="border-y border-line py-4">
            <Switch
              checked={trackStock}
              onChange={setTrackStock}
              label="Track stock"
              description="Count units on hand and reserve them when orders are placed. Turn off for services or made-to-order items."
              disabled={readOnly}
            />
          </div>

          <div>
            <div className="mb-1 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">Variants</h3>
                <p className="text-xs text-ink-3">Sizes, colours or packs. Each has its own price and stock.</p>
              </div>
              {!readOnly && (
                <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={addVariant}>
                  Add variant
                </Button>
              )}
            </div>
            {shown(formErrors.variants) && (
              <p role="alert" className="mt-2 text-xs font-medium text-neg">
                {formErrors.variants}
              </p>
            )}

            <div className="divide-y divide-line">
              {variants.map((v, i) => {
                const e: RowErrors = (attempted && rowErrors.get(v.key)) || {}
                const saved = Boolean(v.id)
                return (
                  <fieldset key={v.key} className={cn('min-w-0 py-5', !v.isActive && 'opacity-70')}>
                    <legend className="sr-only">Variant {i + 1}</legend>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[13px] font-medium text-ink-2">
                        Variant {i + 1}
                        {!saved && <span className="ml-2 font-normal text-ink-3">new</span>}
                        {saved && trackStock && (
                          <span className="tnum ml-2 font-normal text-ink-3">
                            · {v.onHand} on hand{v.reserved > 0 ? `, ${v.reserved} reserved` : ''}
                          </span>
                        )}
                      </p>
                      {!saved && !readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeVariant(v.key)}
                          disabled={variants.length <= 1}
                          aria-label={`Remove variant ${i + 1}`}
                          title={variants.length <= 1 ? 'A product needs at least one variant' : undefined}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Variant name" error={e.name}>
                        {(p) => <Input {...p} value={v.name} maxLength={80} onChange={(ev) => update(v.key, { name: ev.target.value })} />}
                      </Field>
                      <Field label="SKU" optional error={e.sku}>
                        {(p) => <Input {...p} value={v.sku} maxLength={64} onChange={(ev) => update(v.key, { sku: ev.target.value })} />}
                      </Field>
                      <Field label="Price" error={e.price}>
                        {(p) => <MoneyInput fieldProps={p} currency={v.currency} value={v.price} onChange={(val) => update(v.key, { price: val })} />}
                      </Field>
                      <Field label="Low-stock alert at" error={e.threshold} hint={trackStock ? 'Flag as low when available units reach this.' : 'Used only when stock is tracked.'}>
                        {(p) => (
                          <Input
                            {...p}
                            inputMode="numeric"
                            value={v.threshold}
                            onChange={(ev) => update(v.key, { threshold: ev.target.value })}
                            className="tnum"
                          />
                        )}
                      </Field>
                      {showCost && (
                        <Field label="Cost price" optional error={e.cost} hint="Visible to owners, admins and managers only.">
                          {(p) => (
                            <MoneyInput
                              fieldProps={p}
                              currency={v.currency}
                              value={v.cost}
                              onChange={(val) => update(v.key, { cost: val, costTouched: true })}
                            />
                          )}
                        </Field>
                      )}
                      <Field
                        label="Compare-at price (“was”)"
                        optional
                        error={e.compareAt}
                        hint={
                          saved
                            ? 'Shown struck through next to the price. Only use a price you really charged; in the EU it must be your lowest price in the last 30 days.'
                            : 'Save the product first, then add a compare-at price.'
                        }
                      >
                        {(p) => (
                          <fieldset disabled={!saved} className="min-w-0">
                            <MoneyInput fieldProps={p} currency={v.currency} value={v.compareAt} onChange={(val) => update(v.key, { compareAt: val })} />
                          </fieldset>
                        )}
                      </Field>
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <p id={`${v.key}-swatch`} className="text-[13px] font-semibold text-ink">
                          Colour swatch <span className="font-normal text-ink-3">(optional)</span>
                        </p>
                        <SwatchPicker value={v.swatch} onChange={(hex) => update(v.key, { swatch: hex })} disabled={readOnly || !saved} labelledBy={`${v.key}-swatch`} />
                        <p className="text-xs text-ink-3">
                          {saved ? 'Shoppers pick colours as chips on your shop.' : 'Save the product first, then pick a colour.'}
                        </p>
                        {e.swatch && (
                          <p role="alert" className="text-xs font-medium text-neg">
                            {e.swatch}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4">
                      <Switch
                        checked={v.isActive}
                        onChange={(val) => update(v.key, { isActive: val })}
                        label="Available to sell"
                        description={saved ? 'Turn off to stop selling this variant. Saved variants are deactivated, not deleted.' : undefined}
                        disabled={readOnly}
                      />
                    </div>
                  </fieldset>
                )
              })}
            </div>

            {trackStock && (!product || hasUnsaved) && (
              <Notice>
                New variants start with 0 in stock. After saving, receive stock on the{' '}
                <Link to="/app/inventory" onClick={onClose} className="font-medium underline underline-offset-2">
                  Inventory
                </Link>{' '}
                page.
              </Notice>
            )}
          </div>
        </fieldset>
      </form>
    </Sheet>
  )
}
