import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, Search, Trash2 } from 'lucide-react'
import type { CountryCode } from 'libphonenumber-js'
import { computeOrderTotals } from '@/domain/orders'
import { MoneyError, parseMajor, toMajorString, money } from '@/domain/money'
import { available } from '@/domain/inventory'
import { formatPhone, toE164 } from '@/domain/locale'
import { newIdempotencyKey } from '@/gateway/gateway'
import { CHANNEL_LABEL, ORDER_CHANNELS, type Address, type FulfilmentMethod, type NewOrderInput, type OrderChannel, type Product, type Variant } from '@/gateway/types'
import { useAction, useCustomers, useOrg, useProducts } from '../context'
import { ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
import { Money } from '../ui/format'
import { Button, Field, Input, Select, Skeleton, Textarea } from '../ui/primitives'
import { cn } from '@/lib/utils'

interface DraftLine {
  variantId: string
  quantity: number
  discount: string
}

function variantLabel(p: Product, v: Variant) {
  return p.variants.length > 1 || v.name !== 'Default' ? `${p.name} · ${v.name}` : p.name
}

export default function NewOrderPage() {
  const { org, can } = useOrg()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const products = useProducts()
  const customers = useCustomers()

  const [idemKey] = useState(newIdempotencyKey)
  const [customerId, setCustomerId] = useState<string | null>(params.get('customer'))
  const [customerQuery, setCustomerQuery] = useState('')
  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [channel, setChannel] = useState<OrderChannel>('whatsapp')
  const [productQuery, setProductQuery] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [method, setMethod] = useState<FulfilmentMethod>('pickup')
  const [address, setAddress] = useState<Address>({ countryCode: org.countryCode })
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<NewOrderInput['status']>('confirmed')
  const [touched, setTouched] = useState(false)

  const createCustomer = useAction((g, o, input: { name: string; phone: string | null }) =>
    g.saveCustomer(o, { name: input.name, phoneE164: input.phone, email: null, countryCode: org.countryCode, marketingConsent: false, tags: [], notes: null }),
  )
  const createOrder = useAction((g, o, input: NewOrderInput) => g.createOrder(o, input, idemKey))

  const variants = useMemo(() => {
    const out = new Map<string, { product: Product; variant: Variant }>()
    for (const p of products.data ?? []) {
      if (p.status !== 'active') continue
      for (const v of p.variants) if (v.isActive) out.set(v.id, { product: p, variant: v })
    }
    return out
  }, [products.data])

  const productMatches = useMemo(() => {
    const needle = productQuery.trim().toLowerCase()
    if (!needle) return []
    return [...variants.values()]
      .filter(({ product, variant }) => `${product.name} ${variant.name} ${variant.sku ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [variants, productQuery])

  const customerMatches = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase()
    if (!needle) return []
    return (customers.data ?? [])
      .filter((c) => `${c.name} ${c.phoneE164 ?? ''} ${c.email ?? ''}`.toLowerCase().includes(needle.replace(/\s/g, '')) || c.name.toLowerCase().includes(needle))
      .slice(0, 6)
  }, [customers.data, customerQuery])

  const selectedCustomer = customers.data?.find((c) => c.id === customerId) ?? null

  // Parse money inputs once; collect field errors.
  const parsed = useMemo(() => {
    const errors: Record<string, string> = {}
    const parseOrError = (key: string, value: string) => {
      if (!value.trim()) return 0
      try {
        const m = parseMajor(value, org.baseCurrency)
        if (m.amountMinor < 0) throw new MoneyError('Cannot be negative')
        return m.amountMinor
      } catch (e) {
        errors[key] = (e as Error).message
        return 0
      }
    }
    const fee = method === 'delivery' ? parseOrError('fee', deliveryFee) : 0
    const discounts = lines.map((l, i) => parseOrError(`discount-${i}`, l.discount))
    return { fee, discounts, errors }
  }, [deliveryFee, lines, method, org.baseCurrency])

  const preview = useMemo(() => {
    if (lines.length === 0) return null
    try {
      return computeOrderTotals({
        currency: org.baseCurrency,
        taxMode: org.taxMode,
        deliveryFeeMinor: parsed.fee,
        lines: lines.map((l, i) => {
          const entry = variants.get(l.variantId)!
          return {
            unitPriceMinor: entry.variant.priceMinor,
            quantity: l.quantity,
            taxRateBps: entry.product.taxRateBps,
            discountMinor: parsed.discounts[i],
            currency: entry.variant.currency,
          }
        }),
      })
    } catch (e) {
      return e as Error
    }
  }, [lines, parsed, variants, org.baseCurrency, org.taxMode])

  const stockWarnings = lines
    .map((l) => {
      const entry = variants.get(l.variantId)
      if (!entry || !entry.product.trackStock) return null
      const avail = available(entry.variant)
      return status !== 'draft' && l.quantity > avail ? `${variantLabel(entry.product, entry.variant)}: only ${Math.max(avail, 0)} available` : null
    })
    .filter(Boolean) as string[]

  const recipientPhoneResult = recipientPhone.trim() ? toE164(recipientPhone, org.countryCode as CountryCode) : null
  const quickPhoneResult = quickPhone.trim() ? toE164(quickPhone, org.countryCode as CountryCode) : null

  function addLine(variantId: string) {
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.variantId === variantId)
      if (existing >= 0) return prev.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l))
      return [...prev, { variantId, quantity: 1, discount: '' }]
    })
    setProductQuery('')
  }

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const formErrors: string[] = []
  if (lines.length === 0) formErrors.push('Add at least one product.')
  if (Object.keys(parsed.errors).length) formErrors.push('Fix the highlighted amounts.')
  if (preview instanceof Error) formErrors.push(preview.message)
  if (method === 'delivery' && !address.line1?.trim()) formErrors.push('Add a delivery address.')
  if (recipientPhoneResult && !recipientPhoneResult.ok) formErrors.push('Recipient phone is not valid.')
  if (!customerId && quickPhoneResult && !quickPhoneResult.ok) formErrors.push('Customer phone is not valid.')
  if (stockWarnings.length) formErrors.push('Some items do not have enough stock.')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (formErrors.length) return
    let cid = customerId
    if (!cid && quickName.trim()) {
      if (quickPhoneResult && !quickPhoneResult.ok) return
      cid = await createCustomer.mutateAsync({ name: quickName.trim(), phone: quickPhoneResult?.ok ? quickPhoneResult.e164 : null })
      setCustomerId(cid)
    }
    const id = await createOrder.mutateAsync({
      status,
      channel,
      customerId: cid,
      note: note.trim() || null,
      deliveryFeeMinor: parsed.fee,
      fulfilment: {
        method,
        recipientName: method === 'delivery' ? recipientName.trim() || selectedCustomer?.name || quickName.trim() || null : null,
        recipientPhone: method === 'delivery' && recipientPhoneResult?.ok ? recipientPhoneResult.e164 : null,
        address: method === 'delivery' ? address : {},
      },
      lines: lines.map((l, i) => ({ variantId: l.variantId, quantity: l.quantity, discountMinor: parsed.discounts[i] })),
    })
    navigate(`/app/orders/${id}`, { replace: true })
  }

  if (!can('orders.create')) {
    return (
      <>
        <PageHeader title="New order" />
        <Notice tone="warn">Your role can view orders but not create them. Ask an owner or admin for sales access.</Notice>
      </>
    )
  }

  const busy = createOrder.isPending || createCustomer.isPending
  const mutationError = createOrder.error ?? createCustomer.error

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title="New order"
        description={`Prices come from your catalogue in ${org.baseCurrency}. Totals are recalculated on the server when you save.`}
        back={
          <Link to="/app/orders" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Orders
          </Link>
        }
      />

      <div className="grid gap-x-12 gap-y-2 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-x-16">
        <div className="min-w-0">
          <Section title="Customer" description="Who the order is for.">
            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{selectedCustomer.name}</p>
                  <p className="tnum truncate text-sm text-ink-3">
                    {selectedCustomer.phoneE164 ? formatPhone(selectedCustomer.phoneE164) : selectedCustomer.email ?? 'No contact details'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCustomerId(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <label className="relative block">
                    <span className="sr-only">Find a customer</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                    <Input value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Find customer by name, phone or email" className="pl-9" />
                  </label>
                  {customerMatches.length > 0 && (
                    <ul className="mt-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                      {customerMatches.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerId(c.id)
                              setCustomerQuery('')
                            }}
                            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-sunken"
                          >
                            <span className="min-w-0 truncate font-medium">{c.name}</span>
                            <span className="tnum shrink-0 text-ink-3">{c.phoneE164 ? formatPhone(c.phoneE164) : c.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-ink-3">Or add a new customer now — leave both blank for a walk-in sale.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" optional>
                    {(p) => <Input {...p} value={quickName} onChange={(e) => setQuickName(e.target.value)} />}
                  </Field>
                  <Field
                    label="Phone"
                    optional
                    error={quickPhoneResult && !quickPhoneResult.ok ? quickPhoneResult.error : null}
                    hint={quickPhoneResult?.ok ? `Saved as ${formatPhone(quickPhoneResult.e164)}` : 'Any country; local numbers use your business country.'}
                  >
                    {(p) => <Input {...p} type="tel" inputMode="tel" value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} />}
                  </Field>
                </div>
              </div>
            )}
          </Section>

          <Section title="Items" description="Prices and stock come from your catalogue." className="border-t border-line pt-6">
            {products.isPending ? (
              <Skeleton className="h-10" />
            ) : products.isError ? (
              <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
            ) : variants.size === 0 ? (
              <Notice>
                No active products yet. <Link to="/app/products" className="font-medium underline">Add products</Link> first.
              </Notice>
            ) : (
              <div className="relative mb-4">
                <label className="relative block">
                  <span className="sr-only">Add a product</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                  <Input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search products or SKU to add" className="pl-9" />
                </label>
                {productMatches.length > 0 && (
                  <ul className="mt-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                    {productMatches.map(({ product, variant }) => {
                      const avail = available(variant)
                      return (
                        <li key={variant.id}>
                          <button type="button" onClick={() => addLine(variant.id)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-sunken">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{variantLabel(product, variant)}</span>
                              <span className="text-xs text-ink-3">
                                {variant.sku ?? 'No SKU'} · {product.trackStock ? `${Math.max(avail, 0)} available` : 'Stock not tracked'}
                              </span>
                            </span>
                            <Money minor={variant.priceMinor} currency={variant.currency} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {productQuery.trim() && productMatches.length === 0 && <p className="mt-2 text-sm text-ink-3">No active product matches “{productQuery}”.</p>}
              </div>
            )}

            {lines.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {lines.map((l, i) => {
                  const entry = variants.get(l.variantId)
                  if (!entry) return null
                  const lineTotals = preview && !(preview instanceof Error) ? preview.lines[i] : null
                  return (
                    <li key={l.variantId} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 py-3 sm:grid-cols-[1fr_auto_120px_110px_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{variantLabel(entry.product, entry.variant)}</p>
                        <p className="text-xs text-ink-3">
                          <Money minor={entry.variant.priceMinor} currency={entry.variant.currency} /> each
                          {entry.product.taxRateBps > 0 && ` · tax ${entry.product.taxRateBps / 100}%`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 justify-self-end sm:justify-self-auto">
                        <Button size="sm" variant="ghost" aria-label="Decrease quantity" onClick={() => updateLine(i, { quantity: Math.max(1, l.quantity - 1) })} className="px-2">
                          <Minus className="size-4" />
                        </Button>
                        <input
                          aria-label={`Quantity of ${entry.product.name}`}
                          inputMode="numeric"
                          value={l.quantity}
                          onChange={(e) => {
                            const v = Number.parseInt(e.target.value.replace(/\D/g, ''), 10)
                            updateLine(i, { quantity: Number.isFinite(v) && v > 0 ? Math.min(v, 99999) : 1 })
                          }}
                          className="tnum h-9 w-12 rounded-lg border border-line-strong bg-panel text-center text-sm text-ink focus:border-brand focus:outline-none"
                        />
                        <Button size="sm" variant="ghost" aria-label="Increase quantity" onClick={() => updateLine(i, { quantity: l.quantity + 1 })} className="px-2">
                          <Plus className="size-4" />
                        </Button>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="sr-only" htmlFor={`disc-${i}`}>
                          Discount for {entry.product.name}
                        </label>
                        <Input
                          id={`disc-${i}`}
                          value={l.discount}
                          onChange={(e) => updateLine(i, { discount: e.target.value })}
                          placeholder="Discount"
                          inputMode="decimal"
                          aria-invalid={parsed.errors[`discount-${i}`] ? true : undefined}
                          className="h-9"
                        />
                        {touched && parsed.errors[`discount-${i}`] && <p className="mt-1 text-xs text-neg">{parsed.errors[`discount-${i}`]}</p>}
                      </div>
                      <p className="tnum self-center text-right font-medium text-ink">
                        {lineTotals ? <Money minor={lineTotals.totalMinor} currency={org.baseCurrency} /> : '—'}
                      </p>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${entry.product.name}`} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="justify-self-end px-2">
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            {lines.length === 0 && variants.size > 0 && (
              <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-sm text-ink-3">No items yet. Search above to add the first one.</p>
            )}
            {stockWarnings.length > 0 && (
              <div className="mt-3">
                <Notice tone="warn">
                  {stockWarnings.map((w) => (
                    <span key={w} className="block">
                      {w}
                    </span>
                  ))}
                  Receive stock in Inventory, lower the quantity, or save as a draft.
                </Notice>
              </div>
            )}
          </Section>

          <Section title="Fulfilment" description="How the order reaches the customer." className="border-t border-line pt-6">
            <div role="radiogroup" aria-label="Fulfilment method" className="mb-5 inline-flex rounded-lg bg-sunken p-1">
              {(['pickup', 'delivery'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'h-9 min-w-24 rounded-md px-4 text-sm font-medium transition-colors',
                    method === m ? 'bg-panel text-ink ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  {m === 'pickup' ? 'Pickup' : 'Delivery'}
                </button>
              ))}
            </div>
            {method === 'delivery' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Recipient" optional hint="Defaults to the customer.">
                  {(p) => <Input {...p} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />}
                </Field>
                <Field label="Recipient phone" optional error={touched && recipientPhoneResult && !recipientPhoneResult.ok ? recipientPhoneResult.error : null}>
                  {(p) => <Input {...p} type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />}
                </Field>
                <Field label="Address line 1" className="sm:col-span-2" error={touched && !address.line1?.trim() ? 'Required for delivery' : null}>
                  {(p) => <Input {...p} autoComplete="address-line1" value={address.line1 ?? ''} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />}
                </Field>
                <Field label="Address line 2" optional className="sm:col-span-2">
                  {(p) => <Input {...p} autoComplete="address-line2" value={address.line2 ?? ''} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />}
                </Field>
                <Field label="City / town" optional>
                  {(p) => <Input {...p} autoComplete="address-level2" value={address.city ?? ''} onChange={(e) => setAddress({ ...address, city: e.target.value })} />}
                </Field>
                <Field label="Region / state" optional>
                  {(p) => <Input {...p} autoComplete="address-level1" value={address.region ?? ''} onChange={(e) => setAddress({ ...address, region: e.target.value })} />}
                </Field>
                <Field label="Postal code" optional>
                  {(p) => <Input {...p} autoComplete="postal-code" value={address.postalCode ?? ''} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />}
                </Field>
                <Field label={`Delivery fee (${org.baseCurrency})`} optional error={touched ? parsed.errors.fee : null}>
                  {(p) => <Input {...p} inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder={toMajorString(money(0, org.baseCurrency))} />}
                </Field>
                <Field label="Delivery instructions" optional className="sm:col-span-2">
                  {(p) => <Textarea {...p} rows={2} value={address.instructions ?? ''} onChange={(e) => setAddress({ ...address, instructions: e.target.value })} />}
                </Field>
              </div>
            )}
          </Section>

          <Section title="Details" description="For your reports and your team." className="border-t border-line pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Channel" hint="Where the customer reached you. Used for channel reports.">
                {(p) => (
                  <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as OrderChannel)}>
                    {ORDER_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Internal note" optional className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </div>
          </Section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-labelledby="new-order-summary-h">
          <div className="border-t border-line pt-6 lg:rounded-[var(--radius-card)] lg:border lg:bg-panel lg:p-5">
            <h2 id="new-order-summary-h" className="mb-2 font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">
              Summary
            </h2>
            <dl className="divide-y divide-line text-sm">
              {preview && !(preview instanceof Error) ? (
                <>
                  <SummaryRow label="Subtotal" minor={preview.subtotalMinor} currency={org.baseCurrency} />
                  {preview.discountMinor > 0 && <SummaryRow label="Discounts" minor={-preview.discountMinor} currency={org.baseCurrency} />}
                  <SummaryRow label={org.taxMode === 'inclusive' ? 'Tax included' : 'Tax'} minor={preview.taxMinor} currency={org.baseCurrency} />
                  {method === 'delivery' && <SummaryRow label="Delivery" minor={preview.deliveryFeeMinor} currency={org.baseCurrency} />}
                  <div className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="font-semibold text-ink">Total</dt>
                    <dd className="text-right">
                      <Money minor={preview.totalMinor} currency={org.baseCurrency} className="font-display text-[18px] font-semibold tracking-tight text-ink" />
                    </dd>
                  </div>
                </>
              ) : (
                <p className="py-3 text-ink-3">Add items to see totals.</p>
              )}
            </dl>
            <p className="text-xs leading-relaxed text-ink-3">Payments are recorded on the order once you have received them.</p>

            <fieldset className="mt-5 border-t border-line pt-4">
              <legend className="float-left mb-2 w-full text-[13px] font-semibold text-ink">Save as</legend>
              {(
                [
                  ['confirmed', 'Confirmed', 'Reserves stock now.'],
                  ['pending_confirmation', 'Awaiting confirmation', 'Reserves stock until you confirm or cancel.'],
                  ['draft', 'Draft', 'No stock reserved.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="clear-left flex min-h-10 cursor-pointer items-start gap-3 py-1.5">
                  <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} className="mt-1 size-4 shrink-0 accent-[var(--ak-accent)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{label}</span>
                    <span className="block text-xs text-ink-3">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {touched && formErrors.length > 0 && (
              <ul className="mt-4 list-inside list-disc text-sm text-neg" role="alert">
                {formErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {mutationError && (
              <div className="mt-4">
                <ErrorNotice error={mutationError} />
              </div>
            )}
            {/* Below lg the submit lives in the bottom bar so it is always in reach. */}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 hidden w-full lg:inline-flex">
              Save order
            </Button>
          </div>
        </aside>
      </div>

      {/* Phones and tablets: total + save, kept above the mobile tab bar and the safe area. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">{touched && formErrors.length > 0 ? `${formErrors.length} ${formErrors.length === 1 ? 'thing' : 'things'} to fix in the summary` : 'Total'}</p>
          <p className="truncate font-display text-[17px] font-semibold tracking-tight text-ink">
            {preview && !(preview instanceof Error) ? <Money minor={preview.totalMinor} currency={org.baseCurrency} /> : <span className="text-sm font-normal text-ink-3">Add items</span>}
          </p>
        </div>
        <Button type="submit" variant="primary" loading={busy} className="shrink-0">
          Save order
        </Button>
      </div>
    </form>
  )
}

function SummaryRow({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink-2">
        <Money minor={minor} currency={currency} />
      </dd>
    </div>
  )
}
