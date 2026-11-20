import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Hourglass, Radio, ScanSearch, ShieldCheck, ShieldQuestion, Smartphone, XCircle } from 'lucide-react'
import { isReviewable, type ReceiptVerification } from '@/domain/reconciliation'
import {
  PROMPT_STATUS_LABEL,
  RECEIPT_STATUS_LABEL,
  receiptProviderText,
  receiptSourceText,
  type CollectionsProviderId,
  type CollectionsSettings,
  type MpesaPrompt,
  type MpesaReceipt,
} from '@/gateway/collections'
import type { IntegrationLabel, IntegrationStatus, OrderSummary } from '@/gateway/types'
import { INTEGRATION_LABEL_TEXT } from '@/integrations/registry'
import { usePendingPoll } from '@/lib/usePendingPoll'
import { useAction, useGateway, useIntegrations, useOrders, useOrg, useOrgQuery } from '../context'
import { BankTransferAccounts } from './BankTransferAccounts'
import { EmptyState, ErrorNotice, Section } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Badge, Button, Input, PillTabs, Select, Skeleton, type Tone } from '../ui/primitives'
import { cn } from '@/lib/utils'

/* ───────────── Provider status ───────────── */

const PROVIDER_TEXT: Record<CollectionsProviderId, { name: string; who: string }> = {
  daraja: { name: 'M-Pesa Daraja (direct)', who: 'For a registered Till or Paybill (needs a business KRA PIN). Prompts and confirmations come straight from Safaricom.' },
  aggregator: { name: 'Payment aggregator', who: 'For Pochi la Biashara or a personal number. A licensed aggregator sends the prompt and confirms the payment.' },
  manual: { name: 'Manual', who: 'You check your M-Pesa messages and confirm each payment yourself. Nothing can be verified automatically.' },
}

const LABEL_TONE: Record<IntegrationLabel, Tone> = {
  connected_verified: 'pos',
  configured_unverified: 'warn',
  adapter_only: 'neutral',
  not_implemented: 'neutral',
}

function labelFor(settings: CollectionsSettings, integrations: IntegrationStatus[]): IntegrationLabel | null {
  if (settings.provider === 'manual') return null
  const key = settings.provider === 'daraja' ? 'mpesa' : settings.aggregator
  return integrations.find((i) => i.provider === key)?.label ?? 'adapter_only'
}

function ProviderPanel({ settings, integrations, demo }: { settings: CollectionsSettings; integrations: IntegrationStatus[]; demo: boolean }) {
  const { can } = useOrg()
  const [draft, setDraft] = useState<CollectionsSettings>(settings)
  const save = useAction((g, orgId, s: CollectionsSettings) => g.setCollectionsProvider(orgId, s))
  const aggregators = integrations.filter((i) => i.provider === 'intasend' || i.provider === 'pesapal')
  const groupId = useId()
  const label = labelFor(settings, integrations)
  const dirty = draft.provider !== settings.provider || (draft.provider === 'aggregator' && draft.aggregator !== settings.aggregator)
  const allowed = can('integrations.manage')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">Now:</span>
        <span className="font-semibold text-ink">{PROVIDER_TEXT[settings.provider].name}</span>
        {settings.provider === 'aggregator' && settings.aggregator && <span className="text-ink-2">({settings.aggregator})</span>}
        {label && <Badge tone={LABEL_TONE[label]}>{INTEGRATION_LABEL_TEXT[label]}</Badge>}
        {demo && settings.provider === 'daraja' && <Badge tone="info">Simulated in the demo</Badge>}
      </div>
      {label && label !== 'connected_verified' && !demo && (
        <p className="text-sm text-ink-3">
          Automatic prompts stay off until this connection passes a real end-to-end test. Buyers see your Till/Paybill steps meanwhile.
        </p>
      )}

      <fieldset disabled={!allowed || save.isPending} className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-ink-3">How do you get paid by M-Pesa?</legend>
        {(['daraja', 'aggregator', 'manual'] as const).map((p) => (
          <label
            key={p}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors',
              draft.provider === p ? 'bg-brand-soft/60 ring-brand/40' : 'ring-line hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name={groupId}
              value={p}
              checked={draft.provider === p}
              onChange={() => setDraft({ provider: p, aggregator: p === 'aggregator' ? (draft.aggregator ?? aggregators[0]?.provider ?? null) : null })}
              className="mt-1 size-4 accent-[var(--ak-brand)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{PROVIDER_TEXT[p].name}</span>
              <span className="block text-xs text-ink-3">{PROVIDER_TEXT[p].who}</span>
            </span>
          </label>
        ))}
        {draft.provider === 'aggregator' && (
          <div className="ml-10 flex flex-col gap-1">
            <label htmlFor={`${groupId}-agg`} className="text-xs font-medium text-ink-3">
              Aggregator
            </label>
            <Select
              id={`${groupId}-agg`}
              value={draft.aggregator ?? ''}
              onChange={(e) => setDraft({ provider: 'aggregator', aggregator: e.target.value })}
              className="h-10 max-w-xs"
            >
              {aggregators.map((a) => (
                <option key={a.provider} value={a.provider}>
                  {a.name.replace(/ \(.*\)$/, '')} · {INTEGRATION_LABEL_TEXT[a.label]}
                </option>
              ))}
            </Select>
            <p className="max-w-md text-xs text-ink-3">
              Adapter only: no aggregator API is connected in this build, so buyers will see your manual steps until one is verified.
            </p>
          </div>
        )}
      </fieldset>
      {save.isError && <ErrorNotice error={save.error} />}
      {allowed ? (
        <div>
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>
            Save payment method
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-3">Only an owner or admin can change this.</p>
      )}
    </div>
  )
}

