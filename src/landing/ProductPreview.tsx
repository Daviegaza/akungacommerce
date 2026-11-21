import { FunguaMark } from '@/brand/FunguaLogo'

/*
 * Static product previews for the landing page, drawn with the real design tokens.
 * Every name, order and amount here is SAMPLE data and is labelled as such on screen.
 */

const ROWS = [
  { n: '1048', who: 'Lena Hoffmann', ch: 'Storefront', status: 'To confirm', tone: 'brand', total: '€86.00' },
  { n: '1047', who: 'Jonas Weber', ch: 'Instagram', status: 'Packing', tone: 'ink', total: '€142.50' },
  { n: '1046', who: 'Mira Schulz', ch: 'In person', status: 'Paid', tone: 'pos', total: '€39.90' },
  { n: '1045', who: 'Tobias Klein', ch: 'WhatsApp', status: 'Out for delivery', tone: 'ink', total: '€64.00' },
  { n: '1044', who: 'Sofia Brandt', ch: 'Storefront', status: 'Delivered', tone: 'muted', total: '€118.00' },
] as const

const TONE: Record<(typeof ROWS)[number]['tone'], string> = {
  brand: 'bg-brand-soft text-brand',
  ink: 'bg-sunken text-ink-2',
  pos: 'bg-pos-soft text-pos',
  muted: 'bg-sunken text-ink-3',
}

const NAV = ['Today', 'Orders', 'Fulfilment', 'Products', 'Inventory', 'Customers', 'Payments', 'Analytics']

/** Desktop workspace preview (orders list). Decorative: hidden from assistive tech, summarised by the caption. */
export function WorkspacePreview() {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[var(--shadow-lift)]">
      <div className="flex h-9 items-center gap-1.5 border-b border-line bg-sunken px-3">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 h-5 flex-1 rounded-md bg-panel px-2 text-[10px] leading-5 text-ink-3">app · Orders</span>
      </div>
      <div className="grid grid-cols-[148px_1fr] text-left">
        <div className="hidden border-r border-line px-2.5 py-3 sm:block">
          <div className="mb-3 flex items-center gap-1.5 px-1.5">
            <FunguaMark size={14} />
            <span className="text-[11px] font-semibold text-ink">Atelier Lumen</span>
          </div>
          {NAV.map((n) => (
            <div key={n} className={`mb-px rounded-md px-1.5 py-1 text-[11px] ${n === 'Orders' ? 'bg-sunken font-medium text-ink' : 'text-ink-3'}`}>
              {n}
            </div>
          ))}
        </div>
        <div className="col-span-2 min-w-0 p-3 sm:col-span-1 sm:p-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Orders</p>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-on-primary">New order</span>
          </div>
          <div className="mt-2.5 flex gap-1.5 text-[10px]">
            {['All', 'To confirm 1', 'To pack 1', 'Ready'].map((t, i) => (
              <span key={t} className={`rounded-md px-1.5 py-0.5 ${i === 0 ? 'bg-sunken font-medium text-ink' : 'text-ink-3'}`}>
                {t}
              </span>
            ))}
          </div>
          <table className="mt-2.5 w-full text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] text-ink-3">
                <th className="py-1.5 font-normal">Order</th>
                <th className="py-1.5 font-normal">Customer</th>
                <th className="hidden py-1.5 font-normal md:table-cell">Channel</th>
                <th className="py-1.5 font-normal">Status</th>
                <th className="py-1.5 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map((r) => (
                <tr key={r.n}>
                  <td className="tnum py-2 text-ink-2">#{r.n}</td>
                  <td className="py-2 font-medium text-ink">{r.who}</td>
                  <td className="hidden py-2 text-ink-3 md:table-cell">{r.ch}</td>
                  <td className="py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${TONE[r.tone]}`}>{r.status}</span>
                  </td>
                  <td className="tnum py-2 text-right font-medium text-ink">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
