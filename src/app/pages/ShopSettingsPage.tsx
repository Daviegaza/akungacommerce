import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CountryCode } from 'libphonenumber-js/min'
import { AtSign, Check, Copy, Download, ExternalLink, MapPin, MessageCircle, Plus, Store, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { formatPhone, toE164 } from '@/domain/locale'
import { formatMoney, money, parseMajor, toMajorString } from '@/domain/money'
import type { ShopSettings } from '@/gateway/storefront'
import { MapFallback, PinPicker, StaticMap, type LatLng } from '@/maps'
import { BRAND } from '@/brand/brand'
import { DeliveryRulesSection, PickupPointsSection } from '../components/DeliveryRules'
import { useAction, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
import { Badge, Button, Field, Input, Skeleton, Switch, Textarea, buttonClass } from '../ui/primitives'

/* ───────────── Constants & helpers ───────────── */

/** Mirrors the SQL check on shop_settings.slug. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const HTTPS_RE = /^https:\/\/\S+$/
const MPESA_RE = /^\d{5,8}$/
const MAX_KM = 500

/** Map centre when the shop has no pin yet: the business country's main commercial city. */
const COUNTRY_CENTER: Record<string, LatLng> = {
  KE: { lat: -1.2864, lng: 36.8172 },
  UG: { lat: 0.3476, lng: 32.5825 },
  TZ: { lat: -6.7924, lng: 39.2083 },
  RW: { lat: -1.9441, lng: 30.0619 },
  ET: { lat: 8.9806, lng: 38.7578 },
  NG: { lat: 6.5244, lng: 3.3792 },
  GH: { lat: 5.6037, lng: -0.187 },
  ZA: { lat: -26.2041, lng: 28.0473 },
  EG: { lat: 30.0444, lng: 31.2357 },
  GB: { lat: 51.5072, lng: -0.1276 },
  US: { lat: 40.7128, lng: -74.006 },
  IN: { lat: 19.076, lng: 72.8777 },
  AE: { lat: 25.2048, lng: 55.2708 },
}

function suggestSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return base.length >= 3 ? base : `${base || 'shop'}-shop`.slice(0, 40)
}

function shopUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`
}

/* ───────────── Form model ───────────── */

interface BandRow {
  id: string
  km: string
  fee: string
}

interface Form {
  slug: string
  published: boolean
  tagline: string
  about: string
  coverUrl: string
  logoUrl: string
  whatsapp: string
  registeredName: string
  location: LatLng | null
  locationLabel: string
  pickupEnabled: boolean
  deliveryEnabled: boolean
  bands: BandRow[]
  deliveryPromise: string
  codEnabled: boolean
  mpesaTill: string
  mpesaPaybill: string
  returnPolicy: string
}

type FieldKey =
  | 'slug'
  | 'coverUrl'
  | 'logoUrl'
  | 'whatsapp'
  | 'registeredName'
  | 'location'
  | 'methods'
  | 'bands'
  | 'mpesaTill'
  | 'mpesaPaybill'
  | 'payments'
type Errors = Partial<Record<FieldKey, string>> & { bandRows?: Record<string, { km?: string; fee?: string }> }

function toForm(s: ShopSettings | null, orgName: string, currency: string): Form {
  return {
    slug: s?.slug ?? suggestSlug(orgName),
    published: s?.published ?? false,
    tagline: s?.tagline ?? '',
    about: s?.about ?? '',
    coverUrl: s?.coverUrl ?? '',
    logoUrl: s?.logoUrl ?? '',
    whatsapp: s?.whatsappE164 ? formatPhone(s.whatsappE164) : '',
    registeredName: s?.registeredName ?? '',
    location: s && s.locationLat != null && s.locationLng != null ? { lat: s.locationLat, lng: s.locationLng } : null,
    locationLabel: s?.locationLabel ?? '',
    pickupEnabled: s?.pickupEnabled ?? true,
    deliveryEnabled: s?.deliveryEnabled ?? false,
    bands: (s?.deliveryBands ?? []).map((b, i) => ({
      id: `b${i}`,
      km: String(b.maxKm),
      fee: toMajorString(money(b.feeMinor, currency)),
    })),
    deliveryPromise: s?.deliveryPromise ?? '',
    codEnabled: s?.codEnabled ?? false,
    mpesaTill: s?.mpesaTill ?? '',
    mpesaPaybill: s?.mpesaPaybill ?? '',
    returnPolicy: s?.returnPolicy ?? '',
  }
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)

/** Validate the form; returns field errors and, when valid, the settings to save. */
function validate(f: Form, countryCode: string, currency: string): { errors: Errors; settings: ShopSettings | null } {
  const errors: Errors = {}
  const slug = f.slug.trim().toLowerCase()
  if (!SLUG_RE.test(slug)) errors.slug = '3–40 characters: lowercase letters, numbers and hyphens, not starting or ending with a hyphen.'

  if (f.coverUrl.trim() && !HTTPS_RE.test(f.coverUrl.trim())) errors.coverUrl = 'Use an https:// image link.'
  if (f.logoUrl.trim() && !HTTPS_RE.test(f.logoUrl.trim())) errors.logoUrl = 'Use an https:// image link.'

  let whatsappE164: string | null = null
  if (f.whatsapp.trim()) {
    const r = toE164(f.whatsapp, countryCode as CountryCode)
    if (r.ok) whatsappE164 = r.e164
    else errors.whatsapp = r.error
  }

  if (f.mpesaTill.trim() && !MPESA_RE.test(f.mpesaTill.trim())) errors.mpesaTill = 'A Till number is 5–8 digits.'
  if (f.mpesaPaybill.trim() && !MPESA_RE.test(f.mpesaPaybill.trim())) errors.mpesaPaybill = 'A Paybill number is 5–8 digits.'

  const bandRows: NonNullable<Errors['bandRows']> = {}
  const bands: ShopSettings['deliveryBands'] = []
  let prev = 0
  for (const row of f.bands) {
    const rowErr: { km?: string; fee?: string } = {}
    const km = Number(row.km.trim())
    if (!row.km.trim() || !Number.isFinite(km) || km <= 0) rowErr.km = 'Enter a distance above 0.'
    else if (km > MAX_KM) rowErr.km = `Max ${MAX_KM} km.`
    else if (km <= prev) rowErr.km = 'Must be further than the row above.'
    let feeMinor = 0
    try {
      feeMinor = parseMajor(row.fee || '0', currency).amountMinor
      if (feeMinor < 0) rowErr.fee = 'Fee can’t be negative.'
    } catch (e) {
      rowErr.fee = e instanceof Error ? e.message : 'Not a valid amount.'
    }
    if (rowErr.km || rowErr.fee) bandRows[row.id] = rowErr
    if (!rowErr.km) prev = km
    bands.push({ maxKm: km, feeMinor })
  }
  if (Object.keys(bandRows).length) errors.bandRows = bandRows

  if (f.deliveryEnabled && f.bands.length === 0) errors.bands = 'Add at least one distance band, or turn delivery off.'
  if (f.published) {
    if (!f.pickupEnabled && !f.deliveryEnabled) errors.methods = 'Turn on pickup or delivery so buyers can get their order.'
    if (f.deliveryEnabled && !f.location)
      errors.location = 'Drop your shop pin before going live with delivery — Rafu measures each buyer’s distance from it to price delivery.'
    if (!f.mpesaTill.trim() && !f.mpesaPaybill.trim() && !f.codEnabled)
      errors.payments = 'Add a Till or Paybill number, or allow cash on delivery, so buyers have a way to pay.'
  }

  const valid = Object.keys(errors).length === 0
  return {
    errors,
    settings: valid
      ? {
          slug,
          published: f.published,
          tagline: orNull(f.tagline),
          about: orNull(f.about),
          coverUrl: orNull(f.coverUrl),
          logoUrl: orNull(f.logoUrl),
          whatsappE164,
          registeredName: orNull(f.registeredName),
          locationLat: f.location?.lat ?? null,
          locationLng: f.location?.lng ?? null,
          locationLabel: orNull(f.locationLabel),
          pickupEnabled: f.pickupEnabled,
          deliveryEnabled: f.deliveryEnabled,
          deliveryBands: bands,
          deliveryPromise: orNull(f.deliveryPromise),
          codEnabled: f.codEnabled,
          mpesaTill: orNull(f.mpesaTill),
          mpesaPaybill: orNull(f.mpesaPaybill),
          returnPolicy: orNull(f.returnPolicy),
        }
      : null,
  }
}

/* ───────────── Page ───────────── */

export default function ShopSettingsPage() {
  const query = useOrgQuery('shop', (g, o) => g.getShopSettings(o))

  return (
    <div className="ak-rise">
      <PageHeader title="My shop" description="Your public shop link, how it looks, how buyers pay and how orders reach them." />
      {query.isPending ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => query.refetch()} />
      ) : (
        // Remount when the saved settings change so the form always starts from what is stored.
        <ShopForm key={JSON.stringify(query.data)} saved={query.data ?? null} />
      )}
      <DeliveryRulesSection />
      <PickupPointsSection />
    </div>
  )
}

function ShopForm({ saved }: { saved: ShopSettings | null }) {
  const { org, can } = useOrg()
  const qc = useQueryClient()
  const readOnly = !can('org.manage')
  const currency = org.baseCurrency
  const [form, setForm] = useState<Form>(() => toForm(saved, org.name, currency))
  const [errors, setErrors] = useState<Errors>({})
  const [justSaved, setJustSaved] = useState(false)
  const nextBandId = useRef(form.bands.length)
  const save = useAction<ShopSettings>((g, o, s) => g.saveShopSettings(o, s))

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setJustSaved(false)
  }

  const initial = useMemo(() => JSON.stringify(toForm(saved, org.name, currency)), [saved, org.name, currency])
  const dirty = JSON.stringify(form) !== initial

  const slugTaken = save.error instanceof Error && /already taken/i.test(save.error.message)
  const slugError = errors.slug ?? (slugTaken ? 'That shop link is already taken. Try adding your town or a word, e.g. ' + `${suggestSlug(org.name)}-ke` : undefined)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    const { errors: errs, settings } = validate(form, org.countryCode, currency)
    setErrors(errs)
    if (!settings) return
    save.mutate(settings, {
      onSuccess: () => {
        setJustSaved(true)
        void qc.invalidateQueries({ queryKey: [org.id, 'shop'] })
      },
    })
  }

  const center = form.location ?? COUNTRY_CENTER[org.countryCode] ?? COUNTRY_CENTER.KE
  const validBands = form.bands
    .map((b) => ({ km: Number(b.km), id: b.id }))
    .filter((b) => Number.isFinite(b.km) && b.km > 0 && b.km <= MAX_KM)
  const pin = form.location
  const bandCircles = pin ? validBands.map((b) => ({ lat: pin.lat, lng: pin.lng, radiusKm: b.km, label: `${b.km} km` })) : []

  const savedLive = saved?.published ? saved.slug : null
  const errorCount = Object.keys(errors).filter((k) => k !== 'bandRows').length + Object.keys(errors.bandRows ?? {}).length

  return (
    <form onSubmit={onSubmit} noValidate className="pb-24">
      {readOnly && (
        <div className="mb-6">
          <Notice>You can view the shop settings. Only owners and admins can change them.</Notice>
        </div>
      )}

      <ShopPreviewHeader form={form} orgName={org.name} />

      {/* Publish status */}
      <div className="mt-5 mb-10 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {savedLive ? (
              <Badge tone="pos" dot>
                Live
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Not published
              </Badge>
            )}
            {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-ink-2">
            {savedLive ? (
              <>
                Live at{' '}
                <a href={shopUrl(savedLive)} target="_blank" rel="noreferrer" className="font-medium break-all text-ink underline underline-offset-2">
                  {shopUrl(savedLive).replace(/^https?:\/\//, '')}
                </a>
              </>
            ) : (
              'Only you can see this shop. Publish it when you’re ready for buyers.'
            )}
          </p>
          {form.published !== Boolean(saved?.published) && (
            <p className="mt-1 text-xs text-ink-3">{form.published ? 'Goes live when you save.' : 'Will be hidden from buyers when you save.'}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {saved?.slug && (
            <a href={`/s/${saved.slug}`} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md')}>
              <ExternalLink className="size-4" aria-hidden />
              Preview shop
            </a>
          )}
          <div className="w-44">
            <Switch checked={form.published} onChange={(v) => set('published', v)} label="Publish shop" disabled={readOnly} />
          </div>
        </div>
      </div>

      {savedLive && <ShareKit slug={savedLive} shopName={org.name} tagline={saved?.tagline ?? null} />}

      <fieldset disabled={readOnly} className="min-w-0">
        <Section title="Shop link" description="The address you share on WhatsApp, Instagram and TikTok.">
          <Field
            label="Shop link"
            error={slugError}
            hint={`3–40 characters: lowercase letters, numbers and hyphens. Changing it later breaks links you've already shared.`}
          >
            {(p) => (
              <div className="flex items-stretch overflow-hidden rounded-lg border border-line-strong focus-within:border-ink">
                <span className="hidden items-center bg-sunken px-3 text-sm text-ink-3 sm:flex">{window.location.host}/s/</span>
                <Input
                  {...p}
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={40}
                  className="rounded-none border-0"
                />
              </div>
            )}
          </Field>
          {form.slug !== suggestSlug(org.name) && (
            <button type="button" onClick={() => set('slug', suggestSlug(org.name))} className="mt-2 text-xs font-medium text-ink-2 underline underline-offset-2">
              Use “{suggestSlug(org.name)}”
            </button>
          )}
        </Section>

        <Section title="Look" description="Photos sell. A wide cover and a clear logo make the shop feel real.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cover image link" optional error={errors.coverUrl} hint="An https:// image, landscape works best.">
              {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://…" value={form.coverUrl} onChange={(e) => set('coverUrl', e.target.value)} />}
            </Field>
            <Field label="Logo image link" optional error={errors.logoUrl} hint="Square image. We show your first letter if empty.">
              {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://…" value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />}
            </Field>
            <Field label="Tagline" optional className="sm:col-span-2" hint={`${form.tagline.length}/80`}>
              {(p) => (
                <Input {...p} maxLength={80} placeholder="Handmade cushions and throws, delivered in Nairobi" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
              )}
            </Field>
            <Field label="About" optional className="sm:col-span-2" hint="Who you are, what you make, where you are.">
              {(p) => <Textarea {...p} rows={4} maxLength={1000} value={form.about} onChange={(e) => set('about', e.target.value)} />}
            </Field>
          </div>
        </Section>

        <Section title="Contact & trust" description="Buyers of small shops worry about scams. These details answer that worry.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp number" optional error={errors.whatsapp} hint="Buyers can send their order to this number.">
              {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />}
            </Field>
            <Field
              label="Registered business name"
              optional
              error={errors.registeredName}
              hint="Exactly as it appears on the M-Pesa prompt or Till. Buyers check this name before entering their PIN — when it matches, they trust you."
            >
              {(p) => <Input {...p} placeholder="MTO HOME ENTERPRISES" value={form.registeredName} onChange={(e) => set('registeredName', e.target.value)} />}
            </Field>
          </div>
        </Section>

        <Section title="Location" description="Drop a pin on your shop or dispatch point. Buyers see the area, and delivery fees are measured from here.">
          <div className="space-y-4">
            {readOnly ? (
              form.location ? (
                <Suspense fallback={<MapFallback height={280} />}>
                  <StaticMap markers={[{ ...form.location, kind: 'shop', label: org.name }]} height={280} />
                </Suspense>
              ) : (
                <p className="text-sm text-ink-3">No pin set yet.</p>
              )
            ) : (
              <Suspense fallback={<MapFallback height={320} />}>
                <PinPicker value={form.location} onChange={(v) => set('location', v)} center={center} zoom={form.location ? 15 : 12} height={320} label="Shop location" />
              </Suspense>
            )}
            {errors.location && (
              <p role="alert" className="text-xs font-medium text-neg">
                {errors.location}
              </p>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Field label="Location label" optional className="flex-1" hint="Shown to buyers, e.g. “Westlands, near Sarit Centre”.">
                {(p) => <Input {...p} maxLength={120} value={form.locationLabel} onChange={(e) => set('locationLabel', e.target.value)} />}
              </Field>
              {form.location && !readOnly && (
                <Button variant="ghost" onClick={() => set('location', null)} icon={<MapPin className="size-4" aria-hidden />}>
                  Clear pin
                </Button>
              )}
            </div>
          </div>
        </Section>

        <Section title="Delivery" description="How orders reach buyers. The fee is added before they pay — never as a surprise.">
          <div className="space-y-5">
            <div className="max-w-lg space-y-4">
              <Switch checked={form.pickupEnabled} onChange={(v) => set('pickupEnabled', v)} label="Pickup" description="Buyers collect from your location." disabled={readOnly} />
              <Switch
                checked={form.deliveryEnabled}
                onChange={(v) => set('deliveryEnabled', v)}
                label="Delivery"
                description="Priced by straight-line distance from your pin."
                disabled={readOnly}
              />
              {errors.methods && (
                <p role="alert" className="text-xs font-medium text-neg">
                  {errors.methods}
                </p>
              )}
            </div>

            {form.deliveryEnabled && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-ink">Distance bands</h3>
                  <p className="mb-3 text-xs text-ink-3">Each row covers buyers up to that distance. Further than your last row = no delivery.</p>
                  <ul className="space-y-2">
                    {form.bands.map((row, i) => {
                      const rowErr = errors.bandRows?.[row.id]
                      return (
                        <li key={row.id} className="flex flex-wrap items-start gap-2">
                          <label className="flex items-center gap-2 text-sm text-ink-2">
                            <span className="w-12 shrink-0">Up to</span>
                            <Input
                              aria-label={`Band ${i + 1} distance in km`}
                              aria-invalid={rowErr?.km ? true : undefined}
                              inputMode="decimal"
                              value={row.km}
                              onChange={(e) => set('bands', form.bands.map((b) => (b.id === row.id ? { ...b, km: e.target.value } : b)))}
                              className="tnum w-20"
                            />
                            <span>km</span>
                          </label>
                          <span className="mt-2.5 text-ink-3" aria-hidden>
                            →
                          </span>
                          <label className="flex items-center gap-2 text-sm text-ink-2">
                            <span className="sr-only">Band {i + 1} fee</span>
                            <span className="text-ink-3">{currency}</span>
                            <Input
                              aria-label={`Band ${i + 1} fee in ${currency}`}
                              aria-invalid={rowErr?.fee ? true : undefined}
                              inputMode="decimal"
                              value={row.fee}
                              onChange={(e) => set('bands', form.bands.map((b) => (b.id === row.id ? { ...b, fee: e.target.value } : b)))}
                              className="tnum w-28"
                            />
                          </label>
                          <Button
                            variant="ghost"
                            aria-label={`Remove band ${i + 1}`}
                            onClick={() => set('bands', form.bands.filter((b) => b.id !== row.id))}
                            className="px-2"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                          {(rowErr?.km || rowErr?.fee) && (
                            <p role="alert" className="w-full text-xs font-medium text-neg">
                              {[rowErr.km, rowErr.fee].filter(Boolean).join(' ')}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {errors.bands && (
                    <p role="alert" className="mt-2 text-xs font-medium text-neg">
                      {errors.bands}
                    </p>
                  )}
                  {!readOnly && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      icon={<Plus className="size-4" aria-hidden />}
                      onClick={() => {
                        const last = Number(form.bands.at(-1)?.km)
                        const km = Number.isFinite(last) && last > 0 ? Math.min(MAX_KM, last + 5) : 3
                        set('bands', [...form.bands, { id: `b${nextBandId.current++}`, km: String(km), fee: '' }])
                      }}
                    >
                      Add band
                    </Button>
                  )}
                </div>

                {form.location ? (
                  <div>
                    <Suspense fallback={<MapFallback height={300} />}>
                      <StaticMap
                        markers={[{ ...form.location, kind: 'shop', label: org.name }]}
                        circles={bandCircles}
                        height={300}
                      />
                    </Suspense>
                    {validBands.length > 0 && (
                      <p className="mt-2 text-xs text-ink-3">
                        {form.bands
                          .map((b) => {
                            try {
                              return `up to ${b.km} km: ${formatMoney(parseMajor(b.fee || '0', currency), org.locale)}`
                            } catch {
                              return null
                            }
                          })
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <Notice tone="warn">Drop your shop pin under Location to see your delivery zones on the map.</Notice>
                )}

                <Field label="Delivery promise" optional hint="Only promise what you can keep. Shown on products and checkout.">
                  {(p) => (
                    <Input {...p} maxLength={80} placeholder="Same-day in Nairobi before 2pm" value={form.deliveryPromise} onChange={(e) => set('deliveryPromise', e.target.value)} />
                  )}
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section title="Payments" description="How buyers pay you.">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="M-Pesa Till number" optional error={errors.mpesaTill} hint="Buy Goods, 5–8 digits.">
                {(p) => <Input {...p} inputMode="numeric" className="tnum" value={form.mpesaTill} onChange={(e) => set('mpesaTill', e.target.value.replace(/\D/g, ''))} maxLength={8} />}
              </Field>
              <Field label="M-Pesa Paybill number" optional error={errors.mpesaPaybill} hint="5–8 digits. Buyers use the order number as the account.">
                {(p) => <Input {...p} inputMode="numeric" className="tnum" value={form.mpesaPaybill} onChange={(e) => set('mpesaPaybill', e.target.value.replace(/\D/g, ''))} maxLength={8} />}
              </Field>
            </div>
            <div className="max-w-lg">
              <Switch checked={form.codEnabled} onChange={(v) => set('codEnabled', v)} label="Cash on delivery" description="Buyers pay the rider or at pickup." disabled={readOnly} />
            </div>
            {errors.payments && (
              <p role="alert" className="text-xs font-medium text-neg">
                {errors.payments}
              </p>
            )}
            <Notice>
              {BRAND.name} shows these to buyers. Automatic M-Pesa confirmation needs Daraja setup — until then you confirm payments yourself.
            </Notice>
          </div>
        </Section>

        <Section title="Returns policy" description="Plain words beat legal text. Buyers read this before they pay.">
          <Field label="Returns policy" optional hint="e.g. “Exchange within 7 days if unused, with the tags on. Buyer pays return delivery.”">
            {(p) => <Textarea {...p} rows={4} maxLength={1500} value={form.returnPolicy} onChange={(e) => set('returnPolicy', e.target.value)} />}
          </Field>
        </Section>
      </fieldset>

      {!readOnly && (
        <div
          className={`mt-2 flex flex-col gap-2 rounded-2xl border border-line bg-panel/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between ${
            dirty || save.isError || errorCount > 0 ? 'sticky bottom-20 z-10 shadow-[var(--shadow-lift)] lg:bottom-4' : ''
          }`}
        >
          <div className="min-w-0 text-sm" aria-live="polite">
            {save.isError && !slugTaken ? (
              <span className="font-medium text-neg">{save.error instanceof Error ? save.error.message : 'Could not save.'}</span>
            ) : errorCount > 0 ? (
              <span className="font-medium text-neg">Fix {errorCount === 1 ? 'the highlighted field' : `${errorCount} highlighted fields`} to save.</span>
            ) : slugTaken ? (
              <span className="font-medium text-neg">That shop link is already taken.</span>
            ) : justSaved ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-pos">
                <Check className="size-4" aria-hidden /> Saved
              </span>
            ) : dirty ? (
              <span className="text-ink-2">You have unsaved changes.</span>
            ) : (
              <span className="text-ink-3">All changes saved.</span>
            )}
          </div>
          <Button type="submit" variant="brand" loading={save.isPending} disabled={!dirty && !save.isError}>
            Save shop
          </Button>
        </div>
      )}
    </form>
  )
}

/* ───────────── Preview header ───────────── */

function ShopPreviewHeader({ form, orgName }: { form: Form; orgName: string }) {
  const cover = HTTPS_RE.test(form.coverUrl.trim()) ? form.coverUrl.trim() : null
  const logo = HTTPS_RE.test(form.logoUrl.trim()) ? form.logoUrl.trim() : null
  const [brokenCover, setBrokenCover] = useState<string | null>(null)
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const showCover = cover && brokenCover !== cover
  const showLogo = logo && brokenLogo !== logo

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
      <div className="relative h-32 bg-brand-soft sm:h-44">
        {showCover ? (
          <img src={cover} alt="" className="size-full object-cover" onError={() => setBrokenCover(cover)} />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-ink-3">
            {cover && brokenCover === cover ? 'That cover link didn’t load an image.' : 'Add a cover image to make your shop feel alive.'}
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">Preview</span>
      </div>
      <div className="flex items-end gap-4 px-4 pb-4 sm:px-5">
        <div className="-mt-8 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-panel bg-brand text-2xl font-extrabold text-on-brand sm:size-20">
          {showLogo ? (
            <img src={logo} alt="" className="size-full object-cover" onError={() => setBrokenLogo(logo)} />
          ) : (
            <span className="font-display">{(orgName.trim()[0] ?? 'R').toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 pt-3">
          <p className="font-display truncate text-xl font-extrabold tracking-tight text-ink">{orgName}</p>
          <p className="truncate text-sm text-ink-3">{form.tagline.trim() || 'Add a tagline so buyers know what you sell.'}</p>
        </div>
      </div>
    </div>
  )
}

/* ───────────── Share kit ───────────── */

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
    } catch {
      setCopied(`${key}:failed`)
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 2000)
  }
  return { copied, copy }
}

function ShareKit({ slug, shopName, tagline }: { slug: string; shopName: string; tagline: string | null }) {
  const link = shopUrl(slug)
  const [qr, setQr] = useState<{ link: string; url: string } | null>(null)
  const [qrError, setQrError] = useState(false)
  const { copied, copy } = useCopy()

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#160F1E', light: '#FFFFFF' } })
      .then((url) => alive && setQr({ link, url }))
      .catch(() => alive && setQrError(true))
    return () => {
      alive = false
    }
  }, [link])

  const message = `${shopName}${tagline ? ` — ${tagline}` : ''}\nBrowse and order here: ${link}`
  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`
  const qrUrl = qr?.link === link ? qr.url : null

  const copyLabel = (key: string, idle: string) =>
    copied === key ? 'Copied' : copied === `${key}:failed` ? 'Copy failed — select the link' : idle

  return (
    <Section title="Share kit" description="Your shop is live. Put the link everywhere your buyers already are.">
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl bg-brand-soft p-4">
            <p className="text-xs font-medium text-ink-2">Your shop link</p>
            <p className="font-display mt-1 text-xl font-extrabold tracking-tight break-all text-ink select-all sm:text-2xl">{link.replace(/^https?:\/\//, '')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="brand" icon={copied === 'link' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} onClick={() => copy('link', link)}>
                {copyLabel('link', 'Copy link')}
              </Button>
              <a href={waHref} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md')}>
                <MessageCircle className="size-4 text-[#25D366]" aria-hidden />
                Share on WhatsApp
              </a>
              <Button variant="secondary" icon={<AtSign className="size-4" aria-hidden />} onClick={() => copy('ig', link)}>
                {copyLabel('ig', 'Copy Instagram bio link')}
              </Button>
              <a href={`/s/${slug}`} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'md')}>
                <Store className="size-4" aria-hidden />
                Preview shop
              </a>
            </div>
            <span className="sr-only" aria-live="polite">
              {copied && !copied.endsWith(':failed') ? 'Copied to clipboard' : ''}
            </span>
          </div>
          <ShareTip title="WhatsApp Status">Download the QR below, post it to your Status, and paste your link as the caption. Status posts last 24 hours — re-post when you add new stock.</ShareTip>
          <ShareTip title="Instagram & TikTok">Paste the link in your bio, then say “link in bio” on posts. Tap “Copy Instagram bio link” above.</ShareTip>
          <ShareTip title="In person">Print the QR for your stall, packaging or receipts. Buyers scan it with their phone camera.</ShareTip>
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-48 items-center justify-center rounded-2xl border border-line bg-white p-2">
            {qrUrl ? (
              <img src={qrUrl} alt={`QR code for ${link}`} className="size-full" />
            ) : qrError ? (
              <p className="px-3 text-center text-xs text-neg">Couldn’t draw the QR code. Your link still works.</p>
            ) : (
              <Skeleton className="size-full" />
            )}
          </div>
          {qrUrl && (
            <a href={qrUrl} download={`${slug}-shop-qr.png`} className={buttonClass('secondary', 'sm')}>
              <Download className="size-4" aria-hidden />
              Download QR (PNG)
            </a>
          )}
        </div>
      </div>
    </Section>
  )
}

function ShareTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-brand pl-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-2">{children}</p>
    </div>
  )
}
