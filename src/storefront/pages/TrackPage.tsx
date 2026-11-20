import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { CountryCode } from 'libphonenumber-js/min'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Bike,
  Check,
  CheckCircle2,
  Copy,
  Info,
  Link2,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  XCircle,
} from 'lucide-react'
import { Badge, Button, Field, Input, Skeleton, Textarea, buttonClass } from '@/app/ui/primitives'
import { cn } from '@/lib/utils'
import { formatDateTime, toE164 } from '@/domain/locale'
import { money as moneyOf, toMajorString } from '@/domain/money'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/orders'
import type { SimulatedOutcome, TrackedOrder } from '@/gateway/storefront'
import { buyerPromptMessage } from '@/domain/reconciliation'
import { RESEND_AFTER_SECONDS, WAIT_SECONDS, useMpesaPrompt, type PromptPhase } from '@/storefront/components/useMpesaPrompt'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import { getStorefrontGateway } from '@/storefront/gateway'
import { safeLocalStorage } from '@/storefront/cart'
import { useNow } from '@/storefront/components/hooks'
import { WhatsAppGlyph } from '@/storefront/components/WhatsAppGlyph'
import { TrackTrust } from '@/storefront/components/TrackTrust'
import { fmtMoney, isNotFoundError } from '@/storefront/components/storefront-utils'
import { DeliveryUpdates, DepositPaidNotice, LocationPreview } from '@/storefront/components/TrackDelivery'
import { BankTransferPanel } from '@/storefront/components/TrackPayments'
import { attachPaymentEvents, paymentSourceText } from '@/storefront/components/track-payments'

/** /t/:token is standalone (outside StorefrontApp), so it owns its query client. */
const trackQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

const REFRESH_MS = 20_000
const TERMINAL = new Set(['delivered', 'cancelled', 'refunded'])
const EASE = [0.2, 0.8, 0.2, 1] as const

export default function TrackPage() {
  return (
    <QueryClientProvider client={trackQueryClient}>
      <div className="ak-root min-h-dvh">
        <TrackScreen />
      </div>
    </QueryClientProvider>
  )
}

/* ───────────── Helpers ───────────── */
function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) return err.message
  return 'Something went wrong. Please try again.'
}

function statusLabel(status: string, method: 'pickup' | 'delivery', returned = false): string {
  if (status === 'cancelled' && returned) return 'Returned to the shop'
  if (status === 'pending_confirmation' || status === 'draft') return 'Order placed'
  if (method === 'delivery' && status === 'dispatched') return 'Out for delivery'
  if (method === 'pickup' && status === 'ready') return 'Ready for pickup'
  if (method === 'pickup' && status === 'delivered') return 'Collected'
  return status in ORDER_STATUS_LABEL ? ORDER_STATUS_LABEL[status as OrderStatus] : status.replace(/_/g, ' ')
}

function regionOf(locale: string): CountryCode | undefined {
  try {
    return (new Intl.Locale(locale).region as CountryCode | undefined) ?? undefined
  } catch {
    return undefined
  }
}

function savedPhone(): string {
  try {
    const raw = safeLocalStorage.getItem('rafu-buyer')
    if (typeof raw !== 'string') return ''
    const v = JSON.parse(raw) as { phone?: unknown }
    return typeof v.phone === 'string' ? v.phone : ''
  } catch {
    return ''
  }
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000)
    } catch {
      setCopied(null)
    }
  }
  return { copied, copy }
}

/* ───────────── Screen ───────────── */
function TrackScreen() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'

  const query = useQuery({
    queryKey: ['track', token],
    queryFn: async () => (await getStorefrontGateway()).track(token),
    enabled: Boolean(token),
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : REFRESH_MS),
    refetchIntervalInBackground: false,
  })

  if (query.isPending) return <TrackSkeleton />

  if (query.isError) {
    const notFound = isNotFoundError(query.error)
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
        <AlertCircle className="size-8 text-neg" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{notFound ? 'We could not find this order' : 'Order status is unavailable'}</h1>
        <p className="text-sm text-ink-2">
          {notFound ? 'Check that you opened the full link the shop sent you.' : errorMessage(query.error)}
        </p>
        {!notFound && (
          <Button variant="secondary" onClick={() => void query.refetch()} icon={<RefreshCw className="size-4" aria-hidden />}>
            Try again
          </Button>
        )}
      </main>
    )
  }

  return (
    <OrderView
      token={token}
      order={query.data}
      isNew={isNew}
      updatedAt={query.dataUpdatedAt}
      fetching={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  )
}

function TrackSkeleton() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Loading your order">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-6 w-40" />
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </main>
  )
}

