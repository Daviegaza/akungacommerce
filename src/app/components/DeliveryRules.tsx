import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_SHOP_POLICY,
  MAX_ATTEMPTS_LIMIT,
  policyText,
  validateShopPolicy,
  type PaymentMode,
  type ShopPolicy,
} from '@/domain/delivery-policy'
import { formatMoney, money, parseMajor, toMajorString } from '@/domain/money'
import type { PickupPoint } from '@/gateway/delivery'
import { useAction, useOrg, useOrgQuery } from '../context'
import { EmptyState, ErrorNotice, Notice } from '../ui/layout'
import { Button, Field, Input, Select, Skeleton, Switch } from '../ui/primitives'

/**
 * Settings row: on lg a 260px label column (title + one-line description) beside the fields;
 * stacked on phones. Sections are divided by a top hairline. Shared by the settings pages.
 */
export function SettingsBlock({
  title,
  description,
  actions,
  children,
  id,
  wide,
  first,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** Optional anchor id for in-page links. */
  id?: string
  /** Full-width content (tables, logs): heading row above instead of a label column. */
  wide?: boolean
  /** First block under the page header: no top hairline (the header already draws one). */
  first?: boolean
}) {
  const headingId = useId()
  if (wide) {
    return (
      <section id={id} aria-labelledby={headingId} className={`scroll-mt-24 ${first ? 'pb-7' : 'border-t border-line py-7'}`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </section>
    )
  }
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`grid scroll-mt-24 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10 ${first ? 'pb-7' : 'border-t border-line py-7'}`}
    >
      <div className="min-w-0">
        <h2 id={headingId} className="font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

const MODE_LABEL: Record<PaymentMode, { title: string; body: string }> = {
  pay_on_delivery: { title: 'Pay on delivery', body: 'Nothing is due before the order arrives.' },
  deposit: { title: 'Deposit now, balance on delivery', body: 'Buyers pay part up front. Protects you from no-shows.' },
  full_prepay: { title: 'Full payment first', body: 'You dispatch only paid orders. Cash on delivery is switched off.' },
}

interface PolicyForm {
  paymentMode: PaymentMode
  depositKind: 'percent' | 'fixed'
  percent: string
  fixed: string
  minOrder: string
  coversDelivery: boolean
  payer: 'buyer' | 'seller'
  attempts: string
}

function toForm(p: ShopPolicy, currency: string): PolicyForm {
  return {
    paymentMode: p.paymentMode,
    depositKind: p.depositKind,
    percent: String(p.depositPercentBps / 100),
    fixed: p.depositFixedMinor ? toMajorString(money(p.depositFixedMinor, currency)) : '',
    minOrder: p.depositMinOrderMinor ? toMajorString(money(p.depositMinOrderMinor, currency)) : '',
    coversDelivery: p.depositCoversDelivery,
    payer: p.failedDeliveryPayer,
    attempts: String(p.maxDeliveryAttempts),
  }
}

function fromForm(f: PolicyForm, currency: string): { policy: ShopPolicy | null; error: string | null } {
  try {
    const pct = Number(f.percent)
    const policy: ShopPolicy = {
      paymentMode: f.paymentMode,
      depositKind: f.depositKind,
      depositPercentBps: Number.isFinite(pct) ? Math.round(pct * 100) : NaN,
      depositFixedMinor: f.fixed.trim() ? parseMajor(f.fixed, currency).amountMinor : 0,
      depositMinOrderMinor: f.minOrder.trim() ? parseMajor(f.minOrder, currency).amountMinor : 0,
      depositCoversDelivery: f.coversDelivery,
      failedDeliveryPayer: f.payer,
      maxDeliveryAttempts: Number(f.attempts),
    }
    const first = Object.values(validateShopPolicy(policy))[0]
    return first ? { policy: null, error: first } : { policy, error: null }
  } catch (e) {
    return { policy: null, error: e instanceof Error ? e.message : 'Check the amounts.' }
  }
}

/** Payment and failed-delivery rules (separate from the main shop form; saved by save_shop_policy). */
export function DeliveryRulesSection() {
  const query = useOrgQuery('shop-policy', (g, o) => g.getShopPolicy(o))
  return (
    <SettingsBlock
      id="deposits"
      title="Deposits and failed deliveries"
      description="Set what buyers pay up front and who pays for a wasted delivery trip. Buyers see these rules, in plain words, before they order."
    >
      {query.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PolicyEditor key={JSON.stringify(query.data)} saved={query.data ?? DEFAULT_SHOP_POLICY} />
      )}
    </SettingsBlock>
  )
}

