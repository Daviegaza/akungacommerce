import { useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Banknote, Bike, CheckCircle2, ExternalLink, MapPin, Package, Phone, RefreshCw, Store, XCircle } from 'lucide-react'
import { Badge, Button, Field, Input, Select, Skeleton } from '@/app/ui/primitives'
import { FAILED_REASONS, FAILED_REASON_LABEL, type FailedReason } from '@/domain/delivery-policy'
import { formatDateTime } from '@/domain/locale'
import type { RiderAction, RiderJob } from '@/gateway/delivery'
import { getStorefrontGateway } from '@/storefront/gateway'
import { fmtMoney } from '@/storefront/components/storefront-utils'
import { LocationPreview } from '@/storefront/components/TrackDelivery'

/** /r/:token — account-free job page for the shop's own rider. */
const riderQueryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: true } } })

export default function RiderPage() {
  return (
    <QueryClientProvider client={riderQueryClient}>
      <div className="ak-root min-h-dvh bg-canvas">
        <RiderScreen />
      </div>
    </QueryClientProvider>
  )
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) return err.message
  return 'Something went wrong. Please try again.'
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

const STATUS_TEXT: Record<string, string> = {
  confirmed: 'Confirmed: waiting to be picked up',
  preparing: 'Being packed',
  ready: 'Packed and ready for pickup',
  dispatched: 'On the way to the buyer',
  delivered: 'Delivered',
  cancelled: 'Cancelled by the shop',
}

