import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CircleDashed, FileCheck2, Phone as PhoneIcon, ShieldCheck, Smartphone } from 'lucide-react'
import { formatPhone } from '@/domain/locale'
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, DOCUMENT_STATUS_LABEL, trustBadges, type DocumentKind } from '@/domain/trust'
import type { ShopVerification } from '@/gateway/trust'
import { INTEGRATION_LABEL_TEXT } from '@/integrations/registry'
import { useAction, useGateway, useIntegrations, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Field, Input, Select, Skeleton, buttonClass, type Tone } from '../ui/primitives'
import { useQuery } from '@tanstack/react-query'

type StepState = 'done' | 'waiting' | 'todo' | 'problem'
const STEP_TONE: Record<StepState, Tone> = { done: 'pos', waiting: 'info', todo: 'neutral', problem: 'warn' }

function StepBadge({ state, children }: { state: StepState; children: ReactNode }) {
  return <Badge tone={STEP_TONE[state]}>{children}</Badge>
}

function Step({ icon, title, badge, children }: { icon: ReactNode; title: string; badge: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)] ring-1 ring-line/60 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-tight text-ink">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</span>
          {title}
        </h2>
        {badge}
      </div>
      <div className="flex flex-col gap-3 text-sm text-ink-2">{children}</div>
    </section>
  )
}

export default function TrustPage() {
  const { org } = useOrg()
  const gateway = useGateway()
  const verification = useOrgQuery('shop-verification', (g, o) => g.getShopVerification(o))
  const admin = useQuery({ queryKey: ['platform-admin'], queryFn: () => gateway.isPlatformAdmin(), staleTime: 300_000 })

  return (
    <>
      <PageHeader
        title="Trust and verification"
        description="Checks that let buyers trust your shop before they pay. A badge appears in your shop only after Rafu confirms it, never because a setting was typed in."
        actions={
          admin.data ? (
            <Link to="/app/platform-review" className={buttonClass('secondary')}>
              Reviewer queue
            </Link>
          ) : undefined
        }
      />

      {verification.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : verification.isError ? (
        <ErrorNotice error={verification.error} onRetry={() => void verification.refetch()} />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
          <div className="min-w-0">
            {verification.data.simulated && (
              <div className="mb-4">
                <Notice>Demo workspace: phone codes are shown on screen instead of sent, the M-Pesa name check is typed in, and you act as the Rafu reviewer.</Notice>
              </div>
            )}
            <PhoneStep v={verification.data} />
            <MpesaNameStep v={verification.data} />
            <DocumentsStep v={verification.data} />
          </div>
          <div className="min-w-0">
            <BuyerPreview v={verification.data} shopName={org.name} />
          </div>
        </div>
      )}
    </>
  )
}

/* ───────────── Phone ───────────── */

