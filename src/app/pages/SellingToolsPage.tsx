import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Download, FileSpreadsheet, Globe, Landmark, LineChart, ReceiptText } from 'lucide-react'
import { normaliseGa4Id, normaliseMetaPixelId } from '@/domain/tracking'
import { DOMAIN_STATUS_LABEL, dnsInstructions, dnsTargetsFromEnv, normaliseHostname, type DomainStatus } from '@/domain/custom-domain'
import { BANK_TRANSFER_DESCRIPTORS, bankTransferEligible, type BankTransferProviderId } from '@/domain/bank-transfer'
import { KRA_SUBMISSION, formatInvoiceNumber, invoicesCsv, normaliseKraPin } from '@/domain/etims'
import { downloadCsv } from '@/integrations/csv'
import { INTEGRATION_LABEL_TEXT } from '@/integrations/registry'
import type { ShopExtras } from '@/gateway/expansion'
import { useAction, useGateway, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Notice, PageHeader, Section, Table, Td, Th } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Badge, Button, Field, Input, Skeleton, buttonClass, type Tone } from '../ui/primitives'

const useExtras = () => useOrgQuery('shop-extras', (g, o) => g.getShopExtras(o))

function SavedNote({ show }: { show: boolean }) {
  return show ? (
    <span role="status" className="text-sm text-pos">
      Saved
    </span>
  ) : null
}

/* ───────────── Marketing pixels ───────────── */

function TrackingForm({ extras, editable }: { extras: ShopExtras; editable: boolean }) {
  const [pixel, setPixel] = useState(extras.metaPixelId ?? '')
  const [ga4, setGa4] = useState(extras.ga4Id ?? '')
  const [errors, setErrors] = useState<{ pixel?: string; ga4?: string }>({})
  const [saved, setSaved] = useState(false)
  const save = useAction((g, o, ids: { metaPixelId: string | null; ga4Id: string | null }) => g.saveTrackingIds(o, ids))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    const p = normaliseMetaPixelId(pixel)
    const g = normaliseGa4Id(ga4)
    setErrors({ pixel: p.ok ? undefined : p.error, ga4: g.ok ? undefined : g.error })
    if (!p.ok || !g.ok) return
    try {
      await save.mutateAsync({ metaPixelId: p.value, ga4Id: g.value })
      setSaved(true)
    } catch {
      /* shown below */
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      {save.isError && <ErrorNotice error={save.error} />}
      <Field label="Meta Pixel ID" optional error={errors.pixel} hint="Numbers only. Find it in Meta Events Manager → Data sources.">
        {(p) => <Input {...p} inputMode="numeric" autoComplete="off" disabled={!editable} value={pixel} onChange={(e) => setPixel(e.target.value)} placeholder="123456789012345" />}
      </Field>
      <Field label="Google Analytics 4 measurement ID" optional error={errors.ga4} hint="Looks like G-XXXXXXX. Admin → Data streams.">
        {(p) => <Input {...p} autoComplete="off" disabled={!editable} value={ga4} onChange={(e) => setGa4(e.target.value)} placeholder="G-XXXXXXX" />}
      </Field>
      <p className="text-xs leading-relaxed text-ink-3">
        Your shop shows shoppers a short cookie choice. Nothing loads unless they tap <em>Allow</em>. Events sent: page views, product views, add to cart,
        checkout started and purchases with value and currency. Names, phone numbers and addresses are never sent. The pixel never runs in this staff app.
      </p>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save IDs
          </Button>
          <SavedNote show={saved} />
        </div>
      )}
    </form>
  )
}

/* ───────────── Custom domain ───────────── */

