import { Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { CountryCode } from 'libphonenumber-js/min'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Bike,
  Loader2,
  Lock,
  Map as MapIcon,
  MapPin,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
} from 'lucide-react'
import { Button, Field, Input, Skeleton, Textarea, buttonClass } from '@/app/ui/primitives'
import { cn } from '@/lib/utils'
import { toE164 } from '@/domain/locale'
import type { PaymentChoice, PlaceOrderInput, PublicShop, Quote, QuoteInput } from '@/gateway/storefront'
import { useDebounce } from '@/hooks/useDebounce'
import { getStorefrontGateway } from '@/storefront/gateway'
import { useCart, type UseCartResult, safeLocalStorage } from '@/storefront/cart'
import { useStorefront } from '@/storefront/components/hooks'
import { ProductImg } from '@/storefront/components/ProductImg'
import { fmtMoney, isNotFoundError } from '@/storefront/components/storefront-utils'
import { MapFallback, StaticMap, type LatLng } from '@/maps'
import type { CheckoutOptions } from '@/gateway/delivery'
import { DeliveryPinStep } from '@/storefront/components/DeliveryPinStep'
import { PickupPointPicker, PolicyNote } from '@/storefront/components/CheckoutPolicy'

/* ───────────── Device-only conveniences (never required, never shared) ───────────── */
const BUYER_KEY = 'rafu-buyer'
const addressKey = (slug: string) => `rafu-address:${slug}`

interface SavedBuyer {
  name: string
  phone: string
}
interface SavedAddress {
  lat: number
  lng: number
  addressLine: string
  landmark: string
  building: string
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = safeLocalStorage.getItem(key)
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    void safeLocalStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

function newIdempotencyKey(): string {
  // randomUUID needs a secure context; getRandomValues works everywhere.
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) return err.message
  return 'Something went wrong. Please try again.'
}
function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code
  return undefined
}
const isOutOfArea = (err: unknown) => /outside the delivery area/i.test(errorMessage(err))

const EASE = [0.2, 0.8, 0.2, 1] as const

/* ───────────── Page ───────────── */
export default function CheckoutPage() {
  const { slug = '' } = useParams()
  const cart = useCart(slug)
  const storefront = useStorefront(slug)
  const [placedToken, setPlacedToken] = useState<string | null>(null)

  if (placedToken) {
    return (
      <PageFrame slug={slug}>
        <div className="flex flex-col items-center gap-3 py-24 text-center" role="status">
          <Loader2 className="size-6 animate-spin text-brand" aria-hidden />
          <p className="text-sm text-ink-2">Opening your order…</p>
        </div>
      </PageFrame>
    )
  }

  if (storefront.isPending) return <CheckoutSkeleton slug={slug} />

  if (storefront.isError) {
    return (
      <PageFrame slug={slug}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
          <AlertCircle className="size-8 text-neg" aria-hidden />
          <h1 className="text-2xl font-extrabold tracking-tight">
            {isNotFoundError(storefront.error) ? 'This shop is not available' : 'We could not load checkout'}
          </h1>
          <p className="text-sm text-ink-2">{errorMessage(storefront.error)}</p>
          <Button variant="secondary" onClick={() => void storefront.refetch()}>
            Try again
          </Button>
        </div>
      </PageFrame>
    )
  }

  const { shop } = storefront.data

  if (cart.lines.length === 0) {
    return (
      <PageFrame slug={slug} shopName={shop.name}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center ak-rise">
          <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand">
            <ShoppingBag className="size-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight">Your cart is empty</h1>
          <p className="text-sm text-ink-2">Add something you love from {shop.name}, then come back here to order.</p>
          <Link to={`/s/${slug}`} className={buttonClass('brand', 'lg', 'min-h-11')}>
            Browse the shop
          </Link>
        </div>
      </PageFrame>
    )
  }

  return (
    <PageFrame slug={slug} shopName={shop.name}>
      <CheckoutForm slug={slug} shop={shop} cart={cart} onPlaced={setPlacedToken} />
    </PageFrame>
  )
}