/** Open section: a hairline and space, never a boxed card. */
function Section({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('border-t border-line pt-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Neutral monogram for the merchant; the shop leads this page, not the platform. */
function ShopMark({ name }: { name: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || '·'
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-sunken text-sm font-semibold text-ink">
      {initials}
    </span>
  )
}

/** Big, plain current status plus a step bar, driven only by the order's status. */
function StatusSummary({ order }: { order: TrackedOrder }) {
  const method = order.fulfilment.method
  const status = order.status === 'draft' ? 'pending_confirmation' : order.status
  const flow = FLOW[method]
  const idx = flow.indexOf(status)
  const stopped = idx === -1
  const finished = status === 'delivered'
  const label = statusLabel(status, method, Boolean(order.delivery?.returnedAt))
  const hint = CURRENT_HINT[status]
  const next = !stopped && idx < flow.length - 1 ? statusLabel(flow[idx + 1], method) : null
  return (
    <div className="border-t border-line pt-5">
      <p className="text-[13px] text-ink-3">Status</p>
      <p
        className={cn(
          'mt-1 flex items-center gap-2 text-[28px] font-semibold leading-tight tracking-tight',
          stopped ? 'text-neg' : 'text-ink',
        )}
      >
        {finished && <CheckCircle2 className="size-7 shrink-0 text-pos" aria-hidden />}
        {stopped && <XCircle className="size-7 shrink-0" aria-hidden />}
        <span className="min-w-0 break-words">{label}</span>
      </p>
      {hint && <p className="mt-1 text-[15px] text-ink-2">{hint}</p>}
      {!stopped && (
        <div className="mt-4">
          <div className="flex gap-1" role="img" aria-label={`Step ${idx + 1} of ${flow.length}: ${label}`}>
            {flow.map((k, i) => (
              <span key={k} className={cn('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-primary' : 'bg-line-strong')} />
            ))}
          </div>
          <p className="mt-2 flex justify-between gap-3 text-xs text-ink-3 tnum" aria-hidden>
            <span>
              Step {idx + 1} of {flow.length}
            </span>
            {next && <span className="min-w-0 truncate">Next: {next}</span>}
          </p>
        </div>
      )}
    </div>
  )
}

function OrderView({
  token,
  order,
  isNew,
  updatedAt,
  fetching,
  onRefresh,
}: {
  token: string
  order: TrackedOrder
  isNew: boolean
  updatedAt: number
  fetching: boolean
  onRefresh(): void
}) {
  const { shop, fulfilment } = order
  const locale = shop.locale || 'en'
  const money = (minor: number) => fmtMoney(minor, order.currency, locale)
  const terminal = TERMINAL.has(order.status)
  const cancelled = order.status === 'cancelled' || order.status === 'refunded'
  const paid = order.paidMinor >= order.totalMinor
  const delivery = order.delivery
  // Deposit in, balance due on delivery or collection: nothing more to pay right now.
  const depositCovered = Boolean(delivery && delivery.depositDueMinor > 0 && delivery.depositPaidMinor >= delivery.depositDueMinor && !paid)
  const { copied, copy } = useCopy()

  const shopLoc =
    shop.locationLat != null && shop.locationLng != null ? { lat: shop.locationLat, lng: shop.locationLng } : null
  const dropLoc =
    fulfilment.method === 'delivery' && fulfilment.dropLat != null && fulfilment.dropLng != null
      ? { lat: fulfilment.dropLat, lng: fulfilment.dropLng }
      : null

  let waLink: string | null = null
  if (shop.whatsappE164) {
    try {
      waLink = whatsappChatLink(shop.whatsappE164, `Hi ${shop.name}, I'm asking about my order #${order.number}.`)
    } catch {
      waLink = null
    }
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-7 overflow-x-clip px-4 pb-16 pt-3 sm:px-6">
      <nav className="-mb-3 flex items-center justify-between gap-2">
        {shop.slug ? (
          <Link to={`/s/${shop.slug}`} className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-2 hover:bg-sunken hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Back to shop
          </Link>
        ) : (
          <span aria-hidden />
        )}
        {!terminal && <UpdatedLabel updatedAt={updatedAt} fetching={fetching} onRefresh={onRefresh} />}
      </nav>

      <header className="flex flex-col gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <ShopMark name={shop.name} />
          <p className="min-w-0 truncate text-[15px] font-semibold text-ink">{shop.name}</p>
        </div>
        {isNew ? (
          <PlacedHeader order={order} money={money} />
        ) : (
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              Order <span className="tnum">#{order.number}</span>
            </h1>
            <p className="mt-0.5 text-[13px] text-ink-3 tnum">Placed {formatDateTime(order.createdAt, locale, shop.timezone)}</p>
          </div>
        )}
        <StatusSummary order={order} />
      </header>

      {!cancelled && (
        <section aria-labelledby="track-payment" className="border-t border-line pt-5">
          <h2 id="track-payment" className="mb-3 text-base font-semibold tracking-tight text-ink">
            Payment
          </h2>
          {!paid && delivery && depositCovered && (
            <DepositPaidNotice delivery={delivery} money={money} pickup={fulfilment.method === 'pickup'} />
          )}
          {!paid && !depositCovered && <PaymentPanel token={token} order={order} money={money} />}
          {paid && (
            <p className="flex items-start gap-2 text-[15px] font-medium text-ink">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
              <span>
                Paid <span className="tnum">{money(order.paidMinor)}</span>. Received by {shop.name}.
              </span>
            </p>
          )}
        </section>
      )}

      <Section title="Progress">
        <Timeline order={order} />
      </Section>

      <DeliveryUpdates order={order} money={money} />

      {fulfilment.method === 'delivery' ? (
        <Section title="Delivery">
          <LocationPreview
            shopLoc={shopLoc}
            dropLoc={dropLoc}
            shopLabel={shop.locationLabel ?? shop.name}
            dropLabel={fulfilment.landmark}
            height={220}
          />
          <dl className="mt-3 grid gap-2 text-sm">
            {fulfilment.landmark && <InfoRow icon={<MapPin className="size-4" aria-hidden />} label="Drop-off" value={fulfilment.landmark} />}
            {fulfilment.rider && <InfoRow icon={<Bike className="size-4" aria-hidden />} label="Rider" value={fulfilment.rider} />}
            {fulfilment.trackingRef && (
              <InfoRow
                icon={<Link2 className="size-4" aria-hidden />}
                label="Tracking ref"
                value={
                  <span className="inline-flex items-center gap-2">
                    <span className="tnum">{fulfilment.trackingRef}</span>
                    <CopyButton id="ref" text={fulfilment.trackingRef} copied={copied} copy={copy} label="Copy tracking reference" />
                  </span>
                }
              />
            )}
            {fulfilment.deliveredAt && (
              <InfoRow
                icon={<Check className="size-4" aria-hidden />}
                label="Delivered"
                value={formatDateTime(fulfilment.deliveredAt, locale, shop.timezone)}
              />
            )}
          </dl>
          {!terminal && (
            <p className="mt-3 flex items-start gap-2 text-xs text-ink-3">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Live rider location is not available. We'll update you at each step.
            </p>
          )}
        </Section>
      ) : (
        <Section title="Pickup">
          <LocationPreview shopLoc={shopLoc} dropLoc={null} shopLabel={shop.locationLabel ?? shop.name} dropLabel={null} height={200} />
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
            <Store className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            {shop.locationLabel ? `Collect from ${shop.name}, ${shop.locationLabel}.` : `Collect from ${shop.name}. They'll share the spot when your order is ready.`}
          </p>
        </Section>
      )}

      <Section title="Your order">
        <ul className="flex flex-col divide-y divide-line">
          {order.lines.map((l, i) => (
            <li key={`${l.productId ?? 'x'}-${i}`} className="flex items-start justify-between gap-3 py-2.5 text-[15px] first:pt-0">
              <span className="min-w-0 break-words">
                <span className="tnum text-ink-3">{l.quantity} × </span>
                <span className="font-medium text-ink">{l.name}</span>
                {l.variant && l.variant !== 'Default' && <span className="block text-[13px] text-ink-3">{l.variant}</span>}
              </span>
              <span className="shrink-0 font-medium text-ink tnum">{money(l.totalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
          <TotalRow label="Subtotal" value={money(order.subtotalMinor)} />
          {order.taxMinor > 0 && <TotalRow label="Tax" value={money(order.taxMinor)} />}
          <TotalRow
            label={fulfilment.method === 'pickup' ? 'Pickup' : 'Delivery'}
            value={order.deliveryFeeMinor === 0 ? 'Free' : money(order.deliveryFeeMinor)}
          />
        </dl>
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <span className="text-[15px] font-semibold text-ink">Total</span>
          <span className="font-display text-2xl font-semibold tracking-tight tnum">{money(order.totalMinor)}</span>
        </div>
        {order.paidMinor > 0 && (
          <dl className="mt-2 flex flex-col gap-1.5 text-sm">
            <TotalRow label="Paid" value={money(order.paidMinor)} />
            {order.totalMinor - order.paidMinor > 0 && (
              <TotalRow label="Left to pay" value={money(order.totalMinor - order.paidMinor)} />
            )}
          </dl>
        )}
      </Section>

      {waLink && (
        <Section title={`Contact ${shop.name}`}>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('secondary', 'lg', 'w-full')}
          >
            <WhatsAppGlyph className="size-5 text-[#25D366]" /> Message the shop on WhatsApp
          </a>
          <p className="mt-2 text-xs text-ink-3">
            Opens your own WhatsApp with a message about order #{order.number}. Nothing is sent automatically.
          </p>
        </Section>
      )}

      <TrackTrust token={token} paidMinor={order.paidMinor} shopName={shop.name} locale={locale} timezone={shop.timezone} />

      {order.status === 'delivered' && <ReviewSection token={token} order={order} />}

      {shop.slug && (
        <Link to={`/s/${shop.slug}`} className={buttonClass('ghost', 'lg', 'w-full')}>
          Back to {shop.name}
        </Link>
      )}
    </main>
  )
}

/* ───────────── Header pieces ───────────── */
function UpdatedLabel({ updatedAt, fetching, onRefresh }: { updatedAt: number; fetching: boolean; onRefresh(): void }) {
  const now = useNow(5000)
  const secs = Math.max(0, Math.round((now - updatedAt) / 1000))
  const text = secs < 15 ? 'Updated just now' : secs < 60 ? `Updated ${secs}s ago` : `Updated ${Math.round(secs / 60)} min ago`
  return (
    <button
      type="button"
      onClick={onRefresh}
      aria-label={`${text}. Refresh now`}
      className="-mr-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-ink-3 hover:bg-sunken hover:text-ink"
    >
      {fetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
      <span aria-live="polite">{text}</span>
    </button>
  )
}

function PlacedHeader({ order, money }: { order: TrackedOrder; money(minor: number): string }) {
  const reduce = useReducedMotion()
  const { copied, copy } = useCopy()
  return (
    <div className="flex flex-col items-start gap-2">
      <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-ink">
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-pos-soft"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="size-4 text-pos" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.45, delay: 0.2, ease: EASE }}
            />
          </svg>
        </motion.span>
        <span>
          Order <span className="tnum">#{order.number}</span> placed
        </span>
      </h1>
      <p className="text-[15px] text-ink-2">
        Thanks{order.customerFirstName ? `, ${order.customerFirstName}` : ''}. {order.shop.name} has your order for{' '}
        <span className="font-semibold text-ink tnum">{money(order.totalMinor)}</span>. This page updates as it moves.
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy('link', window.location.href.replace(/[?#].*$/, ''))}
        icon={copied === 'link' ? <Check className="size-4 text-pos" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        className="-ml-3.5 h-11"
      >
        {copied === 'link' ? 'Link copied' : 'Copy link to this page'}
      </Button>
    </div>
  )
}

/* ───────────── Payment ───────────── */
function PaymentPanel({ token, order, money }: { token: string; order: TrackedOrder; money(minor: number): string }) {
  const { shop } = order
  const due = order.delivery ? order.delivery.dueNowMinor : order.totalMinor - order.paidMinor
  const depositOutstanding = order.delivery ? order.delivery.depositDueMinor - order.delivery.depositPaidMinor : 0
  const { copied, copy } = useCopy()

  // A deposit is due now even when the balance is paid in cash on delivery.
  if (order.paymentPreference === 'cod' && !(depositOutstanding > 0 && (shop.mpesaTill || shop.mpesaPaybill))) {
    return (
      <div className="flex items-start gap-3">
        <Banknote className="mt-1 size-5 shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold tracking-tight tnum">
            Pay {money(due)} on {order.fulfilment.method === 'pickup' ? 'pickup' : 'delivery'}
          </p>
          <p className="text-sm text-ink-2">
            {order.paidMinor > 0 ? `${money(order.paidMinor)} already received. ` : ''}Have the amount ready in cash or M-Pesa.
          </p>
        </div>
      </div>
    )
  }

  // NGN bank transfer: dedicated account details, or "the shop will share details".
  if (order.paymentPreference === 'bank_transfer' && order.bankTransfer) return <BankTransferPanel order={order} money={money} />

  if (order.paymentPreference !== 'mpesa' && !(depositOutstanding > 0 && (shop.mpesaTill || shop.mpesaPaybill))) {
    return (
      <div>
        <p className="font-display text-xl font-semibold tracking-tight tnum">{money(due)} to pay</p>
        <p className="text-sm text-ink-2">{shop.name} will contact you with how to pay.</p>
      </div>
    )
  }

  return <MpesaPanel token={token} order={order} due={due} money={money} copied={copied} copy={copy} />
}

function MpesaPanel({
  token,
  order,
  due,
  money,
  copied,
  copy,
}: {
  token: string
  order: TrackedOrder
  due: number
  money(minor: number): string
  copied: string | null
  copy(id: string, text: string): Promise<void>
}) {
  const { shop } = order
  const qc = useQueryClient()
  const [phone, setPhone] = useState(savedPhone)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [simulate, setSimulate] = useState<SimulatedOutcome>('success')
  const hasManual = Boolean(shop.mpesaTill || shop.mpesaPaybill)

  const options = useQuery({
    queryKey: ['payment-options', shop.slug],
    queryFn: async () => (await getStorefrontGateway()).getPaymentOptions(shop.slug as string),
    enabled: Boolean(shop.slug),
    staleTime: 60_000,
    retry: false,
  })
  const simulated = options.data?.simulated === true
  // No slug, or the lookup failed: still offer the prompt; the server answers not_configured if it can't.
  const stkOffered = options.data ? options.data.stk : !options.isPending || !shop.slug

  const { phase, send, stopWaiting, reset } = useMpesaPrompt(token, (status) => {
    if (status === 'paid' || status === 'mismatch' || status === 'late') void qc.invalidateQueries({ queryKey: ['track', token] })
  })

  function submit() {
    const r = toE164(phone, regionOf(shop.locale))
    if (!r.ok) {
      setPhoneError(r.error)
      return
    }
    setPhoneError(null)
    void send(r.e164, simulated ? simulate : undefined)
  }

  const manual =
    showManual || phase.kind === 'not_configured' || phase.kind === 'error' || (options.isSuccess && !stkOffered)

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">Amount to pay</p>
          <p className="font-display text-4xl font-semibold leading-tight tracking-tight tnum">{money(due)}</p>
          {order.paidMinor > 0 && <p className="text-xs text-ink-3 tnum">{money(order.paidMinor)} of {money(order.totalMinor)} received</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone="warn">Not paid yet</Badge>
          {simulated && <Badge tone="info">Demo · simulated</Badge>}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!manual && phase.kind === 'waiting' ? (
          <motion.div key="waiting" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
            <PromptWaiting
              startedAt={phase.startedAt}
              registeredName={shop.registeredName}
              simulated={simulated}
              onResend={submit}
              onCancel={() => stopWaiting('cancelled_by_buyer')}
              onExpire={() => stopWaiting('no_answer')}
            />
          </motion.div>
        ) : !manual && (phase.kind === 'done' || phase.kind === 'stopped') ? (
          <motion.div key="outcome" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex flex-col gap-3">
            <PromptOutcome phase={phase} />
            {!(
              phase.kind === 'done' &&
              (phase.status === 'paid' || phase.status === 'mismatch' || phase.status === 'late' || phase.status === 'awaiting_receipt')
            ) && (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={reset} icon={<RefreshCw className="size-4" aria-hidden />}>
                  Send a new prompt
                </Button>
                {hasManual && (
                  <Button variant="ghost" onClick={() => setShowManual(true)}>
                    Pay with {shop.mpesaTill ? 'Till' : 'Paybill'} instead
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        ) : !manual ? (
          <motion.div key="ask" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex flex-col gap-3">
            <Field label="M-Pesa phone number" error={phoneError} hint="We send a payment prompt to this phone. You enter your PIN there, never here.">
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 text-base tnum"
                  placeholder="0712 345 678"
                />
              )}
            </Field>
            {simulated && (
              <label className="flex flex-col gap-1 rounded-lg border border-dashed border-line-strong p-3 text-sm">
                <span className="font-medium text-ink">Demo: choose what the simulated M-Pesa does</span>
                <select
                  value={simulate}
                  onChange={(e) => setSimulate(e.target.value as SimulatedOutcome)}
                  className="h-11 rounded-lg border border-line-strong bg-panel px-3 text-ink"
                >
                  <option value="success">Customer pays</option>
                  <option value="cancelled">Customer cancels the prompt</option>
                  <option value="timeout">Prompt times out</option>
                  <option value="wrong_amount">Wrong amount arrives</option>
                  <option value="callback_lost">Customer pays, but the M-Pesa callback is lost</option>
                </select>
                <span className="text-xs text-ink-2">Nothing is charged. No phone is contacted.</span>
              </label>
            )}
            {shop.registeredName && (
              <p className="flex items-start gap-2 text-sm text-ink-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden />
                <span>
                  The prompt will say <strong className="font-semibold text-ink">{shop.registeredName}</strong>. Only enter your PIN if it does.
                </span>
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={submit}
              loading={phase.kind === 'sending'}
              className="w-full"
              icon={<Smartphone className="size-4" aria-hidden />}
            >
              Send M-Pesa prompt to my phone
            </Button>
            {hasManual && (
              <button type="button" onClick={() => setShowManual(true)} className="min-h-11 text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                Pay with {shop.mpesaTill ? 'Till number' : 'Paybill'} instead
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex flex-col gap-3">
            {phase.kind === 'error' && (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-neg-soft p-3 text-sm text-neg">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{phase.message}. You can pay with the steps below instead.</span>
              </p>
            )}
            {(phase.kind === 'not_configured' || (options.isSuccess && !stkOffered)) && !showManual && (
              <p className="text-sm text-ink-2">Automatic prompts aren't set up for this shop yet. Pay in a few steps on your phone:</p>
            )}
            {hasManual ? (
              <>
                {shop.registeredName && (
                  <p className="flex items-start gap-2 border-l-2 border-pos py-0.5 pl-3 text-sm text-ink">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden />
                    <span>
                      Before you enter your PIN, M-Pesa must show <strong className="font-semibold">{shop.registeredName}</strong>. If it shows a
                      different name, stop.
                    </span>
                  </p>
                )}
                <ol className="flex flex-col gap-2.5 rounded-lg bg-sunken p-3 text-[15px]">
                  <Step n={1}>Open M-Pesa and choose <strong>Lipa na M-Pesa</strong></Step>
                  {shop.mpesaTill ? (
                    <>
                      <Step n={2}>Choose <strong>Buy Goods and Services</strong></Step>
                      <Step n={3}>
                        <CopyLine label="Till number" value={shop.mpesaTill} id="till" copied={copied} copy={copy} />
                      </Step>
                    </>
                  ) : (
                    <>
                      <Step n={2}>Choose <strong>Pay Bill</strong></Step>
                      <Step n={3}>
                        <CopyLine label="Business number" value={shop.mpesaPaybill ?? ''} id="paybill" copied={copied} copy={copy} />
                      </Step>
                      <Step n={4}>
                        <CopyLine label="Account number" value={String(order.number)} id="acct" copied={copied} copy={copy} />
                      </Step>
                    </>
                  )}
                  <Step n={shop.mpesaTill ? 4 : 5}>
                    <CopyLine label="Amount" value={money(due)} copyValue={majorString(due, order.currency)} id="amt" copied={copied} copy={copy} />
                  </Step>
                  <Step n={shop.mpesaTill ? 5 : 6}>
                    Check the name{shop.registeredName ? <> shows <strong>{shop.registeredName}</strong></> : ''}, then enter your PIN
                  </Step>
                </ol>
              </>
            ) : (
              <p className="text-sm text-ink-2">{shop.name} will send you payment details shortly.</p>
            )}
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {options.data?.provider === 'daraja' && shop.mpesaPaybill && !shop.mpesaTill
                ? 'This page shows "Paid" once M-Pesa confirms your payment.'
                : 'The shop confirms your payment. This page shows "Paid" once they have it.'}
            </p>
            {stkOffered && (showManual || phase.kind === 'error') && (
              <button
                type="button"
                onClick={() => {
                  setShowManual(false)
                  reset()
                }}
                className="min-h-11 self-start text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
              >
                Get an M-Pesa prompt instead
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PromptWaiting({
  startedAt,
  registeredName,
  simulated,
  onResend,
  onCancel,
  onExpire,
}: {
  startedAt: number
  registeredName: string | null
  simulated: boolean
  onResend(): void
  onCancel(): void
  onExpire(): void
}) {
  const now = useNow(1000)
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const left = Math.max(0, WAIT_SECONDS - elapsed)
  const expireRef = useRef(onExpire)
  useEffect(() => {
    expireRef.current = onExpire
  }, [onExpire])
  useEffect(() => {
    if (left === 0) expireRef.current()
  }, [left])
  const pct = Math.min(100, (elapsed / WAIT_SECONDS) * 100)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-lg bg-info-soft p-3 text-sm" role="status" aria-live="polite">
        <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{simulated ? 'Simulated prompt sent' : 'Check your phone'}</p>
          <p className="text-ink-2">
            Enter your M-Pesa PIN on the prompt{registeredName ? <> from <strong className="font-semibold text-ink">{registeredName}</strong></> : ''}. This page
            updates by itself.
          </p>
          <p className="mt-2 text-xs text-ink-3 tnum">
            Waiting for M-Pesa · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel" aria-hidden>
            <div className="h-full rounded-full bg-info transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onResend} disabled={elapsed < RESEND_AFTER_SECONDS}>
          {elapsed < RESEND_AFTER_SECONDS ? `Resend in ${RESEND_AFTER_SECONDS - elapsed}s` : "Didn't get it? Resend"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Stop waiting
        </Button>
      </div>
    </div>
  )
}

function PromptOutcome({ phase }: { phase: Extract<PromptPhase, { kind: 'done' | 'stopped' }> }) {
  if (phase.kind === 'stopped') {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-warn-soft p-3 text-sm" role="status">
        <Info className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="font-semibold text-ink">{phase.reason === 'cancelled_by_buyer' ? 'Stopped waiting' : "We haven't heard back from M-Pesa yet"}</p>
          <p className="text-ink-2">
            If you already entered your PIN, please don't pay again: this page will show "Paid" as soon as M-Pesa confirms it. If no prompt
            appeared, send a new one.
          </p>
        </div>
      </div>
    )
  }
  const msg = buyerPromptMessage(phase.status, phase.resultCode)
  const good = phase.status === 'paid'
  const review = phase.status === 'mismatch' || phase.status === 'late' || phase.status === 'awaiting_receipt'
  return (
    <div
      className={cn('flex items-start gap-3 rounded-lg p-3 text-sm', good ? 'bg-pos-soft' : review ? 'bg-info-soft' : 'bg-neg-soft')}
      role={good || review ? 'status' : 'alert'}
    >
      {good ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
      ) : review ? (
        <Info className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 size-5 shrink-0 text-neg" aria-hidden />
      )}
      <div>
        <p className="font-semibold text-ink">{msg.title}</p>
        <p className="text-ink-2">{msg.body}</p>
      </div>
    </div>
  )
}

function majorString(minor: number, currency: string): string {
  try {
    return toMajorString(moneyOf(minor, currency))
  } catch {
    return String(minor)
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line bg-panel text-[11px] font-semibold text-ink-2 tnum" aria-hidden>
        {n}
      </span>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
    </li>
  )
}

function CopyLine({
  label,
  value,
  copyValue,
  id,
  copied,
  copy,
}: {
  label: string
  value: string
  copyValue?: string
  id: string
  copied: string | null
  copy(id: string, text: string): Promise<void>
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="min-w-0 break-words">
        {label}: <strong className="font-display text-base font-semibold tracking-tight tnum">{value}</strong>
      </span>
      <CopyButton id={id} text={copyValue ?? value} copied={copied} copy={copy} label={`Copy ${label.toLowerCase()}`} />
    </span>
  )
}

function CopyButton({
  id,
  text,
  copied,
  copy,
  label,
}: {
  id: string
  text: string
  copied: string | null
  copy(id: string, text: string): Promise<void>
  label: string
}) {
  const done = copied === id
  return (
    <button
      type="button"
      onClick={() => void copy(id, text)}
      aria-label={done ? 'Copied' : label}
      className="-my-2 grid size-11 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-panel hover:text-ink"
    >
      {done ? <Check className="size-4 text-pos" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}

/* ───────────── Timeline ───────────── */
const FLOW: Record<'pickup' | 'delivery', string[]> = {
  delivery: ['pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered'],
  pickup: ['pending_confirmation', 'confirmed', 'preparing', 'ready', 'delivered'],
}

interface TimelineStep {
  key: string
  label: string
  at: string | null
  state: 'done' | 'current' | 'upcoming' | 'stopped'
}

function buildSteps(order: TrackedOrder): TimelineStep[] {
  const method = order.fulfilment.method
  const history = [...order.history].sort((a, b) => a.at.localeCompare(b.at))
  const lastAt = new Map<string, string>()
  // First time each status was reached (a failed delivery adds a same-status row; it must not move the time).
  for (const h of history) {
    const k = h.status === 'draft' ? 'pending_confirmation' : h.status
    if (!lastAt.has(k)) lastAt.set(k, h.at)
  }
  if (!lastAt.has('pending_confirmation')) lastAt.set('pending_confirmation', order.createdAt)

  const status = order.status === 'draft' ? 'pending_confirmation' : order.status
  const flow = FLOW[method]
  const idx = flow.indexOf(status)

  if (idx === -1) {
    // Cancelled / refunded (or an unknown status): show only what really happened.
    const seen = new Set<string>()
    const steps: TimelineStep[] = [{ key: 'pending_confirmation', label: statusLabel('pending_confirmation', method), at: lastAt.get('pending_confirmation') ?? null, state: 'done' }]
    seen.add('pending_confirmation')
    for (const h of history) {
      const k = h.status === 'draft' ? 'pending_confirmation' : h.status
      if (seen.has(k) || k === status) continue
      seen.add(k)
      steps.push({ key: k, label: statusLabel(k, method), at: h.at, state: 'done' })
    }
    steps.push({ key: status, label: statusLabel(status, method, Boolean(order.delivery?.returnedAt)), at: lastAt.get(status) ?? null, state: 'stopped' })
    return steps
  }

  const steps: TimelineStep[] = []
  flow.forEach((k, i) => {
    if (i < idx) {
      // Steps the shop skipped are left out rather than shown with invented times.
      if (lastAt.has(k)) steps.push({ key: k, label: statusLabel(k, method), at: lastAt.get(k) ?? null, state: 'done' })
    } else if (i === idx) {
      steps.push({ key: k, label: statusLabel(k, method), at: lastAt.get(k) ?? null, state: status === 'delivered' ? 'done' : 'current' })
    } else {
      steps.push({ key: k, label: statusLabel(k, method), at: null, state: 'upcoming' })
    }
  })
  return steps
}

const CURRENT_HINT: Record<string, string> = {
  pending_confirmation: 'Waiting for the shop to confirm',
  confirmed: 'The shop accepted your order',
  preparing: 'Your order is being packed',
  ready: 'Packed and ready',
  dispatched: 'On the way to you',
}

function Timeline({ order }: { order: TrackedOrder }) {
  const steps = buildSteps(order)
  const { locale, timezone } = order.shop
  // Payments sit under the step that was current when they arrived; status times are untouched.
  const paymentsByStep = attachPaymentEvents(steps, order.payments ?? [])
  return (
    <ol className="relative flex flex-col" aria-label="Order progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.state === 'current' ? 'step' : undefined}>
            {!last && (
              <span
                aria-hidden
                className={cn('absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5', s.state === 'done' ? 'bg-primary' : 'bg-line')}
              />
            )}
            <span aria-hidden className="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center">
              {s.state === 'done' && (
                <span className="grid size-6 place-items-center rounded-full bg-primary text-on-primary">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              )}
              {s.state === 'current' && (
                <span className="grid size-6 place-items-center rounded-full border-2 border-primary bg-panel">
                  <span className="size-2.5 rounded-full bg-primary" />
                </span>
              )}
              {s.state === 'upcoming' && <span className="size-3 rounded-full border-2 border-line-strong bg-panel" />}
              {s.state === 'stopped' && (
                <span className="grid size-6 place-items-center rounded-full bg-neg-soft text-neg">
                  <XCircle className="size-4" />
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[15px] font-semibold leading-6',
                  s.state === 'upcoming' ? 'text-ink-3' : s.state === 'stopped' ? 'text-neg' : 'text-ink',
                )}
              >
                {s.label}
                {s.state === 'current' && <span className="sr-only"> (current step)</span>}
              </p>
              {s.state === 'current' && CURRENT_HINT[s.key] && <p className="text-sm text-ink-2">{CURRENT_HINT[s.key]}</p>}
              {s.at && (
                <p className="text-xs text-ink-3 tnum">
                  <time dateTime={s.at}>{formatDateTime(s.at, locale || 'en', timezone)}</time>
                </p>
              )}
              {(paymentsByStep.get(s.key) ?? []).map((p, j) => (
                <p key={`${p.receivedAt}-${j}`} className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-2">
                  <Banknote className="mt-0.5 size-3.5 shrink-0 text-pos" aria-hidden />
                  <span>
                    Payment of <strong className="font-semibold text-ink tnum">{fmtMoney(p.amountMinor, p.currency, locale || 'en')}</strong> received,{' '}
                    {paymentSourceText(p)}
                    <span className="block text-xs text-ink-3 tnum">
                      <time dateTime={p.receivedAt}>{formatDateTime(p.receivedAt, locale || 'en', timezone)}</time>
                    </span>
                  </span>
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* ───────────── Rows ───────────── */
function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <dt className="w-24 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 font-medium text-ink">{value}</dd>
    </div>
  )
}

function TotalRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-ink tnum">{value}</dd>
    </div>
  )
}

/* ───────────── Verified reviews (delivered orders only) ───────────── */
function ReviewSection({ token, order }: { token: string; order: TrackedOrder }) {
  const reviewed = new Set(order.reviewedProductIds)
  const products: { id: string; name: string }[] = []
  for (const l of order.lines) {
    if (l.productId && !reviewed.has(l.productId) && !products.some((p) => p.id === l.productId)) {
      products.push({ id: l.productId, name: l.name })
    }
  }
  if (products.length === 0) return null
  return (
    <Section title="How was it?">
      <p className="-mt-2 mb-4 text-sm text-ink-2">Your review is marked as a verified purchase.</p>
      <div className="flex flex-col divide-y divide-line">
        {products.map((p) => (
          <ReviewForm key={p.id} token={token} productId={p.id} name={p.name} />
        ))}
      </div>
    </Section>
  )
}

function ReviewForm({ token, productId, name }: { token: string; productId: string; name: string }) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const submit = useMutation({
    mutationFn: async () => (await getStorefrontGateway()).submitReview(token, productId, rating, body.trim() || null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['track', token] }),
  })
  const groupName = `rating-${productId}`

  if (submit.isSuccess) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm font-medium text-pos first:pt-0" role="status">
        <CheckCircle2 className="size-4" aria-hidden /> Thanks for reviewing {name}.
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
      onSubmit={(e) => {
        e.preventDefault()
        if (rating >= 1) submit.mutate()
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">{name}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="grid size-11 cursor-pointer place-items-center rounded-lg hover:bg-sunken has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
            >
              <input type="radio" name={groupName} value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              <Star className={cn('size-6 transition-colors', n <= rating ? 'fill-mango text-mango' : 'text-line-strong')} aria-hidden />
              <span className="sr-only">
                {n} star{n > 1 ? 's' : ''}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {rating > 0 && (
        <Field label="Add a few words" optional>
          {(p) => (
            <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={1000} placeholder="What did you like?" />
          )}
        </Field>
      )}
      {submit.isError && (
        <p role="alert" className="text-sm text-neg">
          {errorMessage(submit.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={rating < 1} loading={submit.isPending} className="self-start">
        Submit review
      </Button>
    </form>
  )
}