/* ───────────── Verify a receipt code ───────────── */

function VerifyCode() {
  const gateway = useGateway()
  const { org } = useOrg()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReceiptVerification | null>(null)
  const [error, setError] = useState<unknown>(null)
  const inputId = useId()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setResult(await gateway.verifyMpesaReceipt(org.id, code))
    } catch (err) {
      setResult(null)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1 sm:max-w-xs">
          <label htmlFor={inputId} className="text-xs font-medium text-ink-3">
            M-Pesa code from the SMS or screenshot
          </label>
          <Input
            id={inputId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SKL4Q8ZT2M"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="h-10 font-mono uppercase tracking-wide"
          />
        </div>
        <Button type="submit" size="md" loading={busy} disabled={!code.trim()} icon={<ScanSearch className="size-4" aria-hidden />}>
          Verify
        </Button>
      </form>
      {error != null && <ErrorNotice error={error} />}
      {result && <VerifyResult result={result} />}
    </div>
  )
}

function VerifyResult({ result }: { result: ReceiptVerification }) {
  const manual = result.state !== 'invalid_format' && result.alsoRecordedManuallyOn.length > 0 && (
    <p className="mt-1 text-xs">
      Also typed in by staff as a manual payment on order{result.alsoRecordedManuallyOn.length > 1 ? 's' : ''}{' '}
      {result.alsoRecordedManuallyOn.map((n) => `#${n}`).join(', ')}.
    </p>
  )
  if (result.state === 'invalid_format') {
    return <p className="text-sm text-warn">That doesn't look like an M-Pesa code. Codes are 10 letters and numbers, like SKL4Q8ZT2M.</p>
  }
  if (result.state === 'not_verifiable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn" role="status">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Not verifiable automatically</p>
          <p>
            Your shop is on manual M-Pesa, so Safaricom does not report payments to Rafu. Check the code in your own M-Pesa statement or the M-Pesa app
            before releasing goods. A forwarded SMS or screenshot is not proof.
          </p>
          {manual}
        </div>
      </div>
    )
  }
  if (result.state === 'not_found') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-neg-soft px-3 py-2.5 text-sm text-neg" role="status">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">No confirmation from M-Pesa with this code</p>
          <p>
            Safaricom has not reported this payment to your shop. It may be fake, sent to another business, or still on its way. Don't release goods
            until it shows up here or in your M-Pesa statement.
          </p>
          {manual}
        </div>
      </div>
    )
  }
  const r = result.receipt
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-pos-soft px-3 py-2.5 text-sm text-ink" role="status">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden />
      <div>
        <p className="font-semibold">Real payment, confirmed by M-Pesa</p>
        <p className="text-ink-2">
          <span className="font-mono">{r.code}</span> · <Money minor={r.amountMinor} currency={r.currency} className="font-semibold text-ink" /> ·{' '}
          <When iso={r.transactedAt} />
          {r.payerHint && <> · from {r.payerHint}</>}
        </p>
        <p className="text-ink-2">
          {r.orderNumber != null ? `On order #${r.orderNumber}` : 'Not attached to an order yet'} · {RECEIPT_STATUS_LABEL[r.status]}
        </p>
        {manual}
      </div>
    </div>
  )
}