function PageFrame({ slug, shopName, children }: { slug: string; shopName?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas pb-16">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Link
            to={`/s/${slug}`}
            aria-label={shopName ? `Back to ${shopName}` : 'Back to shop'}
            className="-ml-2 grid size-11 place-items-center rounded-xl text-ink-2 hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold leading-tight tracking-tight">Checkout</p>
            {shopName && <p className="truncate text-xs text-ink-3">{shopName}</p>}
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3">
            <Lock className="size-3.5" aria-hidden /> Secure order
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-5">{children}</main>
    </div>
  )
}

function CheckoutSkeleton({ slug }: { slug: string }) {
  return (
    <PageFrame slug={slug}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true" aria-label="Loading checkout">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-96 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
        </div>
        <Skeleton className="h-96 w-full rounded-[var(--radius-card)]" />
      </div>
    </PageFrame>
  )
}

/* ───────────── Form ───────────── */
type Method = 'delivery' | 'pickup_point' | 'pickup'

function CheckoutForm({
  slug,
  shop,
  cart,
  onPlaced,
}: {
  slug: string
  shop: PublicShop
  cart: UseCartResult
  onPlaced(token: string): void
}) {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const locale = shop.locale || 'en'

  const [saved] = useState(() => ({
    buyer: readJSON<SavedBuyer>(BUYER_KEY),
    address: readJSON<SavedAddress>(addressKey(slug)),
  }))

  const [name, setName] = useState(saved.buyer?.name ?? '')
  const [phone, setPhone] = useState(saved.buyer?.phone ?? '')
  const [chosenMethod, setChosenMethod] = useState<Method | null>(null)
  const [pin, setPin] = useState<LatLng | null>(saved.address ? { lat: saved.address.lat, lng: saved.address.lng } : null)
  const [addressLine, setAddressLine] = useState(saved.address?.addressLine ?? '')
  const [landmark, setLandmark] = useState(saved.address?.landmark ?? '')
  const [building, setBuilding] = useState(saved.address?.building ?? '')
  const [instructions, setInstructions] = useState('')
  const [chosenPayment, setChosenPayment] = useState<PaymentChoice | null>(null)
  const [marketingOptIn, setMarketingOptIn] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [pickupPointId, setPickupPointId] = useState<string | null>(null)
  const [pickupMapOpen, setPickupMapOpen] = useState(false)

  /* Payment policy and pick-up points (server-side; the quote enforces them). */
  const optionsQuery = useQuery({
    queryKey: ['storefront', slug, 'checkout-options'],
    queryFn: async () => (await getStorefrontGateway()).getCheckoutOptions(slug),
    staleTime: 60_000,
    retry: 1,
  })
  const options: CheckoutOptions | null = optionsQuery.data ?? null
  const pickupPoints = options?.pickupPoints ?? []

  /* Methods and payments the shop actually offers. */
  const methods: Method[] = [
    ...(shop.deliveryEnabled ? (['delivery'] as const) : []),
    ...(shop.deliveryEnabled && pickupPoints.length > 0 ? (['pickup_point'] as const) : []),
    ...(shop.pickupEnabled ? (['pickup'] as const) : []),
  ]
  const method: Method | null = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : (methods[0] ?? null)
  const chosenPoint = pickupPoints.find((p) => p.id === pickupPointId) ?? null

  const hasMpesa = Boolean(shop.mpesaTill || shop.mpesaPaybill)
  // A shop that needs full payment first does not offer cash on delivery (the server refuses it too).
  const codAllowed = shop.codEnabled && options?.policy.paymentMode !== 'full_prepay'
  const payments: PaymentChoice[] = [...(hasMpesa ? (['mpesa'] as const) : []), ...(codAllowed ? (['cod'] as const) : [])]
  const payment: PaymentChoice =
    chosenPayment && payments.includes(chosenPayment) ? chosenPayment : (payments[0] ?? 'other')

  const shopLocation: LatLng | null =
    shop.locationLat != null && shop.locationLng != null ? { lat: shop.locationLat, lng: shop.locationLng } : null
  const [pickerCenter] = useState<LatLng>(() => pin ?? shopLocation ?? { lat: 0, lng: 20 })

  /* Live server quote, debounced so dragging the map doesn't spam the server. */
  // Cheap to build each render; its JSON string is the stable key below.
  const quoteInput: QuoteInput = {
    lines: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    method: method ?? 'pickup',
    ...(method === 'delivery' && pin ? { lat: Number(pin.lat.toFixed(5)), lng: Number(pin.lng.toFixed(5)) } : {}),
    ...(method === 'pickup_point' && chosenPoint ? { pickupPointId: chosenPoint.id } : {}),
  }
  const quoteKey = JSON.stringify(quoteInput)
  const debouncedKey = useDebounce(quoteKey, 450)
  const debouncedInput = useMemo(() => JSON.parse(debouncedKey) as QuoteInput, [debouncedKey])
  const quoteEnabled =
    method !== null &&
    debouncedInput.lines.length > 0 &&
    (debouncedInput.method === 'pickup' || debouncedInput.lat != null || debouncedInput.pickupPointId != null)

  const quoteQuery = useQuery({
    queryKey: ['storefront', slug, 'quote', debouncedKey],
    queryFn: async () => (await getStorefrontGateway()).quote(slug, debouncedInput),
    enabled: quoteEnabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  })

  const settled = debouncedKey === quoteKey
  const freshQuote: Quote | null =
    settled && quoteQuery.data && !quoteQuery.isPlaceholderData && !quoteQuery.isError ? quoteQuery.data : null
  const quoteBusy = quoteEnabled && (!settled || quoteQuery.isFetching)
  const outOfArea = quoteQuery.isError && isOutOfArea(quoteQuery.error)

  /* Validation (shown after the first submit attempt). */
  const phoneResult = toE164(phone, (shop.countryCode || undefined) as CountryCode | undefined)
  const errors = {
    name: name.trim().length < 2 ? 'Enter your name so the shop knows who the order is for' : null,
    phone: phoneResult.ok ? null : phone.trim() ? phoneResult.error : 'Enter your phone number',
    method: method ? null : 'This shop is not taking delivery or pickup orders right now',
    pin: method === 'delivery' && !pin ? 'Share your location or set a pin on the map so the shop can price delivery' : null,
    point: method === 'pickup_point' && !chosenPoint ? 'Choose a pick-up point' : null,
    landmark:
      method === 'delivery' && !landmark.trim() && !addressLine.trim()
        ? 'Add a landmark or street so the rider can find you'
        : null,
  }
  const firstError = Object.values(errors).find(Boolean) ?? null

  const placeOrder = useMutation({
    mutationFn: async (input: PlaceOrderInput) => (await getStorefrontGateway()).placeOrder(slug, input, idempotencyKey),
    onSuccess: (placed) => {
      writeJSON(BUYER_KEY, { name: name.trim(), phone: phone.trim() } satisfies SavedBuyer)
      if (method === 'delivery' && pin) {
        writeJSON(addressKey(slug), {
          lat: pin.lat,
          lng: pin.lng,
          addressLine: addressLine.trim(),
          landmark: landmark.trim(),
          building: building.trim(),
        } satisfies SavedAddress)
      }
      onPlaced(placed.trackingToken)
      cart.clear()
      navigate(`/t/${placed.trackingToken}?new=1`)
    },
    onError: (err) => {
      // The server answered with a definite rejection: a later attempt is a new order request.
      // Network failures keep the same key so a retry can never create a duplicate order.
      if (errorCode(err)) setIdempotencyKey(newIdempotencyKey())
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowErrors(true)
    if (firstError || !freshQuote || !method || !phoneResult.ok) return
    const input: PlaceOrderInput = {
      ...quoteInput,
      name: name.trim(),
      phoneE164: phoneResult.e164,
      payment,
      marketingOptIn,
      channel: 'storefront',
      ...(method === 'delivery'
        ? {
            addressLine: addressLine.trim() || undefined,
            landmark: landmark.trim() || undefined,
            building: building.trim() || undefined,
            instructions: instructions.trim() || undefined,
          }
        : {}),
    }
    placeOrder.mutate(input)
  }

  const fieldError = (msg: string | null) => (showErrors ? msg : null)
  const fade = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.25, ease: EASE },
      }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {/* 1 · Contact */}
        <Section step={1} title="Your details" subtitle="The shop uses this to confirm and deliver your order.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={fieldError(errors.name)}>
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="e.g. Wanjiru Kamau"
                  className="h-11 rounded-xl"
                  maxLength={80}
                />
              )}
            </Field>
            <Field
              label="Phone number"
              hint={hasMpesa ? 'Use your M-Pesa number to get the payment prompt.' : 'For delivery updates from the shop.'}
              error={fieldError(errors.phone)}
            >
              {(p) => (
                <Input
                  {...p}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={shop.countryCode === 'KE' ? '0712 345 678' : '+1 555 123 4567'}
                  className="h-11 rounded-xl tnum"
                  maxLength={24}
                />
              )}
            </Field>
          </div>
        </Section>

        {/* 2 · Delivery or pickup */}
        <Section step={2} title="Delivery or pickup">
          {methods.length === 0 ? (
            <p role="alert" className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
              {errors.method}
            </p>
          ) : (
            <Segmented
              legend="How do you want to get your order?"
              value={method ?? methods[0]}
              onChange={(v) => setChosenMethod(v as Method)}
              options={methods.map((m) =>
                m === 'delivery'
                  ? { value: m, label: 'Delivery', icon: <Bike className="size-4" aria-hidden />, note: shop.deliveryPromise ?? undefined }
                  : m === 'pickup_point'
                    ? {
                        value: m,
                        label: 'Pick-up point',
                        icon: <MapPin className="size-4" aria-hidden />,
                        note: `From ${fmtMoney(Math.min(...pickupPoints.map((p) => p.feeMinor)), shop.currency, locale)}`,
                      }
                    : { value: m, label: 'Pickup', icon: <Store className="size-4" aria-hidden />, note: 'Free' },
              )}
            />
          )}

          <AnimatePresence mode="wait" initial={false}>
            {method === 'delivery' && (
              <motion.div key="delivery" {...fade} className="mt-4 flex flex-col gap-4">
                <DeliveryPinStep pin={pin} onPin={setPin} center={pickerCenter} restored={Boolean(saved.address)} error={fieldError(errors.pin)} />

                <DeliveryQuoteStatus
                  shop={shop}
                  pin={pin}
                  shopLocation={shopLocation}
                  quote={freshQuote}
                  busy={quoteBusy}
                  error={quoteQuery.isError ? quoteQuery.error : null}
                  outOfArea={outOfArea}
                  onRetry={() => void quoteQuery.refetch()}
                  showMap={false}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Landmark" hint="e.g. Near Total petrol station" error={fieldError(errors.landmark)}>
                    {(p) => (
                      <Input
                        {...p}
                        value={landmark}
                        onChange={(e) => setLandmark(e.target.value)}
                        placeholder="Near Total petrol station"
                        className="h-11 rounded-xl"
                        maxLength={120}
                      />
                    )}
                  </Field>
                  <Field label="Street or area" optional>
                    {(p) => (
                      <Input
                        {...p}
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                        autoComplete="street-address"
                        placeholder="e.g. Ngong Road, Kilimani"
                        className="h-11 rounded-xl"
                        maxLength={160}
                      />
                    )}
                  </Field>
                  <Field label="Building, floor or house" optional>
                    {(p) => (
                      <Input
                        {...p}
                        value={building}
                        onChange={(e) => setBuilding(e.target.value)}
                        placeholder="e.g. Amani Court, 3rd floor, B12"
                        className="h-11 rounded-xl"
                        maxLength={120}
                      />
                    )}
                  </Field>
                  <Field label="Instructions for the rider" optional>
                    {(p) => (
                      <Textarea
                        {...p}
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        rows={2}
                        placeholder="e.g. Call when at the gate"
                        className="rounded-xl"
                        maxLength={300}
                      />
                    )}
                  </Field>
                </div>
              </motion.div>
            )}

            {method === 'pickup_point' && (
              <motion.div key="pickup_point" {...fade} className="mt-4 flex flex-col gap-4">
                <PickupPointPicker
                  points={pickupPoints}
                  value={chosenPoint?.id ?? null}
                  onChange={setPickupPointId}
                  currency={shop.currency}
                  locale={locale}
                  error={fieldError(errors.point)}
                />
                {quoteQuery.isError && settled && (
                  <p role="alert" className="rounded-xl bg-neg-soft p-3 text-sm text-neg">
                    {errorMessage(quoteQuery.error)}
                  </p>
                )}
              </motion.div>
            )}

            {method === 'pickup' && (
              <motion.div key="pickup" {...fade} className="mt-4 flex flex-col gap-3">
                {shopLocation &&
                  (pickupMapOpen ? (
                    <Suspense fallback={<MapFallback height={200} />}>
                      <StaticMap markers={[{ ...shopLocation, kind: 'shop', label: shop.locationLabel ?? shop.name }]} height={200} />
                    </Suspense>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPickupMapOpen(true)}
                      icon={<MapIcon className="size-4" aria-hidden />}
                      className="min-h-11 self-start"
                    >
                      Show the shop on a map
                    </Button>
                  ))}
                <div className="flex items-start gap-3 rounded-xl bg-sunken p-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <div className="text-sm">
                    <p className="font-semibold text-ink">Collect from {shop.name}</p>
                    <p className="text-ink-2">
                      {shop.locationLabel ?? 'The shop will share the pickup spot when it confirms your order.'}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* 3 · Payment */}
        <Section step={3} title="Payment">
          {payments.length === 0 ? (
            <p className="rounded-xl bg-sunken p-3 text-sm text-ink-2">
              {shop.name} will contact you on your phone with how to pay once they confirm the order.
            </p>
          ) : (
            <Segmented
              legend="How will you pay?"
              value={payment}
              onChange={(v) => setChosenPayment(v as PaymentChoice)}
              stacked
              options={payments.map((p) =>
                p === 'mpesa'
                  ? {
                      value: p,
                      label: 'M-Pesa',
                      icon: <Smartphone className="size-4" aria-hidden />,
                      note: 'Get a prompt on your phone, or pay by ' + (shop.mpesaTill ? 'Till' : 'Paybill') + ' after ordering',
                    }
                  : {
                      value: p,
                      label: method === 'pickup' ? 'Pay when you collect' : 'Cash on delivery',
                      icon: <Banknote className="size-4" aria-hidden />,
                      note: method === 'pickup' ? 'Pay at the shop' : 'Pay the rider when your order arrives',
                    },
              )}
            />
          )}
          {payment === 'mpesa' && shop.registeredName && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-pos-soft p-3 text-sm text-ink">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pos" aria-hidden />
              <span>
                The M-Pesa prompt will show <strong className="font-semibold">{shop.registeredName}</strong>. Check the name before
                you enter your PIN.
              </span>
            </p>
          )}
        </Section>
      </div>

      {/* 4 · Summary */}
      <div className="lg:sticky lg:top-20">
        <Section step={4} title="Summary">
          <OrderSummary cart={cart} quote={freshQuote} busy={quoteBusy} locale={locale} method={method} taxMode={shop.taxMode} />
          {options && (
            <PolicyNote policy={options.policy} currency={shop.currency} locale={locale} delivers={shop.deliveryEnabled && method !== 'pickup'} />
          )}

          <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 -mx-2 hover:bg-sunken">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--ak-brand)]"
            />
            <span className="text-sm text-ink-2">Send me offers on WhatsApp/SMS. Reply STOP anytime.</span>
          </label>

          <AnimatePresence initial={false}>
            {placeOrder.isError && (
              <motion.p key="err" {...fade} role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-neg-soft p-3 text-sm text-neg">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{errorMessage(placeOrder.error)}</span>
              </motion.p>
            )}
            {showErrors && firstError && !placeOrder.isError && (
              <motion.p key="form-err" {...fade} role="alert" className="mt-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">
                {firstError}
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            type="submit"
            variant="brand"
            size="lg"
            loading={placeOrder.isPending}
            disabled={!freshQuote || placeOrder.isPending || methods.length === 0}
            className="mt-4 h-13 w-full rounded-2xl text-base"
          >
            {placeOrder.isPending
              ? 'Placing your order…'
              : freshQuote
                ? `Place order · ${fmtMoney(freshQuote.totalMinor, freshQuote.currency, locale)}`
                : quoteBusy
                  ? 'Checking total…'
                  : method === 'delivery' && !pin
                    ? 'Set your location to see your total'
                    : method === 'pickup_point' && !chosenPoint
                      ? 'Choose a pick-up point'
                    : outOfArea
                      ? 'Address is outside the delivery area'
                      : 'Place order'}
          </Button>
          <p className="mt-2 text-center text-xs text-ink-3">
            {freshQuote?.depositDueMinor && freshQuote.depositDueMinor > 0 && freshQuote.depositDueMinor < freshQuote.totalMinor
              ? `Nothing is charged yet. You pay the ${fmtMoney(freshQuote.depositDueMinor, freshQuote.currency, locale)} deposit on the next screen.`
              : payment === 'mpesa'
              ? 'Nothing is charged yet. You pay by M-Pesa on the next screen.'
              : payment === 'cod'
                ? 'Nothing is charged now.'
                : 'Nothing is charged now. The shop will contact you about payment.'}
          </p>

          <TrustBlock shop={shop} />
        </Section>
      </div>
    </form>
  )
}

