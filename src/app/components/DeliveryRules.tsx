import { useState, type FormEvent } from 'react'
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
import { EmptyState, ErrorNotice, Notice, Section } from '../ui/layout'
import { Badge, Button, Field, Input, Select, Skeleton, Switch } from '../ui/primitives'

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
    <Section
      title="Deposits and failed deliveries"
      description="Set what buyers pay up front and who pays for a wasted delivery trip. Buyers see these rules, in plain words, before they order."
    >
      {query.isPending ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PolicyEditor key={JSON.stringify(query.data)} saved={query.data ?? DEFAULT_SHOP_POLICY} />
      )}
    </Section>
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
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">How buyers pay</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(MODE_LABEL) as PaymentMode[]).map((m) => (
              <label
                key={m}
                className={`flex min-h-16 cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
                  form.paymentMode === m ? 'border-brand bg-brand-soft/60' : 'border-line-strong hover:bg-sunken'
                }`}
              >
                <input type="radio" name="payment-mode" className="sr-only" checked={form.paymentMode === m} onChange={() => set('paymentMode', m)} />
                <span className="font-semibold text-ink">{MODE_LABEL[m].title}</span>
                <span className="text-xs text-ink-3">{MODE_LABEL[m].body}</span>
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
          <div className="rounded-2xl bg-sunken p-4">
            <p className="text-xs font-semibold text-ink-2">What buyers will read</p>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-ink">
              {policyText(preview, { currency, locale: org.locale, delivers: true }).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
        {form.paymentMode === 'deposit' && form.payer === 'buyer' && (
          <Notice>Deposits are paid like any other payment on the order. Rafu records what was kept for a failed trip; refund the rest yourself if an order is cancelled.</Notice>
        )}
      </fieldset>

      {!readOnly && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="brand" loading={save.isPending} disabled={!dirty && !save.isError}>
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
    <Section
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
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="space-y-3">
          {active.length === 0 && !adding && (
            <EmptyState title="No pick-up points yet" body="Add an agent shop or counter you already use. Buyers can then choose it at checkout instead of home delivery." />
          )}
          <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
            {active.map((p) => (
              <PointRow key={p.id} point={p} currency={org.baseCurrency} locale={org.locale} readOnly={readOnly} />
            ))}
          </ul>
          {adding && <PointEditor currency={org.baseCurrency} onDone={() => setAdding(false)} />}
          {points.length > active.length && <p className="text-xs text-ink-3">{points.length - active.length} removed point(s) are kept on past orders.</p>}
        </div>
      )}
    </Section>
  )
}

function PointRow({ point, currency, locale, readOnly }: { point: PickupPoint; currency: string; locale: string; readOnly: boolean }) {
  const [editing, setEditing] = useState(false)
  const archive = useAction<void>((g, o) => g.archivePickupPoint(o, point.id))
  if (editing) {
    return (
      <li className="p-3">
        <PointEditor currency={currency} point={point} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">{point.name}</p>
        <p className="text-ink-3">{[point.area, point.hours].filter(Boolean).join(' · ') || 'No area or hours yet'}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge>{point.feeMinor === 0 ? 'Free' : formatMoney(money(point.feeMinor, currency), locale)}</Badge>
        {!readOnly && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Remove ${point.name}`} loading={archive.isPending} onClick={() => archive.mutate()}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </>
        )}
      </div>
      {archive.isError && <div className="w-full"><ErrorNotice error={archive.error} /></div>}
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
      className="space-y-3 rounded-2xl border border-line bg-panel p-3"
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