/* ───────────── Queue + lists ───────────── */

const RECEIPT_TONE: Record<MpesaReceipt['status'], Tone> = {
  matched: 'pos',
  attached: 'pos',
  unmatched: 'warn',
  mismatch: 'warn',
  late: 'warn',
  dismissed: 'neutral',
}
const PROMPT_TONE: Record<MpesaPrompt['status'], Tone> = {
  pending: 'info',
  awaiting_receipt: 'info',
  paid: 'pos',
  cancelled: 'neutral',
  timeout: 'neutral',
  failed: 'neg',
  mismatch: 'warn',
  late: 'warn',
}

function balanceOf(o: OrderSummary): number {
  return o.totalMinor - o.netPaidMinor
}

function QueueItem({ r, orders }: { r: MpesaReceipt; orders: OrderSummary[] }) {
  const { can } = useOrg()
  const candidates = useMemo(
    () =>
      orders
        .filter((o) => o.currency === r.currency && !['draft', 'cancelled', 'refunded'].includes(o.status) && balanceOf(o) >= r.amountMinor)
        .sort((a, b) => Number(balanceOf(a) !== r.amountMinor) - Number(balanceOf(b) !== r.amountMinor) || b.number - a.number)
        .slice(0, 50),
    [orders, r],
  )
  const [orderId, setOrderId] = useState(() => (r.orderId && candidates.some((c) => c.id === r.orderId) ? r.orderId : (candidates[0]?.id ?? '')))
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')
  const attach = useAction((g, org, input: { id: string; orderId: string }) => g.attachMpesaReceipt(org, input.id, input.orderId))
  const dismiss = useAction((g, org, input: { id: string; reason: string }) => g.dismissMpesaReceipt(org, input.id, input.reason))
  const selectId = useId()
  const allowed = can('payments.record')

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            <Money minor={r.amountMinor} currency={r.currency} className="font-semibold text-ink" />
            <span className="break-all font-mono text-sm text-ink-2">{r.receipt}</span>
            <Badge tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS_LABEL[r.status]}</Badge>
            <Badge tone="neutral">{receiptProviderText(r)}</Badge>
            {r.simulated && <Badge tone="info">Simulated</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            <When iso={r.transactedAt} /> · {receiptSourceText(r.source)}
            {r.payerHint && <> · {r.source === 'bank_transfer' ? `from account ${r.payerHint}` : r.payerHint}</>}
            {r.accountRef && <> · {r.source === 'bank_transfer' ? `into ${r.accountRef}` : `account “${r.accountRef}”`}</>}
          </p>
          {r.reason && <p className="mt-1 text-sm text-ink-2">{r.reason}</p>}
          {r.orderNumber != null && r.status !== 'unmatched' && (
            <p className="mt-0.5 text-xs text-ink-3">
              Linked to{' '}
              <Link to={`/app/orders/${r.orderId}`} className="font-medium text-ink underline-offset-2 hover:underline">
                order #{r.orderNumber}
              </Link>
            </p>
          )}
        </div>
      </div>
      {allowed && !dismissing && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1 sm:max-w-sm">
            <label htmlFor={selectId} className="text-xs font-medium text-ink-3">
              Attach to order
            </label>
            <Select id={selectId} value={orderId} onChange={(e) => setOrderId(e.target.value)} className="h-10" disabled={candidates.length === 0}>
              {candidates.length === 0 && <option value="">No open order with enough balance</option>}
              {candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.number} · {o.customerName ?? 'Walk-in'} · due {(balanceOf(o) / 100).toLocaleString()} {o.currency}
                  {balanceOf(o) === r.amountMinor ? ' · exact' : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button size="md" variant="primary" disabled={!orderId} loading={attach.isPending} onClick={() => attach.mutate({ id: r.id, orderId })}>
            Attach
          </Button>
          <Button size="md" variant="ghost" onClick={() => setDismissing(true)}>
            Not for an order
          </Button>
        </div>
      )}
      {allowed && dismissing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            dismiss.mutate({ id: r.id, reason })
          }}
        >
          <Input
            aria-label="Why is this payment not for an order?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Personal transfer, refunded to customer"
            className="h-10 min-w-[220px] flex-1 sm:max-w-sm"
            maxLength={300}
          />
          <Button type="submit" size="md" disabled={!reason.trim()} loading={dismiss.isPending}>
            Dismiss
          </Button>
          <Button size="md" variant="ghost" onClick={() => setDismissing(false)}>
            Back
          </Button>
        </form>
      )}
      {attach.isError && <ErrorNotice error={attach.error} />}
      {dismiss.isError && <ErrorNotice error={dismiss.error} />}
    </li>
  )
}