function PhoneStep({ v }: { v: ShopVerification }) {
  const { can } = useOrg()
  const phone = v.phone.shopPhoneE164
  const [sent, setSent] = useState<{ simulatedCode: string | null } | null>(null)
  const [code, setCode] = useState('')
  const request = useAction((g, orgId, p: string) => g.requestPhoneCode(orgId, p))
  const confirm = useAction((g, orgId, input: { phone: string; code: string }) => g.confirmPhoneCode(orgId, input.phone, input.code))
  const allowed = can('org.manage')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!phone || !/^\d{4,8}$/.test(code.trim())) return
    confirm.mutate({ phone, code }, { onSuccess: () => { setSent(null); setCode('') } })
  }

  return (
    <Step
      icon={<PhoneIcon className="size-4" aria-hidden />}
      title="Phone number"
      badge={v.phone.verified ? <StepBadge state="done">Verified</StepBadge> : <StepBadge state="todo">Not verified</StepBadge>}
    >
      {!phone ? (
        <p>
          Add your shop’s WhatsApp number in{' '}
          <Link to="/app/shop" className="font-medium text-ink underline underline-offset-2">
            My shop
          </Link>{' '}
          first. That is the number buyers see, so that is the one we check.
        </p>
      ) : v.phone.verified ? (
        <p>
          <span className="font-semibold text-ink tnum">{formatPhone(phone)}</span> confirmed a one-time code. If you change your shop’s WhatsApp number, verify the new
          one.
        </p>
      ) : (
        <>
          <p>
            We send a one-time code by SMS to <span className="font-semibold text-ink tnum">{formatPhone(phone)}</span>. Typing it in proves this number is yours.
          </p>
          {!allowed && <p className="text-xs text-ink-3">Only an owner or admin can verify the number.</p>}
          {allowed && !sent && (
            <Button className="self-start" loading={request.isPending} onClick={() => request.mutate(phone, { onSuccess: (r) => setSent(r) })}>
              Send code
            </Button>
          )}
          {allowed && sent && (
            <form onSubmit={submit} className="flex flex-col gap-3">
              {sent.simulatedCode && (
                <Notice>
                  Demo: no SMS was sent. Your code is <span className="font-semibold tnum">{sent.simulatedCode}</span>.
                </Notice>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Code from the SMS" className="w-40">
                  {(p) => (
                    <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={confirm.isPending} disabled={code.trim().length < 4}>
                  Confirm
                </Button>
                <Button variant="ghost" disabled={request.isPending} onClick={() => request.mutate(phone, { onSuccess: (r) => setSent(r) })}>
                  Send a new code
                </Button>
              </div>
            </form>
          )}
          {request.isError && <ErrorNotice error={request.error} />}
          {confirm.isError && <ErrorNotice error={confirm.error} />}
        </>
      )}
    </Step>
  )
}

/* ───────────── M-Pesa name ───────────── */

function MpesaNameStep({ v }: { v: ShopVerification }) {
  const { can } = useOrg()
  const gateway = useGateway()
  const integrations = useIntegrations()
  const [name, setName] = useState(v.mpesaName.registeredName ?? '')
  const simulate = useAction((g, orgId, n: string) => (g.simulateMpesaNameReport ? g.simulateMpesaNameReport(orgId, n) : Promise.resolve()))
  const daraja = integrations.data?.find((i) => i.provider === 'mpesa')
  const m = v.mpesaName

  const badge = m.matched ? (
    <StepBadge state="done">Name matched</StepBadge>
  ) : m.reportedName ? (
    <StepBadge state="problem">Names differ</StepBadge>
  ) : (
    <StepBadge state="todo">Not checked yet</StepBadge>
  )

  return (
    <Step icon={<Smartphone className="size-4" aria-hidden />} title="M-Pesa business name" badge={badge}>
      <p>
        Buyers check the name on their M-Pesa prompt before they pay. Rafu compares the name M-Pesa itself reports for your Till or Paybill with the name you gave
        in My shop.
      </p>
      <dl className="divide-y divide-line rounded-xl ring-1 ring-line">
        <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
          <dt className="text-ink-3">Name you gave</dt>
          <dd className="text-right font-medium text-ink">{m.registeredName ?? <span className="text-ink-3">Not set</span>}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
          <dt className="text-ink-3">Name M-Pesa reported</dt>
          <dd className="text-right font-medium text-ink">
            {m.reportedName ?? <span className="text-ink-3">None yet</span>}
            {m.reportedAt && (
              <span className="block text-xs font-normal text-ink-3">
                <When iso={m.reportedAt} />
              </span>
            )}
          </dd>
        </div>
      </dl>
      {m.reportedName && !m.matched && (
        <p className="text-warn">
          These don’t match, so buyers don’t see a badge. Change the name in My shop to exactly what M-Pesa shows, or contact Safaricom if M-Pesa shows the wrong
          name.
        </p>
      )}
      {!v.simulated && !m.reportedName && (
        <p className="text-xs text-ink-3">
          The name is recorded automatically from a confirmed M-Pesa response once your Daraja connection is connected and verified.
          {daraja && ` Daraja now: ${INTEGRATION_LABEL_TEXT[daraja.label]}.`}
        </p>
      )}
      {v.simulated && gateway.simulateMpesaNameReport && can('integrations.manage') && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault()
            simulate.mutate(name)
          }}
        >
          <Field label="Demo: name M-Pesa shows" className="w-full sm:w-auto sm:min-w-0 sm:flex-1">
            {(p) => <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Button type="submit" loading={simulate.isPending} disabled={name.trim().length < 2}>
            Simulate M-Pesa check
          </Button>
          {simulate.isError && (
            <div className="w-full">
              <ErrorNotice error={simulate.error} />
            </div>
          )}
        </form>
      )}
    </Step>
  )
}

/* ───────────── Documents ───────────── */

function DocumentsStep({ v }: { v: ShopVerification }) {
  const { can } = useOrg()
  const fileId = useId()
  const [kind, setKind] = useState<DocumentKind>(v.documents.kind ?? 'business_registration')
  const [files, setFiles] = useState<File[]>([])
  const [tried, setTried] = useState(false)
  const submit = useAction((g, orgId, input: { kind: DocumentKind; files: File[] }) => g.submitVerificationDocuments(orgId, input))
  const d = v.documents
  const allowed = can('org.manage')
  const state: StepState = d.status === 'approved' ? 'done' : d.status === 'submitted' ? 'waiting' : d.status === 'rejected' ? 'problem' : 'todo'
  const fileError = tried && files.length === 0 ? 'Choose at least one file' : tried && files.length > 5 ? 'Choose up to 5 files' : null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (files.length === 0 || files.length > 5) return
    submit.mutate({ kind, files }, { onSuccess: () => { setFiles([]); setTried(false) } })
  }

  return (
    <Step icon={<FileCheck2 className="size-4" aria-hidden />} title="Business documents" badge={<StepBadge state={state}>{DOCUMENT_STATUS_LABEL[d.status]}</StepBadge>}>
      <p>Send one business document. A Rafu reviewer checks it by hand. Buyers see that it was reviewed, never the document itself.</p>
      {d.status === 'submitted' && (
        <p>
          {d.fileCount} {d.fileCount === 1 ? 'file' : 'files'} sent{d.kind ? ` (${DOCUMENT_KIND_LABEL[d.kind]})` : ''}
          {d.submittedAt && (
            <>
              {' '}
              on <When iso={d.submittedAt} dateOnly />
            </>
          )}
          . We will review it.
        </p>
      )}
      {d.status === 'approved' && d.reviewedAt && (
        <p>
          Approved on <When iso={d.reviewedAt} dateOnly />.
        </p>
      )}
      {d.status === 'rejected' && d.rejectionReason && (
        <p className="text-warn">
          Not approved: {d.rejectionReason}. Fix this and send again.
        </p>
      )}
      {!allowed && d.status !== 'approved' && <p className="text-xs text-ink-3">Only an owner or admin can send documents.</p>}
      {allowed && d.status !== 'submitted' && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Document">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fileId} className="text-[13px] font-semibold text-ink">
              Files <span className="font-normal text-ink-3">(PDF or photo, up to 5, 10 MB each)</span>
            </label>
            <input
              id={fileId}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${fileId}-err` : undefined}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-ink-2 file:mr-3 file:h-10 file:rounded-xl file:border file:border-line-strong file:bg-panel file:px-3 file:text-sm file:font-semibold file:text-ink"
            />
            {fileError && (
              <p id={`${fileId}-err`} role="alert" className="text-xs font-medium text-neg">
                {fileError}
              </p>
            )}
          </div>
          <Button type="submit" variant="primary" className="self-start" loading={submit.isPending}>
            {d.status === 'approved' ? 'Send a new document' : 'Send for review'}
          </Button>
          {d.status === 'approved' && <p className="text-xs text-ink-3">Sending a new document removes the badge until it is reviewed.</p>}
          {submit.isError && <ErrorNotice error={submit.error} />}
        </form>
      )}
    </Step>
  )
}

/* ───────────── What buyers see ───────────── */

function BuyerPreview({ v, shopName }: { v: ShopVerification; shopName: string }) {
  const badges = trustBadges(
    {
      phoneVerified: v.phone.verified,
      mpesaName: v.mpesaName.matched ? v.mpesaName.reportedName : null,
      documentsApproved: v.documents.status === 'approved',
      onRafuSince: '',
      completedOrders: null,
    },
    shopName,
  )
  return (
    <Section title="What buyers see" description="In your shop, on product pages and next to “Report this shop”.">
      {badges.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-2">
          <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
          No badges yet. Buyers still see how long you have been on Rafu and how many orders you have completed.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {badges.map((b) => (
            <li key={b.id} className="flex gap-3 rounded-xl bg-pos-soft px-3 py-2.5">
              {b.id === 'mpesa_name' ? (
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
              ) : (
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-pos" aria-hidden />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">{b.title}</p>
                <p className="mt-0.5 text-ink-2">{b.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
