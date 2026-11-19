/* eslint-disable react-refresh/only-export-components -- shared UI module exports small helpers next to components */
import { Camera, Footprints, Globe, MessageCircle, MoreHorizontal, Music2, Phone as PhoneIcon, Store, ThumbsUp, Truck, User } from 'lucide-react'
import { formatMoney, money } from '@/domain/money'
import { formatDateTime, formatPhone } from '@/domain/locale'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/orders'
import type { OrderPaymentState, PaymentVerification } from '@/domain/payments'
import { CHANNEL_LABEL, type FulfilmentMethod, type OrderChannel } from '@/gateway/types'
import { useOrg } from '../context'
import { formatRelative, useNow } from '../live/clock'
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

/** Relative time ("5 min ago") that refreshes itself; the exact time is in the tooltip. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const { org } = useOrg()
  const now = useNow()
  return (
    <time dateTime={iso} className={cn('tnum whitespace-nowrap', className)} title={formatDateTime(iso, org.locale, org.timezone, true)}>
      {formatRelative(iso, now, org.locale)}
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

export function orderStatusTone(status: OrderStatus): Tone {
  return STATUS_TONE[status]
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot className={className}>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ───────────── Channel & fulfilment ───────────── */

const CHANNEL_STYLE: Record<OrderChannel, { icon: typeof Store; className: string }> = {
  whatsapp: { icon: MessageCircle, className: 'bg-[#25D366]/15 text-[#0B7A3E] dark:text-[#4ade80]' },
  instagram: { icon: Camera, className: 'bg-brand-soft text-brand-strong dark:text-brand' },
  facebook: { icon: ThumbsUp, className: 'bg-info-soft text-info' },
  tiktok: { icon: Music2, className: 'bg-sunken text-ink' },
  storefront: { icon: Globe, className: 'bg-mango-soft text-warn' },
  direct: { icon: User, className: 'bg-sunken text-ink-2' },
  phone: { icon: PhoneIcon, className: 'bg-sunken text-ink-2' },
  walk_in: { icon: Footprints, className: 'bg-sunken text-ink-2' },
  other: { icon: MoreHorizontal, className: 'bg-sunken text-ink-2' },
}

/** Where the order came from, as an icon chip with its name. */
export function ChannelBadge({ channel, iconOnly, className }: { channel: OrderChannel; iconOnly?: boolean; className?: string }) {
  const s = CHANNEL_STYLE[channel]
  const Icon = s.icon
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1 rounded-full text-xs font-semibold whitespace-nowrap', iconOnly ? 'w-6 justify-center' : 'px-2.5', s.className, className)}
      title={CHANNEL_LABEL[channel]}
    >
      <Icon className="size-3.5" aria-hidden />
      {iconOnly ? <span className="sr-only">{CHANNEL_LABEL[channel]}</span> : CHANNEL_LABEL[channel]}
    </span>
  )
}

export function FulfilmentBadge({ method, className }: { method: FulfilmentMethod; className?: string }) {
  const Icon = method === 'delivery' ? Truck : Store
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2.5 text-xs font-semibold whitespace-nowrap text-ink-2', className)}>
      <Icon className="size-3.5" aria-hidden />
      {method === 'delivery' ? 'Delivery' : 'Pickup'}
    </span>
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
