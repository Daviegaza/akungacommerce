import { useState, type ReactNode } from 'react'
import { Check, Copy, Info, Landmark } from 'lucide-react'
import { Badge } from '@/app/ui/primitives'
import { money as moneyOf, toMajorString } from '@/domain/money'
import type { TrackedOrder } from '@/gateway/storefront'

/**
 * NGN bank-transfer payment card on the tracking page. Shows a dedicated account only
 * when the server stored one (provider-assigned; simulated in the demo); otherwise it
 * says the shop will share details. Never invents an account number.
 */
export function BankTransferPanel({ order, money }: { order: TrackedOrder; money(minor: number): string }) {
  const bt = order.bankTransfer
  const [copied, setCopied] = useState<string | null>(null)
  if (!bt) return null
  const due = bt.dueNowMinor > 0 ? bt.dueNowMinor : order.totalMinor - order.paidMinor
  const reference = String(bt.reference || order.number)

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600)
    } catch {
      setCopied(null)
    }
  }

  let major = String(due)
  try {
    major = toMajorString(moneyOf(due, order.currency))
  } catch {
    // keep the minor-unit fallback
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-brand/25 bg-panel p-4 shadow-[var(--shadow-card)] sm:p-5 ak-rise" aria-label="Pay by bank transfer">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-2">Transfer exactly</p>
          <p className="font-display text-4xl font-semibold leading-tight tracking-tight tnum">{money(due)}</p>
          {order.paidMinor > 0 && <p className="text-xs text-ink-3 tnum">{money(order.paidMinor)} of {money(order.totalMinor)} received</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone="warn">Not paid yet</Badge>
          {bt.simulated && <Badge tone="info">Demo · simulated</Badge>}
        </div>
      </div>

      {bt.account ? (
        <div className="mt-4 flex flex-col gap-3">
          <dl className="flex flex-col gap-2 rounded-xl bg-sunken p-3 text-sm">
            <Row label="Bank" value={bt.account.bankName} />
            <Row
              label="Account number"
              value={bt.account.accountNumber}
              mono
              action={<CopyBtn id="acct" text={bt.account.accountNumber} copied={copied} onCopy={copy} label="Copy account number" />}
            />
            {bt.account.accountName && <Row label="Account name" value={bt.account.accountName} />}
            <Row label="Amount" value={money(due)} action={<CopyBtn id="amt" text={major} copied={copied} onCopy={copy} label="Copy amount" />} />
            <Row
              label="Reference / narration"
              value={reference}
              mono
              action={<CopyBtn id="ref" text={reference} copied={copied} onCopy={copy} label="Copy reference" />}
            />
          </dl>
          <p className="flex items-start gap-2 text-xs text-ink-3">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              This account number is for this order only. Send the exact amount in one transfer and put {reference} in the narration. This page shows
              "Paid" once the transfer is confirmed{bt.simulated ? ' (in the demo nothing can be paid into it)' : ''}.
            </span>
          </p>
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-sunken p-3 text-sm text-ink-2">
          <Landmark className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span>
            {order.shop.name} will share the bank account details with you. When you transfer, send exactly {money(due)} and put order number{' '}
            <strong className="font-semibold text-ink tnum">{reference}</strong> in the narration.
          </span>
        </p>
      )}
    </section>
  )
}

function Row({ label, value, mono, action }: { label: string; value: string; mono?: boolean; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-xs text-ink-3">{label}</dt>
        <dd className={mono ? 'font-display text-base font-bold tracking-wide tnum text-ink' : 'font-medium text-ink'}>{value}</dd>
      </div>
      {action}
    </div>
  )
}

function CopyBtn({
  id,
  text,
  copied,
  onCopy,
  label,
}: {
  id: string
  text: string
  copied: string | null
  onCopy(id: string, text: string): void
  label: string
}) {
  const done = copied === id
  return (
    <button
      type="button"
      onClick={() => onCopy(id, text)}
      aria-label={done ? 'Copied' : label}
      className="grid size-11 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-panel hover:text-ink"
    >
      {done ? <Check className="size-4 text-pos" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}