function ReceiptRow({ r }: { r: MpesaReceipt }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {r.orderId ? (
            <Link to={`/app/orders/${r.orderId}`} className="tnum font-medium text-ink hover:underline">
              {r.orderNumber != null ? `#${r.orderNumber}` : 'Order'}
            </Link>
          ) : (
            <span className="text-ink-3">No order</span>
          )}
          <span className="break-all font-mono text-xs text-ink-2">{r.receipt}</span>
          <Badge tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS_LABEL[r.status]}</Badge>
          {r.source === 'bank_transfer' && <Badge tone="neutral">{receiptProviderText(r)}</Badge>}
          {r.simulated && <Badge tone="info">Simulated</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          <When iso={r.transactedAt} />
          {r.status === 'dismissed' && r.reason && <> · {r.reason}</>}
        </p>
      </div>
      <Money minor={r.amountMinor} currency={r.currency} className="shrink-0 text-sm font-medium text-ink" />
    </li>
  )
}

function PromptRow({ p }: { p: MpesaPrompt }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={`/app/orders/${p.orderId}`} className="tnum font-medium text-ink hover:underline">
            {p.orderNumber != null ? `#${p.orderNumber}` : 'Order'}
          </Link>
          <Badge tone={PROMPT_TONE[p.status]}>{PROMPT_STATUS_LABEL[p.status]}</Badge>
          {p.simulated && <Badge tone="info">Simulated</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          <When iso={p.createdAt} />
          {p.phoneHint && <> · phone ···{p.phoneHint}</>}
          {p.receipt && <> · {p.receipt}</>}
          {p.status === 'failed' && p.resultDesc && <> · {p.resultDesc}</>}
        </p>
      </div>
      <Money minor={p.amountMinor} currency="KES" className="shrink-0 text-sm font-medium text-ink" />
    </li>
  )
}

/** STK query said "paid" but no receipt yet: nothing recorded, nothing for staff to attach. */
function AwaitingReceiptRow({ p }: { p: MpesaPrompt }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink">{PROMPT_STATUS_LABEL.awaiting_receipt}</span>
            <Link to={`/app/orders/${p.orderId}`} className="tnum font-medium text-ink-2 hover:underline">
              {p.orderNumber != null ? `#${p.orderNumber}` : 'Order'}
            </Link>
            {p.simulated && <Badge tone="info">Simulated</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            Prompt sent <When iso={p.createdAt} />
            {p.phoneHint && <> · phone ···{p.phoneHint}</>} · not counted as paid until the M-Pesa receipt arrives. Don't release goods yet.
          </p>
        </div>
      </div>
      <Money minor={p.amountMinor} currency="KES" className="shrink-0 text-sm font-medium text-ink-2" />
    </li>
  )
}