const DOMAIN_TONE: Record<DomainStatus, Tone> = { pending_dns: 'warn', verified: 'pos', failed: 'neg' }

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-2 hover:bg-sunken"
      aria-label={`Copy ${value}`}
    >
      <Copy className="size-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function DomainSection({ editable }: { editable: boolean }) {
  const gateway = useGateway()
  const domain = useOrgQuery('custom-domain', (g, o) => g.getCustomDomain(o))
  const [host, setHost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useAction((g, o, h: string) => g.setCustomDomain(o, h))
  const remove = useAction((g, o) => g.removeCustomDomain(o))
  const simulate = useAction((g, o, outcome: 'verified' | 'failed') => (g.simulateDomainCheck ? g.simulateDomainCheck(o, outcome) : Promise.resolve()))
  const targets = dnsTargetsFromEnv(import.meta.env as Record<string, unknown>)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = normaliseHostname(host)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    try {
      await add.mutateAsync(r.hostname)
      setHost('')
    } catch {
      /* shown below */
    }
  }

  return (
    <Section
      icon={<Globe className="size-4" aria-hidden />}
      title="Custom domain"
      description="Use your own address, like shop.yourbrand.com, instead of the Rafu link."
      actions={<Badge tone="info">Not connected</Badge>}
    >
      <Notice tone="warn">
        Rafu does not check DNS or issue certificates yet, so a domain stays “Waiting for DNS” and your shop keeps working on its Rafu link. Save it now and
        it will connect once domain hosting is switched on.
      </Notice>
      <div className="mt-4">
        {domain.isPending ? (
          <Skeleton className="h-20" />
        ) : domain.isError ? (
          <ErrorNotice error={domain.error} onRetry={() => void domain.refetch()} />
        ) : domain.data ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-lg font-bold break-all text-ink">{domain.data.hostname}</p>
              <Badge tone={DOMAIN_TONE[domain.data.status]} dot>
                {DOMAIN_STATUS_LABEL[domain.data.status]}
              </Badge>
            </div>
            {domain.data.failureReason && <p className="text-sm text-neg">{domain.data.failureReason}</p>}
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink">Add these records at your domain provider</p>
              <Table>
                <caption className="sr-only">DNS records</caption>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Name / host</Th>
                    <Th>Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {dnsInstructions(domain.data.hostname, domain.data.verificationToken, targets).map((r) => (
                    <tr key={r.type}>
                      <Td className="font-semibold">{r.type}</Td>
                      <Td className="text-xs break-all">
                        {r.host} <CopyButton value={r.host} />
                      </Td>
                      <Td className="text-xs break-all">
                        {r.value ? (
                          <>
                            {r.value} <CopyButton value={r.value} />
                          </>
                        ) : (
                          <span className="text-ink-3">Shown when domain hosting is switched on</span>
                        )}
                        <span className="block text-ink-3">{r.purpose}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
                  Remove domain
                </Button>
                {gateway.simulateDomainCheck && (
                  <>
                    <Button size="sm" loading={simulate.isPending} onClick={() => simulate.mutate('verified')}>
                      Simulate verified (demo)
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => simulate.mutate('failed')}>
                      Simulate failed (demo)
                    </Button>
                  </>
                )}
              </div>
            )}
            {(remove.error ?? simulate.error) && <ErrorNotice error={remove.error ?? simulate.error} />}
          </div>
        ) : editable ? (
          <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-3">
            {add.isError && <ErrorNotice error={add.error} />}
            <Field label="Your domain" error={error} hint="A subdomain like shop.yourbrand.com is easiest. Don't include https://.">
              {(p) => <Input {...p} autoComplete="off" autoCapitalize="none" spellCheck={false} value={host} onChange={(e) => setHost(e.target.value)} placeholder="shop.yourbrand.com" />}
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={add.isPending}>
                Save domain
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-ink-3">No custom domain. Only owners and admins can add one.</p>
        )}
      </div>
    </Section>
  )
}

/* ───────────── Bank transfer (Nigeria) ───────────── */

function BankTransferSection({ extras }: { extras: ShopExtras }) {
  const { org, can } = useOrg()
  const save = useAction((g, o, p: BankTransferProviderId) => g.setBankTransferProvider(o, p))
  const eligible = bankTransferEligible(org.baseCurrency)
  const editable = can('integrations.manage') && eligible

  return (
    <Section
      icon={<Landmark className="size-4" aria-hidden />}
      title="Bank transfer (Nigeria)"
      description="Buyers pay into a dedicated bank account and the payment is matched to their order."
      actions={<Badge tone="info">{INTEGRATION_LABEL_TEXT.adapter_only}</Badge>}
    >
      {!eligible ? (
        <p className="text-sm text-ink-3">Available for businesses that sell in NGN. This business uses {org.baseCurrency}.</p>
      ) : (
        <fieldset className="flex max-w-2xl flex-col gap-2" disabled={!editable || save.isPending}>
          <legend className="sr-only">Bank-transfer provider</legend>
          {save.isError && <ErrorNotice error={save.error} />}
          {[{ id: 'none' as const, name: 'Off', note: 'Buyers will not see bank transfer at checkout.', readiness: null }, ...BANK_TRANSFER_DESCRIPTORS].map((d) => (
            <label key={d.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-sunken">
              <input
                type="radio"
                name="bank-provider"
                checked={extras.bankTransferProvider === d.id}
                onChange={() => save.mutate(d.id)}
                className="mt-1 size-4 shrink-0 accent-[var(--ak-brand)]"
              />
              <span className="text-sm">
                <span className="font-semibold text-ink">{d.name}</span>
                {d.readiness && <Badge className="ml-2" tone="info">{INTEGRATION_LABEL_TEXT[d.readiness]}</Badge>}
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{d.note}</span>
              </span>
            </label>
          ))}
          <p className="mt-1 text-xs text-ink-3">
            Checkout only offers bank transfer once the chosen provider is connected and tested end to end. Until then nothing changes for buyers.
            {!can('integrations.manage') && ' Only owners and admins can change this.'}
          </p>
        </fieldset>
      )}
    </Section>
  )
}

/* ───────────── eTIMS ───────────── */

function KraPinForm({ extras, editable }: { extras: ShopExtras; editable: boolean }) {
  const [pin, setPin] = useState(extras.kraPin ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = useAction((g, o, v: string | null) => g.saveKraPin(o, v))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    const r = normaliseKraPin(pin)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    try {
      await save.mutateAsync(r.value)
      setSaved(true)
    } catch {
      /* shown below */
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-3">
      {save.isError && <ErrorNotice error={save.error} />}
      <Field label="Your KRA PIN" error={error} hint="Printed on invoices. A letter, 9 digits and a letter, e.g. P051234567X.">
        {(p) => (
          <Input {...p} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14} disabled={!editable} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="P051234567X" />
        )}
      </Field>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save KRA PIN
          </Button>
          <SavedNote show={saved} />
        </div>
      )}
    </form>
  )
}

