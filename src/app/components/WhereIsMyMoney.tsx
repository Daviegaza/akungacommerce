import { Link } from 'react-router-dom'
import { ArrowRight, Landmark, ShieldCheck, Wallet } from 'lucide-react'
import {
  HOLD_REASON_TEXT,
  moneyFlowFor,
  PAYOUT_RULES,
  SETTLEMENT_STATE_TEXT,
  SETTLEMENT_STATES,
  totalsByState,
  type MoneyFlow,
} from '@/domain/payouts'
import { INTEGRATION_LABEL_TEXT } from '@/integrations/registry'
import { useIntegrations, useOrgQuery } from '../context'
import { ErrorNotice, Section } from '../ui/layout'
import { Money } from '../ui/format'
import { Badge, Skeleton } from '../ui/primitives'

/**
 * "Where's my money": plain answer to where each M-Pesa payment goes and when.
 * Direct (own Till/Paybill): Rafu never holds it. Aggregator: settlement states,
 * honestly labelled as not connected in this build.
 */
export function WhereIsMyMoney() {
  const settings = useOrgQuery('mpesa-settings', (g, o) => g.getCollectionsSettings(o))
  const shop = useOrgQuery('shop', (g, o) => g.getShopSettings(o))
  const integrations = useIntegrations()

  const loading = settings.isPending || shop.isPending || integrations.isPending
  const error = settings.error ?? shop.error ?? integrations.error

  let flow: MoneyFlow | null = null
  let aggregatorLabel: string | null = null
  if (settings.data && integrations.data) {
    const agg = settings.data.aggregator ? integrations.data.find((i) => i.provider === settings.data.aggregator) : undefined
    aggregatorLabel = agg ? INTEGRATION_LABEL_TEXT[agg.label] : null
    flow = moneyFlowFor({
      provider: settings.data.provider,
      aggregator: settings.data.aggregator,
      aggregatorConnected: agg?.label === 'connected_verified',
      mpesaTill: shop.data?.mpesaTill ?? null,
      mpesaPaybill: shop.data?.mpesaPaybill ?? null,
      registeredName: shop.data?.registeredName ?? null,
      // No aggregator settlement feed exists in this build.
      settlements: [],
    })
  }

  return (
    <Section title="Where’s my money?" description="Where M-Pesa payments go, and when they reach you." icon={<Wallet className="size-4" aria-hidden />} variant="card">
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-full max-w-md" />
          <Skeleton className="h-6 w-full max-w-sm" />
        </div>
      ) : error ? (
        <ErrorNotice
          error={error}
          onRetry={() => {
            void settings.refetch()
            void shop.refetch()
            void integrations.refetch()
          }}
        />
      ) : flow ? (
        <div className="flex flex-col gap-4 text-sm">
          {flow.kind === 'direct' ? <DirectFlow flow={flow} /> : <AggregatorFlow flow={flow} label={aggregatorLabel} />}
          <details className="group rounded-xl ring-1 ring-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              The rules, in plain words
              <ArrowRight className="size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <ul className="flex list-disc flex-col gap-1.5 px-3 pb-3 pl-7 text-ink-2">
              {PAYOUT_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </Section>
  )
}

function DirectFlow({ flow }: { flow: Extract<MoneyFlow, { kind: 'direct' }> }) {
  return (
    <>
      <div className="flex items-start gap-3 rounded-2xl bg-pos-soft px-4 py-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-ink">Rafu never holds your money.</p>
          <p className="mt-0.5 text-ink-2">
            {flow.destination ? (
              <>
                Buyers pay your own M-Pesa {flow.destination.type === 'till' ? 'Till' : 'Paybill'}{' '}
                <span className="font-semibold text-ink tnum">{flow.destination.number}</span>
                {flow.registeredName ? ` (${flow.registeredName})` : ''}. Each payment is in your M-Pesa account as soon as the buyer pays. There is nothing to wait
                for and nothing to settle.
              </>
            ) : (
              <>Buyers pay your own M-Pesa Till or Paybill, straight to you. Add the number in My shop so buyers know where to pay.</>
            )}
          </p>
        </div>
      </div>
      {!flow.destination && (
        <Link to="/app/shop" className="self-start text-[13px] font-semibold text-ink underline underline-offset-2">
          Add your Till or Paybill
        </Link>
      )}
      <p className="text-ink-3">
        {flow.provider === 'daraja'
          ? 'Rafu only listens for M-Pesa’s confirmation so it can mark orders paid. To see your balance, use the M-Pesa app or your Safaricom statement.'
          : 'You confirm each payment yourself from your M-Pesa messages. Rafu cannot see your M-Pesa balance.'}
      </p>
    </>
  )
}

function AggregatorFlow({ flow, label }: { flow: Extract<MoneyFlow, { kind: 'aggregator' }>; label: string | null }) {
  const totals = totalsByState(flow.settlements)
  return (
    <>
      <div className="flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3">
        <Landmark className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-ink">The aggregator{flow.aggregator ? ` (${flow.aggregator})` : ''} holds payments until it pays you out.</p>
          <p className="mt-0.5 text-ink-2">Rafu itself never holds your money. The aggregator’s payout timing and fees apply.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-3">Payout tracking:</span>
        <Badge>{flow.connected ? 'Connected' : (label ?? 'Adapter only')}</Badge>
      </div>
      {!flow.connected ? (
        <p className="text-ink-2">
          This aggregator is not connected, so Rafu has no payout information to show. Until it is, check payouts in the aggregator’s own dashboard. When connected,
          each payout will show here as one of:
        </p>
      ) : totals.length === 0 ? (
        <p className="text-ink-2">No payouts yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {totals.map((t) => (
            <li key={`${t.state}-${t.currency}`} className="flex items-baseline justify-between gap-3 py-2">
              <span>{SETTLEMENT_STATE_TEXT[t.state].label}</span>
              <Money minor={t.totalMinor} currency={t.currency} className="font-semibold" />
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-2 sm:grid-cols-3">
        {SETTLEMENT_STATES.map((s) => (
          <div key={s} className="rounded-xl bg-sunken px-3 py-2.5">
            <dt className="text-[13px] font-semibold text-ink">{SETTLEMENT_STATE_TEXT[s].label}</dt>
            <dd className="mt-0.5 text-xs text-ink-2">{SETTLEMENT_STATE_TEXT[s].meaning}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-xl ring-1 ring-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
          Reasons money can be held
        </summary>
        <ul className="flex flex-col gap-2 px-3 pb-3">
          {Object.values(HOLD_REASON_TEXT).map((h) => (
            <li key={h.label}>
              <p className="font-medium text-ink">{h.label}</p>
              <p className="text-xs text-ink-3">{h.action}</p>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
