import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { KRA_SUBMISSION, formatInvoiceNumber, formatRate, invoicesCsv, normaliseKraPin, taxBreakdown, type TaxInvoiceRecord } from '@/domain/etims'
import { downloadCsv } from '@/integrations/csv'
import { useAction, useOrder, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Badge, Button, Field, Input, Skeleton, buttonClass } from '../ui/primitives'

/** Print only the invoice, not the app around it. */
const PRINT_CSS = `@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  .fungua-invoice, .fungua-invoice * { visibility: visible !important; }
  .fungua-invoice { position: absolute; inset: 0; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: white !important; color: black !important; }
  .fungua-invoice * { color: black !important; border-color: rgb(0 0 0 / 0.18) !important; background: transparent !important; }
}`

const INV_TH = 'py-2.5 pr-3 text-xs font-medium whitespace-nowrap text-ink-3 last:pr-0'
const INV_TD = 'tnum py-3 pr-3 text-right whitespace-nowrap last:pr-0'

function InvoiceDocument({ inv }: { inv: TaxInvoiceRecord }) {
  const { org } = useOrg()
  const m = (minor: number) => <Money minor={minor} currency={inv.currency} />
  return (
    <article
      className="fungua-invoice max-w-[820px] rounded-[var(--radius-card)] border border-line bg-panel px-5 py-6 text-ink sm:px-10 sm:py-10"
      aria-label={`Tax invoice ${formatInvoiceNumber(inv.invoiceNumber)}`}
    >
      {/* Seller leads: this is the merchant's document. */}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 text-sm">
          <p className="font-display text-[20px] leading-tight font-semibold tracking-[-0.02em] break-words text-ink">{inv.sellerName}</p>
          <p className="tnum mt-1.5 text-ink-2">KRA PIN {inv.sellerPin}</p>
          {org.contactPhone && <p className="tnum text-ink-2">{org.contactPhone}</p>}
          {org.contactEmail && <p className="break-all text-ink-2">{org.contactEmail}</p>}
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-[11px] font-semibold tracking-[0.13em] text-ink-3 uppercase">Tax invoice</p>
          <h2 className="tnum mt-1 font-display text-[22px] leading-tight font-semibold tracking-tight text-ink">{formatInvoiceNumber(inv.invoiceNumber)}</h2>
        </div>
      </header>

      <div className="mt-8 grid gap-6 border-t border-line pt-5 text-sm sm:grid-cols-2">
        <section>
          <p className="text-xs font-medium text-ink-3">Bill to</p>
          <p className="mt-1 font-medium break-words text-ink">{inv.buyerName ?? 'Walk-in customer'}</p>
          <p className="tnum text-ink-2">{inv.buyerPin ? `KRA PIN ${inv.buyerPin}` : 'No buyer KRA PIN'}</p>
        </section>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 sm:justify-self-end">
          <dt className="text-ink-3">Issued</dt>
          <dd className="text-right text-ink">
            <When iso={inv.issuedAt} dateOnly />
          </dd>
          <dt className="text-ink-3">Order</dt>
          <dd className="tnum text-right text-ink">#{inv.orderNumber ?? '—'}</dd>
          <dt className="text-ink-3">Currency</dt>
          <dd className="text-right text-ink">{inv.currency}</dd>
        </dl>
      </div>

      <div className="-mx-5 mt-8 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className={`${INV_TH} text-left`}>
                Item
              </th>
              <th scope="col" className={`${INV_TH} text-right`}>
                Qty
              </th>
              <th scope="col" className={`${INV_TH} text-right`}>
                Excl. VAT
              </th>
              <th scope="col" className={`${INV_TH} text-right`}>
                VAT
              </th>
              <th scope="col" className={`${INV_TH} text-right`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="py-3 pr-3 text-ink">
                  {l.description}
                  {l.sku && <span className="block text-xs text-ink-3">{l.sku}</span>}
                </td>
                <td className={INV_TD}>{l.quantity}</td>
                <td className={INV_TD}>{m(l.netMinor)}</td>
                <td className={INV_TD}>
                  {m(l.taxMinor)}
                  <span className="block text-xs text-ink-3">{formatRate(l.taxRateBps)}</span>
                </td>
                <td className={`${INV_TD} text-ink`}>{m(l.grossMinor)}</td>
              </tr>
            ))}
            {inv.deliveryMinor > 0 && (
              <tr className="border-b border-line">
                <td className="py-3 pr-3 text-ink">Delivery</td>
                <td className={INV_TD}>1</td>
                <td className={INV_TD}>{m(inv.deliveryMinor)}</td>
                <td className={INV_TD}>{m(0)}</td>
                <td className={`${INV_TD} text-ink`}>{m(inv.deliveryMinor)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 ml-auto w-full space-y-1.5 text-sm sm:max-w-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-3">Total excl. VAT</dt>
          <dd className="tnum text-right text-ink-2">{m(inv.netMinor + inv.deliveryMinor)}</dd>
        </div>
        {taxBreakdown(inv.lines).map((b) => (
          <div key={b.taxRateBps} className="flex justify-between gap-4">
            <dt className="text-ink-3">VAT {formatRate(b.taxRateBps)}</dt>
            <dd className="tnum text-right text-ink-2">{m(b.taxMinor)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-line-strong pt-2.5">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="tnum text-right font-display text-[18px] font-semibold tracking-tight text-ink">{m(inv.totalMinor)}</dd>
        </div>
      </dl>

      <p className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
        {inv.taxMode === 'inclusive' ? 'Prices included VAT.' : 'VAT was added to prices.'} {KRA_SUBMISSION.label}: enter this invoice in eTIMS Lite to
        get a KRA-validated receipt.
      </p>
    </article>
  )
}

export default function InvoicePage() {
  const { orderId = '' } = useParams()
  const { can } = useOrg()
  const order = useOrder(orderId)
  const invoice = useOrgQuery('tax-invoice', (g, o) => g.getTaxInvoice(o, orderId), [orderId])
  const extras = useOrgQuery('shop-extras', (g, o) => g.getShopExtras(o))
  const [buyerPin, setBuyerPin] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const issue = useAction((g, o, buyer: { pin: string | null; name: string | null }) => g.issueTaxInvoice(o, orderId, buyer))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = normaliseKraPin(buyerPin)
    if (!r.ok) {
      setPinError(r.error)
      return
    }
    setPinError(null)
    try {
      await issue.mutateAsync({ pin: r.value, name: buyerName.trim() || null })
    } catch {
      /* shown below */
    }
  }

  const back = (
    <Link to={`/app/orders/${orderId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Order
    </Link>
  )

  if (invoice.isPending || order.isPending || extras.isPending) {
    return (
      <>
        <PageHeader back={back} title="Tax invoice" />
        <Skeleton className="h-[480px] max-w-[820px] rounded-[var(--radius-card)]" />
      </>
    )
  }
  const loadError = invoice.error ?? order.error ?? extras.error
  if (loadError) {
    return (
      <>
        <PageHeader back={back} title="Tax invoice" />
        <ErrorNotice error={loadError} onRetry={() => void Promise.all([invoice.refetch(), order.refetch(), extras.refetch()])} />
      </>
    )
  }

  const inv = invoice.data
  if (inv) {
    return (
      <>
        <style>{PRINT_CSS}</style>
        <PageHeader
          back={back}
          title={formatInvoiceNumber(inv.invoiceNumber)}
          description="Issued invoices never change. Print it or download the eTIMS Lite CSV."
          actions={
            <>
              <Badge tone="neutral">{KRA_SUBMISSION.label}</Badge>
              <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => downloadCsv(`${formatInvoiceNumber(inv.invoiceNumber)}.csv`, invoicesCsv([inv]))}>
                CSV
              </Button>
              <Button size="sm" variant="primary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
                Print / PDF
              </Button>
            </>
          }
        />
        <InvoiceDocument inv={inv} />
      </>
    )
  }

  const o = order.data
  const x = extras.data
  if (!o || !x) return null
  const blocked = o.status === 'draft' || o.status === 'cancelled'
  return (
    <>
      <PageHeader back={back} title="Tax invoice" description={`Order #${o.number}`} />
      {!can('payments.record') ? (
        <Notice tone="warn">No invoice has been issued for this order. Owners, admins, managers and sales staff can issue one.</Notice>
      ) : blocked ? (
        <Notice tone="warn">Invoices can only be issued once an order is confirmed.</Notice>
      ) : !x.kraPin ? (
        <Notice tone="warn">
          Add your KRA PIN first.{' '}
          <Link to="/app/tools" className="font-semibold underline underline-offset-2">
            Open Selling tools
          </Link>
        </Notice>
      ) : (
        <Section title="Issue a tax invoice" description={`Next number: ${formatInvoiceNumber(x.nextInvoiceNumber)}. Once issued it cannot be edited.`}>
          <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
            {issue.isError && <ErrorNotice error={issue.error} />}
            <dl className="divide-y divide-line border-y border-line text-sm">
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ink-3">Total</dt>
                <dd className="text-right font-semibold text-ink">
                  <Money minor={o.totalMinor} currency={o.currency} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-ink-3">of which VAT</dt>
                <dd className="text-right text-ink-2">
                  <Money minor={o.taxMinor} currency={o.currency} />
                </dd>
              </div>
            </dl>
            <Field label="Buyer name" optional hint={o.customerName ? `Leave blank to use ${o.customerName}.` : undefined}>
              {(p) => <Input {...p} maxLength={160} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />}
            </Field>
            <Field label="Buyer KRA PIN" optional error={pinError} hint="Needed when the buyer is a business claiming VAT.">
              {(p) => <Input {...p} autoCapitalize="characters" spellCheck={false} maxLength={14} value={buyerPin} onChange={(e) => setBuyerPin(e.target.value)} placeholder="A123456789Z" />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={issue.isPending}>
                Issue invoice
              </Button>
              <Link to={`/app/orders/${orderId}`} className={buttonClass('ghost')}>
                Cancel
              </Link>
            </div>
          </form>
        </Section>
      )}
    </>
  )
}