/** Subtle "live" marker while prompts are pending and the page is polling. */
function LiveIndicator({ live }: { live: boolean }) {
  if (!live) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2" role="status">
      <span className="relative inline-flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full rounded-full bg-pos opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-pos" />
      </span>
      Live · checking for M-Pesa updates
    </span>
  )
}

function SimulateIncoming() {
  const [amount, setAmount] = useState('1500')
  const [ref, setRef] = useState('')
  const sim = useAction((g, org, input: { amountMinor: number; accountRef: string | null }) => g.simulateIncomingMpesa!(org, input))
  const amountMinor = Math.round(Number(amount) * 100)
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl bg-info-soft p-3"
      onSubmit={(e) => {
        e.preventDefault()
        sim.mutate({ amountMinor, accountRef: ref.trim() || null })
      }}
    >
      <p className="w-full text-xs font-medium text-info">Demo: pretend a customer paid your Till/Paybill directly (simulated, nothing is charged)</p>
      <Input aria-label="Amount in KES" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 w-28 tnum" />
      <Input aria-label="Account reference (order number), optional" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Account ref, e.g. 1003" className="h-10 w-48" />
      <Button type="submit" size="md" loading={sim.isPending} disabled={!(amountMinor > 0)}>
        Simulate payment
      </Button>
      {sim.isError && <ErrorNotice error={sim.error} />}
    </form>
  )
}

/* ───────────── Section ───────────── */

type View = 'review' | 'matched' | 'prompts' | 'resolved'