function EtimsSection({ extras }: { extras: ShopExtras }) {
  const { org, can } = useOrg()
  const invoices = useOrgQuery('tax-invoices', (g, o) => g.listTaxInvoices(o))
  const list = invoices.data ?? []
  return (
    <Section
      icon={<ReceiptText className="size-4" aria-hidden />}
      title="Tax invoices (KRA eTIMS)"
      description="Numbered tax invoices per order, ready to enter in eTIMS Lite."
      actions={<Badge tone="neutral">{KRA_SUBMISSION.label}</Badge>}
    >
      <div className="flex flex-col gap-5">
        <Notice tone="info">{KRA_SUBMISSION.detail}</Notice>
        <KraPinForm extras={extras} editable={can('org.manage')} />
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">
              Issued invoices <span className="font-normal text-ink-3">· next number {formatInvoiceNumber(extras.nextInvoiceNumber)}</span>
            </p>
            <Button
              size="sm"
              icon={<Download className="size-4" aria-hidden />}
              disabled={list.length === 0}
              onClick={() => downloadCsv(`etims-invoices-${new Date().toISOString().slice(0, 10)}.csv`, invoicesCsv(list, org.timezone))}
            >
              Export CSV for eTIMS Lite
            </Button>
          </div>
          {invoices.isPending ? (
            <Skeleton className="h-16" />
          ) : invoices.isError ? (
            <ErrorNotice error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : list.length === 0 ? (
            <p className="text-sm text-ink-3">No invoices yet. Open an order and choose “Tax invoice”.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {list.slice(0, 50).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link to={`/app/orders/${inv.orderId}/invoice`} className="min-w-0 font-semibold text-ink hover:underline">
                    {formatInvoiceNumber(inv.invoiceNumber)}
                    <span className="ml-2 font-normal text-ink-3">Order #{inv.orderNumber ?? '—'}</span>
                  </Link>
                  <span className="shrink-0 text-right text-ink-2">
                    <Money minor={inv.totalMinor} currency={inv.currency} />
                    <span className="block text-xs text-ink-3">
                      <When iso={inv.issuedAt} dateOnly />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}

/* ───────────── Page ───────────── */

export default function SellingToolsPage() {
  const { org, can } = useOrg()
  const extras = useExtras()
  const isKenya = org.countryCode === 'KE'

  return (
    <>
      <PageHeader title="Selling tools" description="Import products, measure your ads, use your own domain, take bank transfers and prepare tax invoices." />

      <Section icon={<FileSpreadsheet className="size-4" aria-hidden />} title="Import products from CSV" description="Bring your catalogue over from a spreadsheet or another shop in one go.">
        <Link to="/app/products/import" className={buttonClass('secondary', 'sm')}>
          Open import
        </Link>
      </Section>

      {extras.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : extras.isError ? (
        <ErrorNotice error={extras.error} onRetry={() => void extras.refetch()} />
      ) : (
        <>
          <Section icon={<LineChart className="size-4" aria-hidden />} title="Ads and analytics" description="Measure Facebook / Instagram ads and Google Analytics on your shop.">
            <TrackingForm key={`${extras.data.metaPixelId}-${extras.data.ga4Id}`} extras={extras.data} editable={can('org.manage')} />
          </Section>
          <DomainSection editable={can('org.manage')} />
          {isKenya ? (
            <>
              <EtimsSection extras={extras.data} />
              <BankTransferSection extras={extras.data} />
            </>
          ) : (
            <>
              <BankTransferSection extras={extras.data} />
              <EtimsSection extras={extras.data} />
            </>
          )}
        </>
      )}
    </>
  )
}
