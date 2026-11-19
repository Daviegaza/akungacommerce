/* eslint-disable react-refresh/only-export-components -- shared UI module exports small helpers next to components */
import { formatMoney, money } from '@/domain/money'
import { formatDateTime, formatPhone } from '@/domain/locale'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/orders'
import type { OrderPaymentState, PaymentVerification } from '@/domain/payments'
import { useOrg } from '../context'
import { Badge, type Tone } from './primitives'
import { cn } from '@/lib/utils'

/** Money in the business locale. Always shows its own currency; never converts. */
export function Money({ minor, currency, className, signed }: { minor: number; currency: string; className?: string; signed?: boolean }) {
  const { org } = useOrg()
  const text = formatMoney(money(minor, currency), org.locale)
  return <span className={cn('tnum whitespace-nowrap', className)}>{signed && minor > 0 ? `+${text}` : text}</span>
}

export function useFormatMoney() {
  const { org } = useOrg()
  return (minor: number, currency: string) => formatMoney(money(minor, currency), org.locale)
}

export function When({ iso, dateOnly, className }: { iso: string; dateOnly?: boolean; className?: string }) {
  const { org } = useOrg()
  return (
    <time dateTime={iso} className={cn('tnum whitespace-nowrap', className)} title={`${iso} (UTC)`}>
      {formatDateTime(iso, org.locale, org.timezone, !dateOnly)}
    </time>
  )
}

export function Phone({ e164 }: { e164: string | null }) {
  if (!e164) return <span className="text-ink-3">—</span>
  return (
    <a href={`tel:${e164}`} className="tnum whitespace-nowrap hover:underline">
      {formatPhone(e164)}
    </a>
  )
}

const STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'neutral',
  pending_confirmation: 'warn',
  confirmed: 'info',
  preparing: 'info',
  ready: 'accent',
  dispatched: 'accent',
  delivered: 'pos',
  cancelled: 'neutral',
  refunded: 'neg',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  )
}

const PAYMENT_STATE: Record<OrderPaymentState, { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'warn' },
  partially_paid: { label: 'Part paid', tone: 'warn' },
  paid: { label: 'Paid', tone: 'pos' },
  overpaid: { label: 'Overpaid', tone: 'info' },
  partially_refunded: { label: 'Part refunded', tone: 'neg' },
  refunded: { label: 'Refunded', tone: 'neg' },
}

export function PaymentStateBadge({ state }: { state: OrderPaymentState }) {
  const s = PAYMENT_STATE[state]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Honest verification marker: a typed-in payment is never shown as confirmed. */
export function VerificationBadge({ verification }: { verification: PaymentVerification }) {
  return verification === 'provider_verified' ? (
    <Badge tone="pos">Provider verified</Badge>
  ) : (
    <Badge tone="warn" className="whitespace-nowrap">
      Manual · unverified
    </Badge>
  )
}

/** Derive payment state for a summary row without loading every payment. */
export function paymentStateOf(totalMinor: number, netPaidMinor: number, hasRefunds = false): OrderPaymentState {
  if (hasRefunds && netPaidMinor <= 0) return 'refunded'
  if (netPaidMinor <= 0) return 'unpaid'
  if (netPaidMinor < totalMinor) return 'partially_paid'
  if (netPaidMinor === totalMinor) return 'paid'
  return 'overpaid'
}
