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
  body * { visibility: hidden !important; }
  .fungua-invoice, .fungua-invoice * { visibility: visible !important; }
  .fungua-invoice { position: absolute; inset: 0; padding: 24px; box-shadow: none !important; }
}`

function InvoiceDocument({ inv }: { inv: TaxInvoiceRecord }) {
  const { org } = useOrg()
  const m = (minor: number) => <Money minor={minor} currency={inv.currency} />
  return (
    <article className="fungua-invoice rounded-[var(--radius-card)] bg-panel p-5 text-ink shadow-[var(--shadow-card)] ring-1 ring-line/60 sm:p-8" aria-label={`Tax invoice ${formatInvoiceNumber(inv.invoiceNumber)}`}>
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-ink-3">Tax invoice</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight">{formatInvoiceNumber(inv.invoiceNumber)}</h2>
          <p className="mt-1 text-sm text-ink-2">
            Order #{inv.orderNumber ?? '—'} · <When iso={inv.issuedAt} dateOnly />
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="font-semibold">{inv.sellerName}</p>
          <p className="text-ink-2">KRA PIN {inv.sellerPin}</p>
          {org.contactPhone && <p className="text-ink-3">{org.contactPhone}</p>}
          {org.contactEmail && <p className="text-ink-3">{org.contactEmail}</p>}
        </div>
      </header>

      <section className="border-b border-line py-4 text-sm">
        <p className="text-xs font-semibold text-ink-3">Bill to</p>
        <p className="font-semibold">{inv.buyerName ?? 'Walk-in customer'}</p>
        <p className="text-ink-2">{inv.buyerPin ? `KRA PIN ${inv.buyerPin}` : 'No buyer KRA PIN'}</p>
      </section>

      <div className="-mx-1 overflow-x-auto py-2">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="text-xs text-ink-3">
              <th scope="col" className="py-2 pr-3 text-left font-semibold">Item</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Qty</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Excl. VAT</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">VAT</th>
              <th scope="col" className="py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  {l.description}
                  {l.sku && <span className="block text-xs text-ink-3">{l.sku}</span>}
                </td>
                <td className="tnum py-2 pr-3 text-right">{l.quantity}</td>
                <td className="tnum py-2 pr-3 text-right">{m(l.netMinor)}</td>
                <td className="tnum py-2 pr-3 text-right">
                  {m(l.taxMinor)}
                  <span className="block text-xs text-ink-3">{formatRate(l.taxRateBps)}</span>
                </td>
                <td className="tnum py-2 text-right">{m(l.grossMinor)}</td>
              </tr>
            ))}
            {inv.deliveryMinor > 0 && (
              <tr className="border-t border-line">
                <td className="py-2 pr-3">Delivery</td>
                <td className="tnum py-2 pr-3 text-right">1</td>
                <td className="tnum py-2 pr-3 text-right">{m(inv.deliveryMinor)}</td>
                <td className="tnum py-2 pr-3 text-right">{m(0)}</td>
                <td className="tnum py-2 text-right">{m(inv.deliveryMinor)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-2 max-w-xs space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-3">Total excl. VAT</dt>
          <dd className="tnum">{m(inv.netMinor + inv.deliveryMinor)}</dd>
        </div>
        {taxBreakdown(inv.lines).map((b) => (
          <div key={b.taxRateBps} className="flex justify-between gap-4">
            <dt className="text-ink-3">VAT {formatRate(b.taxRateBps)}</dt>
            <dd className="tnum">{m(b.taxMinor)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 font-display text-lg font-semibold">
          <dt>Total</dt>
          <dd className="tnum">{m(inv.totalMinor)}</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs text-ink-3">
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
        <Skeleton className="h-64" />
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
            <p className="text-sm text-ink-2">
              Total <strong className="tnum"><Money minor={o.totalMinor} currency={o.currency} /></strong>, of which VAT{' '}
              <span className="tnum"><Money minor={o.taxMinor} currency={o.currency} /></span>.
            </p>
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
