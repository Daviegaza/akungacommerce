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

/** Open block: hairline + space, no boxed card. */
function Block({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <span className="text-ink-3">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Primary/secondary text links on the rider page: neutral, large tap targets. */
const actionLink = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[15px] font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink'

function JobView({ token, job, onJob }: { token: string; job: RiderJob; onJob(j: RiderJob): void }) {
  const money = (m: number) => fmtMoney(m, job.currency, job.locale)
  const pickupLoc = job.pickup.lat != null && job.pickup.lng != null ? { lat: job.pickup.lat, lng: job.pickup.lng } : null
  const dropLoc = job.drop.lat != null && job.drop.lng != null ? { lat: job.drop.lat, lng: job.drop.lng } : null
  const closed = job.status === 'delivered' || job.status === 'cancelled'

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-6 overflow-x-clip px-4 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <header className="flex flex-col gap-1">
        <p className="min-w-0 truncate text-[15px] font-semibold text-ink">{job.shopName}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Delivery for order <span className="tnum">#{job.orderNumber}</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={job.status === 'delivered' ? 'pos' : job.status === 'cancelled' ? 'neg' : 'info'} dot>
            {STATUS_TEXT[job.status] ?? job.status}
          </Badge>
          {job.attempts > 0 && <Badge tone="warn">Attempt {Math.min(job.attempts + 1, job.maxAttempts)} of {job.maxAttempts}</Badge>}
        </div>
        <p className="mt-1 text-xs text-ink-3 tnum">Link works until {formatDateTime(job.expiresAt, job.locale, Intl.DateTimeFormat().resolvedOptions().timeZone)}. No account needed.</p>
      </header>

      {job.status === 'delivered' && (
        <p className="flex items-center gap-2.5 text-lg font-semibold text-ink" role="status">
          <CheckCircle2 className="size-6 shrink-0 text-pos" aria-hidden /> Delivered. Thank you.
        </p>
      )}

      <LocationPreview
        shopLoc={pickupLoc}
        dropLoc={dropLoc}
        shopLabel={job.pickup.label ?? job.shopName}
        dropLabel={job.drop.landmark}
        height={240}
      />

      <Block title="Pick up" icon={<Store className="size-4" aria-hidden />}>
        <p className="break-words text-lg font-semibold text-ink">{job.pickup.label ?? job.shopName}</p>
        <p className="text-sm text-ink-2 tnum">
          {job.itemCount} item{job.itemCount === 1 ? '' : 's'}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-5">
          {pickupLoc && (
            <a href={mapsLink(pickupLoc.lat, pickupLoc.lng)} target="_blank" rel="noopener noreferrer" className={actionLink}>
              <ExternalLink className="size-4 text-ink-3" aria-hidden /> Directions to shop
            </a>
          )}
          {job.pickup.shopPhone && (
            <a href={`tel:${job.pickup.shopPhone}`} className={actionLink}>
              <Phone className="size-4 text-ink-3" aria-hidden /> Call the shop
            </a>
          )}
        </div>
      </Block>

      <Block title="Drop off" icon={job.drop.pickupPoint ? <Package className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}>
        {job.drop.pickupPoint ? (
          <p className="break-words text-lg text-ink">
            Pick-up point: <span className="font-semibold">{job.drop.pickupPoint.name}</span>
            {job.drop.pickupPoint.area ? `, ${job.drop.pickupPoint.area}` : ''}
          </p>
        ) : (
          <dl className="grid gap-1.5 text-[15px]">
            {job.drop.landmark && <Line label="Landmark" value={job.drop.landmark} />}
            {job.drop.addressLine && <Line label="Street" value={job.drop.addressLine} />}
            {job.drop.building && <Line label="Building" value={job.drop.building} />}
            {job.drop.instructions && <Line label="Note" value={job.drop.instructions} />}
          </dl>
        )}
        <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-3 text-[15px]">
          <p className="break-words text-ink">
            Buyer: <span className="font-semibold">{job.buyerName}</span>
          </p>
          {job.buyerPhone && (
            <p className="flex flex-wrap items-center gap-2">
              {job.phoneMasked ? (
                <span className="tnum text-ink-2" aria-label="Phone hidden until you accept">
                  {job.buyerPhone} <span className="text-xs text-ink-3">(shown after you accept)</span>
                </span>
              ) : (
                <a href={`tel:${job.buyerPhone}`} className={`${actionLink} tnum`}>
                  <Phone className="size-4 text-ink-3" aria-hidden /> {job.buyerPhone}
                </a>
              )}
            </p>
          )}
          {dropLoc && (
            <a href={mapsLink(dropLoc.lat, dropLoc.lng)} target="_blank" rel="noopener noreferrer" className={`${actionLink} self-start`}>
              <ExternalLink className="size-4 text-ink-3" aria-hidden /> Directions to drop pin
            </a>
          )}
        </div>
      </Block>

      <Block title="Money" icon={<Banknote className="size-4" aria-hidden />}>
        {job.collectMinor > 0 ? (
          <p className="text-[15px] text-ink">
            Collect <span className="font-display text-2xl font-semibold tracking-tight tnum">{money(job.collectMinor)}</span> from the buyer for{' '}
            {job.shopName}.
          </p>
        ) : (
          <p className="text-[15px] font-medium text-ink">Fully paid. Collect nothing from the buyer.</p>
        )}
        {job.depositOutstandingMinor > 0 && !closed && (
          <p role="status" className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-ink">
            <span className="font-semibold text-warn">Wait: </span>
            The buyer’s deposit ({money(job.depositOutstandingMinor)}) has not been received yet. Don’t collect the order until the shop confirms it.
          </p>
        )}
      </Block>

      {!closed && (job.accepted ? <Actions token={token} job={job} onJob={onJob} /> : <Accept token={token} job={job} onJob={onJob} />)}
    </main>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
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
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-5">
      <h2 className="text-base font-semibold tracking-tight text-ink">Take this job</h2>
      <Field label="Your name" hint="The shop and buyer see who is delivering.">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className="h-12 text-base" />}
      </Field>
      {accept.isError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-neg-soft p-3 text-sm text-neg">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {errorMessage(accept.error)}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" loading={accept.isPending} disabled={name.trim().length < 2} icon={<Bike className="size-[18px]" aria-hidden />} className="h-14 w-full text-base">
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
    <section
      className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2.5 border-t border-line bg-canvas px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      aria-label="Update the delivery"
    >
      <p className="text-[13px] text-ink-3">{out ? 'Next step: hand the order to the buyer.' : 'Next step: collect the order from the shop.'}</p>
      {act.isError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-neg-soft p-3 text-sm text-neg">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {errorMessage(act.error)}
        </p>
      )}
      {failOpen ? (
        <div className="flex flex-col gap-3">
          <Field label="What happened?">
            {(p) => (
              <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as FailedReason)} className="h-12 text-base">
                {FAILED_REASONS.filter((r) => r !== 'shop_issue').map((r) => (
                  <option key={r} value={r}>
                    {FAILED_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-xs text-ink-3">The shop and buyer are told. Bring the order back to the shop.</p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button variant="danger" size="lg" loading={busy('failed')} onClick={() => act.mutate({ action: 'failed', reason })} className="h-14 w-full text-base">
              Report failed delivery
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setFailOpen(false)} className="h-14">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {!out && (
            <Button
              variant="primary"
              size="lg"
              loading={busy('picked_up')}
              onClick={() => act.mutate({ action: 'picked_up' })}
              icon={<Package className="size-[18px]" aria-hidden />}
              className="h-14 w-full text-base"
            >
              I’ve picked it up
            </Button>
          )}
          <Button
            variant={out ? 'primary' : 'secondary'}
            size="lg"
            loading={busy('delivered')}
            onClick={() => act.mutate({ action: 'delivered' })}
            icon={<CheckCircle2 className="size-[18px]" aria-hidden />}
            className="h-14 w-full text-base"
          >
            Delivered to the buyer
          </Button>
          {out && !outOfAttempts && (
            <Button variant="secondary" size="lg" onClick={() => setFailOpen(true)} className="h-12 w-full text-neg">
              Couldn’t deliver
            </Button>
          )}
        </>
      )}
    </section>
  )
}