/* ───────────── Pieces ───────────── */
function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: ReactNode }) {
  const id = `checkout-step-${step}`
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] sm:p-5 ak-rise">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-sm font-extrabold text-brand tnum" aria-hidden>
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-extrabold leading-7 tracking-tight">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

interface SegOption {
  value: string
  label: string
  icon: ReactNode
  note?: string
}

/** Radio group styled as segmented cards: native inputs keep keyboard (arrow keys) and screen-reader behaviour. */
function Segmented({
  legend,
  value,
  onChange,
  options,
  stacked,
}: {
  legend: string
  value: string
  onChange(v: string): void
  options: SegOption[]
  stacked?: boolean
}) {
  const name = `seg-${legend.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className={cn('grid gap-2', stacked ? 'grid-cols-1 sm:grid-cols-2' : options.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {options.map((o) => {
          const active = o.value === value
          return (
            <label
              key={o.value}
              className={cn(
                'relative flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                active ? 'border-brand bg-brand-soft/60' : 'border-line-strong bg-panel hover:bg-sunken',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={active}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', active ? 'bg-brand text-on-brand' : 'bg-sunken text-ink-2')}>
                {o.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{o.label}</span>
                {o.note && <span className="block text-xs text-ink-3">{o.note}</span>}
              </span>
              <span
                aria-hidden
                className={cn(
                  'absolute right-3 top-3 size-4 rounded-full border-2',
                  active ? 'border-brand bg-brand shadow-[inset_0_0_0_2px_var(--ak-panel)]' : 'border-line-strong',
                )}
              />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function DeliveryQuoteStatus({
  shop,
  pin,
  shopLocation,
  quote,
  busy,
  error,
  outOfArea,
  onRetry,
  showMap,
}: {
  shop: PublicShop
  pin: LatLng | null
  shopLocation: LatLng | null
  quote: Quote | null
  busy: boolean
  error: unknown
  outOfArea: boolean
  onRetry(): void
  /** The zone map pulls in MapLibre, so it stays off unless the buyer asked for a map. */
  showMap: boolean
}) {
  const locale = shop.locale || 'en'
  if (!pin) {
    return (
      <p className="rounded-xl bg-sunken p-3 text-sm text-ink-2">
        {shop.deliveryBands.length > 0
          ? `Delivery from ${fmtMoney(Math.min(...shop.deliveryBands.map((b) => b.feeMinor)), shop.currency, locale)}, priced by distance from the shop.`
          : 'The delivery fee appears once your location is set.'}
      </p>
    )
  }
  if (outOfArea) {
    const bands = [...shop.deliveryBands].sort((a, b) => a.maxKm - b.maxKm)
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3">
        <p className="flex items-start gap-2 text-sm text-warn">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {errorMessage(error)}.{' '}
            {shop.pickupEnabled ? 'Move the pin closer to the shop, or choose pickup.' : 'Move the pin closer to the shop.'}
          </span>
        </p>
        {showMap && shopLocation && (
          <Suspense fallback={<MapFallback height={200} />}>
            <StaticMap
              markers={[
                { ...shopLocation, kind: 'shop', label: shop.locationLabel ?? shop.name },
                { ...pin, kind: 'drop', label: 'Your pin' },
              ]}
              circles={bands.map((b) => ({
                ...shopLocation,
                radiusKm: b.maxKm,
                label: `Up to ${b.maxKm} km: ${fmtMoney(b.feeMinor, shop.currency, locale)}`,
              }))}
              height={200}
            />
          </Suspense>
        )}
        {bands.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs text-ink-2">
            {bands.map((b) => (
              <li key={b.maxKm} className="rounded-md bg-panel px-2 py-1 tnum">
                Up to {b.maxKm} km · {b.feeMinor === 0 ? 'Free' : fmtMoney(b.feeMinor, shop.currency, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-neg-soft p-3 text-sm text-neg">
        <span>{errorMessage(error)}</span>
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<RotateCcw className="size-3.5" aria-hidden />}>
          Retry
        </Button>
      </div>
    )
  }
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-xl bg-sunken px-3 py-2.5" aria-live="polite">
      <Bike className="size-5 shrink-0 text-brand" aria-hidden />
      {busy || !quote ? (
        <span className="inline-flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking delivery to your pin…
        </span>
      ) : (
        <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="text-ink-2">
            {quote.distanceKm != null ? (
              <>
                <span className="tnum font-semibold text-ink">{quote.distanceKm.toFixed(1)} km</span> from the shop
              </>
            ) : (
              'Delivery available'
            )}
          </span>
          <span className="font-semibold text-ink tnum">
            {quote.deliveryFeeMinor === 0 ? 'Free delivery' : `Delivery ${fmtMoney(quote.deliveryFeeMinor, quote.currency, locale)}`}
          </span>
        </span>
      )}
    </div>
  )
}

function OrderSummary({
  cart,
  quote,
  busy,
  locale,
  method,
  taxMode,
}: {
  cart: UseCartResult
  quote: Quote | null
  busy: boolean
  locale: string
  method: Method | null
  taxMode: PublicShop['taxMode']
}) {
  const currency = quote?.currency ?? cart.currency ?? 'USD'
  const imageByVariant = new Map(cart.lines.map((l) => [l.variantId, l.image]))
  const lines = quote
    ? // Line totalMinor from the server includes exclusive tax; show pre-tax amounts so lines add up to the subtotal.
      quote.lines.map((l) => ({ id: l.variantId, name: l.name, variant: l.variant, quantity: l.quantity, totalMinor: l.unitPriceMinor * l.quantity }))
    : cart.lines.map((l) => ({
        id: l.variantId,
        name: l.name,
        variant: l.variantName,
        quantity: l.quantity,
        totalMinor: l.unitPriceMinor * l.quantity,
      }))
  const effectiveTaxMode = quote?.taxMode ?? taxMode
  const money = (minor: number) => fmtMoney(minor, currency, locale)

  return (
    <div>
      <ul className="flex flex-col gap-3" aria-label="Items in your order">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <div className="relative shrink-0">
              <ProductImg src={imageByVariant.get(l.id) ?? null} name={l.name} className="size-12 rounded-xl object-cover" initialClassName="text-lg" />
              <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] font-bold text-canvas tnum">
                {l.quantity}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-ink">{l.name}</p>
              {l.variant && l.variant !== 'Default' && <p className="truncate text-xs text-ink-3">{l.variant}</p>}
            </div>
            <span className="text-sm font-semibold text-ink tnum">{money(l.totalMinor)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
        <Row label="Subtotal" value={money(quote?.subtotalMinor ?? cart.subtotalMinor)} />
        {effectiveTaxMode === 'exclusive' && (
          <Row label="Tax" value={quote ? money(quote.taxMinor) : <Skeleton className="h-4 w-14" />} />
        )}
        <Row
          label={method === 'pickup' ? 'Pickup' : 'Delivery'}
          value={
            quote ? (
              quote.deliveryFeeMinor === 0 ? (
                <span className="font-semibold text-pos">Free</span>
              ) : (
                money(quote.deliveryFeeMinor)
              )
            ) : method === 'delivery' || method === 'pickup_point' ? (
              <span className="text-ink-3">{busy ? 'Calculating…' : method === 'delivery' ? 'Set location' : 'Choose a point'}</span>
            ) : (
              <Skeleton className="h-4 w-14" />
            )
          }
        />
      </dl>

      <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-sunken p-4" aria-live="polite">
        <div>
          <p className="text-sm font-semibold text-ink">Total</p>
          <p className="text-xs text-ink-3">
            {effectiveTaxMode === 'inclusive'
              ? quote && quote.taxMinor > 0
                ? `Includes ${money(quote.taxMinor)} tax`
                : 'Prices include any tax'
              : 'Including tax and delivery'}
          </p>
        </div>
        {quote ? (
          <motion.p
            key={quote.totalMinor}
            initial={{ opacity: 0.4, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="font-display text-3xl font-extrabold leading-none tracking-tight text-ink tnum"
          >
            {money(quote.totalMinor)}
          </motion.p>
        ) : (
          <Skeleton className="h-8 w-28" />
        )}
      </div>
      {quote && (quote.depositDueMinor ?? 0) > 0 && (
        <dl className="mt-2 flex flex-col gap-1.5 rounded-2xl border border-brand/25 p-3 text-sm" aria-label="How you pay">
          <div className="flex items-center justify-between gap-3">
            <dt className="font-semibold text-ink">{(quote.depositDueMinor ?? 0) >= quote.totalMinor ? 'Pay now (full amount)' : 'Deposit due now'}</dt>
            <dd className="font-display text-lg font-extrabold tracking-tight text-ink tnum">{money(quote.depositDueMinor ?? 0)}</dd>
          </div>
          {(quote.balanceOnDeliveryMinor ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">{method === 'pickup' ? 'Balance when you collect' : 'Balance on delivery'}</dt>
              <dd className="font-semibold text-ink tnum">{money(quote.balanceOnDeliveryMinor ?? 0)}</dd>
            </div>
          )}
        </dl>
      )}
      {quote && (quote.depositDueMinor ?? 0) === 0 && quote.paymentMode && (
        <p className="mt-2 text-xs text-ink-3">Nothing is due before {method === 'pickup' ? 'you collect' : 'delivery'}.</p>
      )}
      {!quote && <p className="mt-2 text-xs text-ink-3">Your full total, including delivery, appears here before you place the order.</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-ink tnum">{value}</dd>
    </div>
  )
}

function TrustBlock({ shop }: { shop: PublicShop }) {
  const items: { icon: ReactNode; title: string; body: string }[] = []
  if (shop.registeredName) {
    items.push({
      icon: <ShieldCheck className="size-4 text-pos" aria-hidden />,
      title: `Paying ${shop.registeredName}`,
      body: shop.mpesaTill
        ? `Registered name on M-Pesa Till ${shop.mpesaTill}.`
        : shop.mpesaPaybill
          ? `Registered name on M-Pesa Paybill ${shop.mpesaPaybill}.`
          : 'Registered business name.',
    })
  }
  if (shop.returnPolicy) {
    items.push({ icon: <RotateCcw className="size-4 text-ink-2" aria-hidden />, title: 'Returns', body: shop.returnPolicy })
  }
  if (shop.locationLabel) {
    items.push({ icon: <MapPin className="size-4 text-ink-2" aria-hidden />, title: 'Based in', body: shop.locationLabel })
  }
  if (items.length === 0) return null
  return (
    <ul className="mt-5 flex flex-col gap-3 border-t border-line pt-4" aria-label="About this seller">
      {items.map((it) => (
        <li key={it.title} className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0">{it.icon}</span>
          <div className="min-w-0 text-xs">
            <p className="font-semibold text-ink">{it.title}</p>
            <p className="whitespace-pre-line text-ink-3">{it.body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