function PolicyEditor({ saved }: { saved: ShopPolicy }) {
  const { org, can } = useOrg()
  const readOnly = !can('org.manage')
  const currency = org.baseCurrency
  const [form, setForm] = useState<PolicyForm>(() => toForm(saved, currency))
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const save = useAction<ShopPolicy>((g, o, p) => g.saveShopPolicy(o, p))
  const set = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setJustSaved(false)
  }
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved, currency))
  const preview = fromForm(form, currency).policy

  function submit(e: FormEvent) {
    e.preventDefault()
    const { policy, error: err } = fromForm(form, currency)
    setError(err)
    if (!policy) return
    save.mutate(policy, { onSuccess: () => setJustSaved(true) })
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-[13px] font-semibold text-ink">How buyers pay</legend>
          <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
            {(Object.keys(MODE_LABEL) as PaymentMode[]).map((m) => (
              <label
                key={m}
                className={`flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 text-sm transition-colors ${
                  form.paymentMode === m ? 'bg-sunken/60' : 'hover:bg-sunken/40'
                }`}
              >
                <input
                  type="radio"
                  name="payment-mode"
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                  checked={form.paymentMode === m}
                  onChange={() => set('paymentMode', m)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{MODE_LABEL[m].title}</span>
                  <span className="block text-xs leading-relaxed text-ink-3">{MODE_LABEL[m].body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {form.paymentMode === 'deposit' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Deposit type">
              {(p) => (
                <Select {...p} value={form.depositKind} onChange={(e) => set('depositKind', e.target.value as PolicyForm['depositKind'])}>
                  <option value="percent">Percentage of the total</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              )}
            </Field>
            {form.depositKind === 'percent' ? (
              <Field label="Deposit (%)" hint="Of the full total, including delivery.">
                {(p) => <Input {...p} inputMode="decimal" className="tnum" value={form.percent} onChange={(e) => set('percent', e.target.value)} />}
              </Field>
            ) : (
              <Field label={`Deposit (${currency})`}>
                {(p) => <Input {...p} inputMode="decimal" className="tnum" value={form.fixed} onChange={(e) => set('fixed', e.target.value)} />}
              </Field>
            )}
            <Field label={`Only on orders from (${currency})`} optional hint="Leave empty to ask on every order.">
              {(p) => <Input {...p} inputMode="decimal" className="tnum" value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} />}
            </Field>
            <div className="sm:col-span-3">
              <Switch
                checked={form.coversDelivery}
                onChange={(v) => set('coversDelivery', v)}
                label="Deposit covers at least the delivery fee"
                description="So a wasted trip is always paid for."
                disabled={readOnly}
              />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="If a delivery fails because of the buyer" hint="Not reachable, refused, or wrong address. Failures caused by you or your rider never cost the buyer.">
            {(p) => (
              <Select {...p} value={form.payer} onChange={(e) => set('payer', e.target.value as PolicyForm['payer'])}>
                <option value="buyer">Keep that trip’s delivery fee from the deposit</option>
                <option value="seller">I pay for the return trip</option>
              </Select>
            )}
          </Field>
          <Field label="Delivery attempts" hint="After the last failed attempt, the order stops going out.">
            {(p) => (
              <Select {...p} value={form.attempts} onChange={(e) => set('attempts', e.target.value)}>
                {Array.from({ length: MAX_ATTEMPTS_LIMIT }, (_, i) => String(i + 1)).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === '1' ? 'attempt' : 'attempts'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {preview && (
          <div className="rounded-lg border border-line bg-sunken/50 px-4 py-3">
            <p className="text-xs font-medium text-ink-3">What buyers will read</p>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-ink">
              {policyText(preview, { currency, locale: org.locale, delivers: true }).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
        {form.paymentMode === 'deposit' && form.payer === 'buyer' && (
          <Notice>Deposits are paid like any other payment on the order. Fungua records what was kept for a failed trip; refund the rest yourself if an order is cancelled.</Notice>
        )}
      </fieldset>

      {!readOnly && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={!dirty && !save.isError}>
            Save rules
          </Button>
          <span className="text-sm" aria-live="polite">
            {error || save.isError ? (
              <span className="font-medium text-neg">{error ?? (save.error instanceof Error ? save.error.message : 'Could not save.')}</span>
            ) : justSaved ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-pos">
                <Check className="size-4" aria-hidden /> Saved
              </span>
            ) : dirty ? (
              <span className="text-ink-2">Unsaved changes</span>
            ) : null}
          </span>
        </div>
      )}
    </form>
  )
}

/* ───────────── Pick-up points ───────────── */

export function PickupPointsSection() {
  const { org, can } = useOrg()
  const readOnly = !can('org.manage')
  const query = useOrgQuery('pickup-points', (g, o) => g.listPickupPoints(o))
  const [adding, setAdding] = useState(false)
  const points = query.data ?? []
  const active = points.filter((p) => p.active)

  return (
    <SettingsBlock
      id="pickup-points"
      title="Pick-up points"
      description="Agent shops or counters where buyers can collect. Buyers see them at checkout with the fee and opening hours. This is your own list — no courier network is connected."
      actions={
        !readOnly && !adding && (
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add point
          </Button>
        )
      }
    >
      {query.isPending ? (
        <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="space-y-3">
          {active.length === 0 && !adding && (
            <EmptyState title="No pick-up points yet" body="Add an agent shop or counter you already use. Buyers can then choose it at checkout instead of home delivery." />
          )}
          {active.length > 0 && (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
              <div className="hidden grid-cols-[minmax(0,1fr)_120px_112px] gap-4 border-b border-line bg-sunken/50 px-4 py-2.5 text-xs font-medium text-ink-3 sm:grid" aria-hidden>
                <span>Point</span>
                <span className="text-right">Buyer pays</span>
                <span />
              </div>
              <ul className="divide-y divide-line">
                {active.map((p) => (
                  <PointRow key={p.id} point={p} currency={org.baseCurrency} locale={org.locale} readOnly={readOnly} />
                ))}
              </ul>
            </div>
          )}
          {adding && (
            <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4">
              <PointEditor currency={org.baseCurrency} onDone={() => setAdding(false)} />
            </div>
          )}
          {points.length > active.length && <p className="text-xs text-ink-3">{points.length - active.length} removed point(s) are kept on past orders.</p>}
        </div>
      )}
    </SettingsBlock>
  )
}

function PointRow({ point, currency, locale, readOnly }: { point: PickupPoint; currency: string; locale: string; readOnly: boolean }) {
  const [editing, setEditing] = useState(false)
  const archive = useAction<void>((g, o) => g.archivePickupPoint(o, point.id))
  if (editing) {
    return (
      <li className="bg-sunken/30 p-4">
        <PointEditor currency={currency} point={point} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_112px]">
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium text-ink">{point.name}</p>
        <p className="truncate text-xs text-ink-3">{[point.area, point.hours].filter(Boolean).join(' · ') || 'No area or hours yet'}</p>
      </div>
      <p className="tnum text-right text-sm text-ink">
        <span className="sr-only">Buyer pays </span>
        {point.feeMinor === 0 ? 'Free' : formatMoney(money(point.feeMinor, currency), locale)}
      </p>
      {!readOnly && (
        <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
          <Button size="sm" variant="ghost" className="h-10" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="size-10 px-0" aria-label={`Remove ${point.name}`} loading={archive.isPending} onClick={() => archive.mutate()}>
            {!archive.isPending && <Trash2 className="size-4" aria-hidden />}
          </Button>
        </div>
      )}
      {archive.isError && (
        <div className="col-span-full">
          <ErrorNotice error={archive.error} />
        </div>
      )}
    </li>
  )
}

function PointEditor({ currency, point, onDone }: { currency: string; point?: PickupPoint; onDone(): void }) {
  const [name, setName] = useState(point?.name ?? 'Pick-up point · ')
  const [area, setArea] = useState(point?.area ?? '')
  const [hours, setHours] = useState(point?.hours ?? '')
  const [fee, setFee] = useState(point ? toMajorString(money(point.feeMinor, currency)) : '')
  const [touched, setTouched] = useState(false)
  const save = useAction<number>((g, o, feeMinor) =>
    g.savePickupPoint(o, { id: point?.id, name: name.trim(), area: area.trim() || null, hours: hours.trim() || null, feeMinor, active: true }),
  )
  let feeMinor: number | null = null
  let feeError: string | null = null
  try {
    feeMinor = parseMajor(fee || '0', currency).amountMinor
    if (feeMinor < 0) feeError = 'The fee can’t be negative.'
  } catch (e) {
    feeError = e instanceof Error ? e.message : 'Not a valid amount.'
  }
  const nameError = name.trim().length < 2 ? 'Give it a name buyers recognise.' : null

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (nameError || feeError || feeMinor === null) return
        save.mutate(feeMinor, { onSuccess: onDone })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={touched ? nameError : null}>
          {(p) => <Input {...p} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Area or landmark" optional>
          {(p) => <Input {...p} value={area} maxLength={120} placeholder="e.g. Moi Avenue, next to the bank" onChange={(e) => setArea(e.target.value)} />}
        </Field>
        <Field label="Opening hours" optional>
          {(p) => <Input {...p} value={hours} maxLength={120} placeholder="e.g. Mon–Sat 8am–7pm" onChange={(e) => setHours(e.target.value)} />}
        </Field>
        <Field label={`Fee the buyer pays (${currency})`} error={touched ? feeError : null}>
          {(p) => <Input {...p} inputMode="decimal" className="tnum" value={fee} onChange={(e) => setFee(e.target.value)} />}
        </Field>
      </div>
      {save.isError && <ErrorNotice error={save.error} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
          {point ? 'Save point' : 'Add point'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