function RiderScreen() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['rider', token],
    queryFn: async () => (await getStorefrontGateway()).riderJob(token),
    enabled: Boolean(token),
  })
  const setJob = (job: RiderJob) => qc.setQueryData(['rider', token], job)

  if (query.isPending) {
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6" aria-busy="true" aria-label="Loading the delivery job">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-card)]" />
      </main>
    )
  }
  if (query.isError) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
        <AlertCircle className="size-8 text-neg" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">This delivery link can’t be opened</h1>
        <p className="text-sm text-ink-2">{errorMessage(query.error)}</p>
        <Button variant="secondary" onClick={() => void query.refetch()} icon={<RefreshCw className="size-4" aria-hidden />}>
          Try again
        </Button>
      </main>
    )
  }
  return <JobView token={token} job={query.data} onJob={setJob} />
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] ak-rise">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold tracking-tight">
        <span className="text-brand">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function JobView({ token, job, onJob }: { token: string; job: RiderJob; onJob(j: RiderJob): void }) {
  const money = (m: number) => fmtMoney(m, job.currency, job.locale)
  const pickupLoc = job.pickup.lat != null && job.pickup.lng != null ? { lat: job.pickup.lat, lng: job.pickup.lng } : null
  const dropLoc = job.drop.lat != null && job.drop.lng != null ? { lat: job.drop.lat, lng: job.drop.lng } : null
  const closed = job.status === 'delivered' || job.status === 'cancelled'

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 pb-16 pt-5">
      <header>
        <p className="text-sm text-ink-3">{job.shopName} · delivery job</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Order <span className="tnum">#{job.orderNumber}</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={job.status === 'delivered' ? 'pos' : job.status === 'cancelled' ? 'neg' : 'info'} dot>
            {STATUS_TEXT[job.status] ?? job.status}
          </Badge>
          {job.attempts > 0 && <Badge tone="warn">Attempt {Math.min(job.attempts + 1, job.maxAttempts)} of {job.maxAttempts}</Badge>}
        </div>
        <p className="mt-2 text-xs text-ink-3">Link works until {formatDateTime(job.expiresAt, job.locale, Intl.DateTimeFormat().resolvedOptions().timeZone)}. No account needed.</p>
      </header>

      <LocationPreview
        shopLoc={pickupLoc}
        dropLoc={dropLoc}
        shopLabel={job.pickup.label ?? job.shopName}
        dropLabel={job.drop.landmark}
        height={240}
      />

      <Card title="Pick up" icon={<Store className="size-4" aria-hidden />}>
        <p className="text-sm text-ink">{job.pickup.label ?? job.shopName}</p>
        <p className="text-xs text-ink-3">
          {job.itemCount} item{job.itemCount === 1 ? '' : 's'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {pickupLoc && (
            <a href={mapsLink(pickupLoc.lat, pickupLoc.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
              <ExternalLink className="size-4" aria-hidden /> Directions to shop
            </a>
          )}
          {job.pickup.shopPhone && (
            <a href={`tel:${job.pickup.shopPhone}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:underline">
              <Phone className="size-4" aria-hidden /> Call the shop
            </a>
          )}
        </div>
      </Card>

      <Card title="Drop off" icon={job.drop.pickupPoint ? <Package className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}>
        {job.drop.pickupPoint ? (
          <p className="text-sm text-ink">
            Pick-up point: <span className="font-semibold">{job.drop.pickupPoint.name}</span>
            {job.drop.pickupPoint.area ? `, ${job.drop.pickupPoint.area}` : ''}
          </p>
        ) : (
          <dl className="grid gap-1 text-sm">
            {job.drop.landmark && <Line label="Landmark" value={job.drop.landmark} />}
            {job.drop.addressLine && <Line label="Street" value={job.drop.addressLine} />}
            {job.drop.building && <Line label="Building" value={job.drop.building} />}
            {job.drop.instructions && <Line label="Note" value={job.drop.instructions} />}
          </dl>
        )}
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <p>
            Buyer: <span className="font-semibold">{job.buyerName}</span>
          </p>
          {job.buyerPhone && (
            <p className="flex flex-wrap items-center gap-2">
              {job.phoneMasked ? (
                <span className="tnum text-ink-2" aria-label="Phone hidden until you accept">
                  {job.buyerPhone} <span className="text-xs text-ink-3">(shown after you accept)</span>
                </span>
              ) : (
                <a href={`tel:${job.buyerPhone}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand hover:underline tnum">
                  <Phone className="size-4" aria-hidden /> {job.buyerPhone}
                </a>
              )}
            </p>
          )}
          {dropLoc && (
            <a href={mapsLink(dropLoc.lat, dropLoc.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand hover:underline">
              <ExternalLink className="size-4" aria-hidden /> Directions to drop pin
            </a>
          )}
        </div>
      </Card>

      <div className="flex items-center gap-3 rounded-2xl bg-mango-soft px-4 py-3 text-sm">
        <Banknote className="size-5 shrink-0 text-on-mango" aria-hidden />
        {job.collectMinor > 0 ? (
          <p>
            Collect <span className="font-display text-lg font-semibold tnum">{money(job.collectMinor)}</span> from the buyer for {job.shopName}.
          </p>
        ) : (
          <p>Fully paid. Collect nothing from the buyer.</p>
        )}
      </div>
      {job.depositOutstandingMinor > 0 && !closed && (
        <p role="status" className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
          The buyer’s deposit ({money(job.depositOutstandingMinor)}) has not been received yet. Don’t collect the order until the shop confirms it.
        </p>
      )}

      {!closed && (job.accepted ? <Actions token={token} job={job} onJob={onJob} /> : <Accept token={token} job={job} onJob={onJob} />)}
      {job.status === 'delivered' && (
        <p className="flex items-center gap-2 rounded-2xl bg-pos-soft px-4 py-3 text-sm font-medium text-pos" role="status">
          <CheckCircle2 className="size-5" aria-hidden /> Delivered. Thank you!
        </p>
      )}
    </main>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-ink">{value}</dd>
    </div>
  )
}

function Accept({ token, job, onJob }: { token: string; job: RiderJob; onJob(j: RiderJob): void }) {
  const [name, setName] = useState(job.riderName ?? '')
  const accept = useMutation({
    mutationFn: async () => (await getStorefrontGateway()).riderAccept(token, name.trim()),
    onSuccess: onJob,
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    accept.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)]">
      <Field label="Your name" hint="The shop and buyer see who is delivering.">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className="h-11 rounded-xl" />}
      </Field>
      {accept.isError && (
        <p role="alert" className="text-sm text-neg">
          {errorMessage(accept.error)}
        </p>
      )}
      <Button type="submit" variant="brand" size="lg" loading={accept.isPending} disabled={name.trim().length < 2} icon={<Bike className="size-4" aria-hidden />} className="w-full rounded-2xl">
        Accept this delivery
      </Button>
    </form>
  )
}

function Actions({ token, job, onJob }: { token: string; job: RiderJob; onJob(j: RiderJob): void }) {
  const [failOpen, setFailOpen] = useState(false)
  const [reason, setReason] = useState<FailedReason>('buyer_unreachable')
  const act = useMutation({
    mutationFn: async (input: { action: RiderAction; reason?: FailedReason }) => (await getStorefrontGateway()).riderAction(token, input.action, input.reason ?? null),
    onSuccess: (j) => {
      onJob(j)
      setFailOpen(false)
    },
  })
  const busy = (a: RiderAction) => act.isPending && act.variables?.action === a
  const out = job.status === 'dispatched'
  const outOfAttempts = job.attempts >= job.maxAttempts

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)]" aria-label="Update the delivery">
      {act.isError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-neg-soft p-3 text-sm text-neg">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {errorMessage(act.error)}
        </p>
      )}
      {!out && (
        <Button variant="brand" size="lg" loading={busy('picked_up')} onClick={() => act.mutate({ action: 'picked_up' })} className="w-full rounded-2xl">
          I’ve picked it up
        </Button>
      )}
      <Button variant={out ? 'brand' : 'secondary'} size="lg" loading={busy('delivered')} onClick={() => act.mutate({ action: 'delivered' })} className="w-full rounded-2xl">
        Delivered to the buyer
      </Button>
      {out && !outOfAttempts && !failOpen && (
        <Button variant="ghost" onClick={() => setFailOpen(true)} className="min-h-11">
          Couldn’t deliver
        </Button>
      )}
      {failOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <Field label="What happened?">
            {(p) => (
              <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as FailedReason)}>
                {FAILED_REASONS.filter((r) => r !== 'shop_issue').map((r) => (
                  <option key={r} value={r}>
                    {FAILED_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-xs text-ink-3">The shop and buyer are told. Bring the order back to the shop.</p>
          <div className="flex gap-2">
            <Button variant="danger" loading={busy('failed')} onClick={() => act.mutate({ action: 'failed', reason })}>
              Report failed delivery
            </Button>
            <Button variant="ghost" onClick={() => setFailOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