export function MpesaReconciliation() {
  const gateway = useGateway()
  const settings = useOrgQuery('mpesa-settings', (g, o) => g.getCollectionsSettings(o))
  const receipts = useOrgQuery('mpesa-receipts', (g, o) => g.listMpesaReceipts(o))
  const prompts = useOrgQuery('mpesa-prompts', (g, o) => g.listMpesaPrompts(o))
  const integrations = useIntegrations()
  const orders = useOrders()
  const { org } = useOrg()
  const [view, setView] = useState<View>('review')
  const demo = gateway.mode === 'demo'
  const ngn = org.baseCurrency === 'NGN'

  const all = receipts.data ?? []
  const queue = all.filter((r) => isReviewable(r.status))
  const matched = all.filter((r) => r.status === 'matched' || r.status === 'attached')
  const dismissed = all.filter((r) => r.status === 'dismissed')
  const promptRows = prompts.data ?? []
  const pending = promptRows.filter((p) => p.status === 'pending').length
  const awaiting = promptRows.filter((p) => p.status === 'awaiting_receipt')
  const failed = promptRows.filter((p) => ['failed', 'cancelled', 'timeout'].includes(p.status)).length

  // Poll while any prompt is unresolved: 5 s, backing off to 30 s, paused while the tab is hidden.
  const live = usePendingPoll(
    pending + awaiting.length > 0,
    () => {
      void prompts.refetch()
      void receipts.refetch()
    },
    `${pending}:${awaiting.length}:${all.length}`,
  )

  return (
    <>
      {/* M-Pesa route and code checks are Kenya-only; NGN shops get bank-transfer accounts below. */}
      {!ngn && (
        <>
      <Section title="How you get paid" description="Which M-Pesa route your shop uses, and whether it is really connected." icon={<Radio className="size-4" aria-hidden />}>
        {settings.isPending || integrations.isPending ? (
          <Skeleton className="h-24 w-full max-w-xl" />
        ) : settings.isError ? (
          <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <ProviderPanel key={`${settings.data.provider}:${settings.data.aggregator}`} settings={settings.data} integrations={integrations.data ?? []} demo={demo} />
        )}
      </Section>

      <Section
        title="Verify an M-Pesa code"
        description="Customer sent an SMS or screenshot? Check the code against what M-Pesa actually reported."
        icon={<ShieldCheck className="size-4" aria-hidden />}
      >
        <VerifyCode />
      </Section>
        </>
      )}

      {ngn && <BankTransferAccounts />}

      <Section
        title={ngn ? 'Payment reconciliation' : 'M-Pesa reconciliation'}
        description={
          ngn
            ? 'Payments are marked paid only from verified provider confirmations (M-Pesa or bank transfer). Anything that does not match exactly waits here for you.'
            : "Payments are marked paid only from verified M-Pesa confirmations. Anything that doesn't match exactly waits here for you."
        }
        icon={<Smartphone className="size-4" aria-hidden />}
      >
        {receipts.isPending || prompts.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full max-w-lg" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : receipts.isError || prompts.isError ? (
          <ErrorNotice
            error={receipts.error ?? prompts.error}
            onRetry={() => {
              void receipts.refetch()
              void prompts.refetch()
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-pos" aria-hidden />
                <dt className="text-ink-2">Matched</dt>
                <dd className="tnum font-semibold text-ink">{matched.length}</dd>
              </div>
              <div className="flex items-center gap-2">
                <CircleAlert className={cn('size-4', queue.length ? 'text-warn' : 'text-ink-3')} aria-hidden />
                <dt className="text-ink-2">Needs you</dt>
                <dd className="tnum font-semibold text-ink">{queue.length}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-ink-2">Prompts waiting</dt>
                <dd className="tnum font-semibold text-ink">{pending}</dd>
              </div>
              {awaiting.length > 0 && (
                <div className="flex items-center gap-2">
                  <dt className="text-ink-2">Waiting for receipt</dt>
                  <dd className="tnum font-semibold text-ink">{awaiting.length}</dd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <dt className="text-ink-2">Prompts not paid</dt>
                <dd className="tnum font-semibold text-ink">{failed}</dd>
              </div>
            </dl>
            <LiveIndicator live={live} />

            {demo && !ngn && gateway.simulateIncomingMpesa && <SimulateIncoming />}

            <PillTabs<View>
              label="Reconciliation views"
              value={view}
              onChange={setView}
              tabs={[
                { id: 'review', label: 'Needs you', count: queue.length + awaiting.length },
                { id: 'matched', label: 'Matched', count: matched.length },
                { id: 'prompts', label: 'Prompts', count: promptRows.length },
                { id: 'resolved', label: 'Dismissed', count: dismissed.length },
              ]}
            />

            {view === 'review' && awaiting.length > 0 && (
              <ul className="divide-y divide-line rounded-xl bg-info-soft/50 px-3" aria-label="M-Pesa says paid, waiting for receipt">
                {awaiting.map((p) => (
                  <AwaitingReceiptRow key={p.checkoutRequestId} p={p} />
                ))}
              </ul>
            )}
            {view === 'review' &&
              (queue.length === 0 ? (
                awaiting.length > 0 ? null : <EmptyState
                  title="Nothing to sort out"
                  body="Payments that arrive without a matching order, with a different amount, or after an order was cancelled will wait here."
                />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {queue.map((r) => (
                    <QueueItem key={r.id} r={r} orders={orders.data ?? []} />
                  ))}
                </ul>
              ))}
            {view === 'matched' &&
              (matched.length === 0 ? (
                <EmptyState title="No verified M-Pesa payments yet" body="When a customer pays by prompt or by Till/Paybill and it matches an order, it shows here." />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {matched.map((r) => (
                    <ReceiptRow key={r.id} r={r} />
                  ))}
                </ul>
              ))}
            {view === 'prompts' &&
              (promptRows.length === 0 ? (
                <EmptyState title="No prompts sent yet" body="Prompts appear here when a buyer asks for an M-Pesa prompt on their order page." />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {promptRows.map((p) => (
                    <PromptRow key={p.checkoutRequestId} p={p} />
                  ))}
                </ul>
              ))}
            {view === 'resolved' &&
              (dismissed.length === 0 ? (
                <EmptyState title="Nothing dismissed" />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {dismissed.map((r) => (
                    <ReceiptRow key={r.id} r={r} />
                  ))}
                </ul>
              ))}
          </div>
        )}
      </Section>
    </>
  )
}
