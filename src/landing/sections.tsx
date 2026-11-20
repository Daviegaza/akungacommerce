import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  ChevronDown,
  CreditCard,
  FileClock,
  Globe2,
  KeyRound,
  Lock,
  Receipt,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { FunguaLogo } from '@/brand/FunguaLogo'
import { BRAND } from '@/brand/brand'
import { DEMO_SHOP_PATH } from './constants'

/* Shared */

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>
}

function SectionHead({ id, kicker, title, body }: { id: string; kicker: string; title: ReactNode; body?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[13px] font-medium text-brand">{kicker}</p>
      <h2 id={id} className="mt-2 font-display text-[clamp(1.75rem,3.6vw,2.5rem)] leading-[1.1] font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {body && <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{body}</p>}
    </div>
  )
}

/* ───────────── From social selling to a connected operation ───────────── */

const STEPS = [
  {
    title: 'Sell wherever your customers are',
    body: 'Publish a storefront with your own name, share it in your bio, posts and chats, and record in-person or phone sales in the same place.',
  },
  {
    title: 'Run the operation from one workspace',
    body: 'Every order lands in one queue with its payment, stock reservation and delivery. Your team works from the same list, with the access their role allows.',
  },
  {
    title: 'Get paid and keep the books straight',
    body: 'Customers pay with the methods available in your country. Payments are matched to orders, refunds are recorded, and every change is in the audit log.',
  },
]

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" id="how" className="scroll-mt-20 border-t border-line py-20 lg:py-28">
      <Container>
        <SectionHead
          id="how-title"
          kicker="How it works"
          title="From social selling to a connected commerce operation."
          body="Most businesses start with a phone, a few chats and a spreadsheet. Fungua keeps that simplicity for customers and gives the business the structure behind it."
        />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-panel p-6 lg:p-8">
              <span className="tnum text-[13px] font-medium text-ink-3">0{i + 1}</span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight text-ink">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  )
}

/* ───────────── Features ───────────── */

const FEATURES: { icon: typeof Store; title: string; body: string }[] = [
  { icon: Store, title: 'Storefronts', body: 'A fast mobile shop in your brand: catalogue, categories, cart, checkout and buyer order tracking. No buyer account needed.' },
  { icon: Receipt, title: 'Orders', body: 'One queue for every channel, with server-calculated totals, a clear status flow, returns and a full history for each order.' },
  { icon: Boxes, title: 'Inventory', body: 'Stock is reserved when an order is placed and committed when it ships, so you never sell what you do not have.' },
  { icon: Users, title: 'Customers', body: 'Contact details, order history and marketing consent per customer. Opt-outs are honoured everywhere, automatically.' },
  { icon: Wallet, title: 'Payments and reconciliation', body: 'Provider-confirmed payments are matched to orders. Anything that does not match waits for review instead of being guessed.' },
  { icon: Truck, title: 'Fulfilment and delivery', body: 'Pickup, delivery priced by distance, pick-up points and rider job links, with the customer kept informed at each step.' },
  { icon: BarChart3, title: 'Analytics', body: 'Sales, orders, average order and unpaid balances per currency, in your business time zone. Currencies are never added together.' },
  { icon: KeyRound, title: 'Team and permissions', body: 'Six roles from owner to analyst. Each person sees and changes only what their role allows, enforced on the server.' },
]

export function Features() {
  return (
    <section aria-labelledby="features-title" id="features" className="scroll-mt-20 border-t border-line py-20 lg:py-28">
      <Container>
        <SectionHead id="features-title" kicker="The workspace" title="Everything behind the sale, in one place." />
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="border-t border-line pt-5">
              <f.icon className="size-5 text-ink" strokeWidth={1.75} aria-hidden />
              <h3 className="mt-4 text-[15px] font-semibold text-ink">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{f.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ───────────── Global ───────────── */

const LOCALES = [
  { country: 'Germany', currency: 'EUR', sample: '1.234,56 €', tz: 'Europe/Berlin' },
  { country: 'Japan', currency: 'JPY', sample: '￥123,456', tz: 'Asia/Tokyo' },
  { country: 'Kuwait', currency: 'KWD', sample: 'KWD 1,234.567', tz: 'Asia/Kuwait' },
  { country: 'Kenya', currency: 'KES', sample: 'Ksh 1,234.56', tz: 'Africa/Nairobi' },
  { country: 'United Kingdom', currency: 'GBP', sample: '£1,234.56', tz: 'Europe/London' },
  { country: 'United States', currency: 'USD', sample: '$1,234.56', tz: 'America/New_York' },
]

export function Global() {
  return (
    <section aria-labelledby="global-title" className="border-t border-line py-20 lg:py-28">
      <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <SectionHead
            id="global-title"
            kicker="Built for any country"
            title="Local where it matters. One system everywhere."
            body="Each business is set up for its own country: currency, number and date formats, time zone, phone numbers, address fields, tax mode and the payment methods available there."
          />
          <ul className="mt-8 space-y-3 text-[15px] text-ink-2">
            <li className="flex gap-3">
              <Globe2 className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              ISO currency codes with exact minor units, including zero- and three-decimal currencies.
            </li>
            <li className="flex gap-3">
              <FileClock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              Reports and days follow your business time zone, including daylight-saving changes.
            </li>
            <li className="flex gap-3">
              <CreditCard className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              Payment options depend on the country and on which providers your business connects.
            </li>
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-ink-3">
            Tax settings calculate and show tax; they are not legal or tax advice. Check local requirements with an adviser.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <table className="w-full text-sm">
            <caption className="sr-only">Examples of how amounts are formatted per country</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th scope="col" className="px-5 py-3 font-medium">
                  Country
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Currency
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Amount shown as
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {LOCALES.map((l) => (
                <tr key={l.currency}>
                  <td className="px-5 py-3.5 text-ink">
                    {l.country}
                    <span className="block text-xs text-ink-3">{l.tz}</span>
                  </td>
                  <td className="tnum px-5 py-3.5 text-ink-2">{l.currency}</td>
                  <td className="tnum px-5 py-3.5 text-right font-medium text-ink">{l.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  )
}

/* ───────────── Trust and security ───────────── */

const TRUST: { icon: typeof Lock; title: string; body: string }[] = [
  { icon: Lock, title: 'Each business is isolated', body: 'Row-level security on every table. One business can never read or change another’s data.' },
  { icon: ShieldCheck, title: 'Prices are set by the server', body: 'Totals, tax and delivery fees are calculated on the server. A price sent by a browser is ignored.' },
  { icon: Wallet, title: 'Your money goes to you', body: `Customers pay into your own accounts. ${BRAND.name} does not hold funds. A payment counts as verified only when the provider confirms it.` },
  { icon: FileClock, title: 'Everything is on the record', body: 'Orders, stock, payments and settings changes are written to an audit log you can review.' },
]

export function Trust() {
  return (
    <section aria-labelledby="trust-title" id="security" className="scroll-mt-20 border-t border-line bg-panel py-20 lg:py-28">
      <Container>
        <SectionHead
          id="trust-title"
          kicker="Trust and security"
          title="Built to be relied on."
          body="Commerce runs on trust, from the customer paying for an order to the team member issuing a refund. These rules are enforced in the system, not left to good intentions."
        />
        <ul className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {TRUST.map((t) => (
            <li key={t.title} className="flex gap-4 border-t border-line pt-5">
              <t.icon className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={1.75} aria-hidden />
              <div>
                <h3 className="text-[15px] font-semibold text-ink">{t.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{t.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ───────────── Pricing (structure only; prices not yet set) ───────────── */

const PLANS = [
  {
    name: 'Starter',
    for: 'For a business getting its first storefront online.',
    items: ['Storefront and checkout', 'Orders, products and stock', 'Manual payment recording', 'Owner account'],
  },
  {
    name: 'Growth',
    for: 'For a business selling across several channels with a team.',
    items: ['Everything in Starter', 'Payment provider connections', 'Delivery zones and rider links', 'Team members with roles'],
  },
  {
    name: 'Scale',
    for: 'For multi-location or high-volume operations.',
    items: ['Everything in Growth', 'Several businesses and currencies', 'Custom domain', 'Priority support'],
  },
]

export function Pricing() {
  return (
    <section aria-labelledby="pricing-title" id="pricing" className="scroll-mt-20 border-t border-line py-20 lg:py-28">
      <Container>
        <SectionHead
          id="pricing-title"
          kicker="Pricing"
          title="Plans that grow with the business."
          body="Prices will be set per region and published before launch. This is the proposed plan structure, not a final offer."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className="flex flex-col bg-panel p-6 lg:p-8">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-ink">{p.name}</h3>
              </div>
              <p className="mt-1.5 text-sm text-ink-2">{p.for}</p>
              <p className="mt-6 text-[15px] font-medium text-ink-3">Price announced at launch</p>
              <ul className="mt-6 space-y-2.5 border-t border-line pt-6 text-sm text-ink-2">
                {p.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ───────────── What is connected today (honest status) ───────────── */

type Status = 'live' | 'adapter'
const INTEGRATIONS: { name: string; detail: string; status: Status }[] = [
  { name: 'Manual payments', detail: 'Bank transfer, mobile money to your own number, cash on delivery. You record them; they stay marked unverified.', status: 'live' },
  { name: 'Order by chat', detail: 'Customers can send their cart to you on WhatsApp in one tap.', status: 'live' },
  { name: 'M-Pesa (Daraja)', detail: 'Payment prompts and automatic matching, paid into each business’s own Till or Paybill.', status: 'adapter' },
  { name: 'Paystack, Stripe', detail: 'Signed webhooks record provider-confirmed payments.', status: 'adapter' },
  { name: 'WhatsApp Business, email, SMS', detail: 'Order updates to customers, with consent and opt-out handling.', status: 'adapter' },
]

export function IntegrationStatus() {
  return (
    <section aria-labelledby="status-title" className="border-t border-line py-20 lg:py-24">
      <Container>
        <SectionHead
          id="status-title"
          kicker="Integrations"
          title="What is connected today."
          body="Provider integrations are built and tested, and switch on once a business connects its own account. Until then, nothing is shown as automatic."
        />
        <ul className="mt-10 divide-y divide-line border-y border-line">
          {INTEGRATIONS.map((it) => (
            <li key={it.name} className="grid gap-1 py-4 sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-6">
              <span className="font-medium text-ink">{it.name}</span>
              <span className="text-sm text-ink-2">{it.detail}</span>
              <span
                className={`inline-flex h-6 w-fit items-center gap-1.5 rounded-md px-2 text-xs font-medium ${it.status === 'live' ? 'bg-pos-soft text-pos' : 'bg-sunken text-ink-2'}`}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {it.status === 'live' ? 'Available' : 'Ready to connect'}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ───────────── FAQ ───────────── */

const FAQS = [
  {
    q: 'Do customers need an account or an app?',
    a: 'No. They open your storefront, add to cart and check out with their name and contact details. Their order tracking link works without signing in.',
  },
  {
    q: 'Which countries and currencies are supported?',
    a: 'Each business chooses its country, currency and time zone. Amounts use the currency’s exact minor units, and dates and numbers follow the local format. Payment methods depend on what is available in that country.',
  },
  {
    q: 'How do I get paid?',
    a: `Customers pay into your own accounts, by a connected provider or by a method you record yourself. ${BRAND.name} does not hold your money. Manually recorded payments are clearly marked as unverified.`,
  },
  {
    q: 'Can my team use it?',
    a: 'Yes. Invite people with one of six roles. Permissions are enforced on the server, so a role cannot see or change more than it should.',
  },
  {
    q: 'Will my storefront show reviews and ratings straight away?',
    a: 'Only after real customers with delivered orders leave them. A new storefront says so plainly. Reviews and sales numbers are never invented.',
  },
  {
    q: 'Is Fungua the final name?',
    a: 'Fungua is the proposed name and is pending trademark and domain checks.',
  },
]

export function Faq() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="scroll-mt-20 border-t border-line py-20 lg:py-28">
      <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <SectionHead id="faq-title" kicker="Questions" title="Straight answers." />
        <div className="divide-y divide-line border-y border-line">
          {FAQS.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[15px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ───────────── Final CTA + footer ───────────── */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-line bg-[#0b0f17] py-20 text-white lg:py-24">
      <Container className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <h2 id="cta-title" className="font-display text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.08] font-semibold tracking-tight">
            Open commerce. Everywhere.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[#b4bccb]">Explore a working demo workspace and storefront with sample data. No sign-up needed.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            to="/app"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-[#0e1420] hover:bg-[#edf0f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Open the workspace
          </Link>
          <Link
            to={DEMO_SHOP_PATH}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-white/25 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            View a demo storefront
          </Link>
        </div>
      </Container>
    </section>
  )
}

const FOOTER_COLUMNS: { title: string; links: { label: string; to: string; internal?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', to: '#how' },
      { label: 'Features', to: '#features' },
      { label: 'Security', to: '#security' },
      { label: 'Pricing', to: '#pricing' },
    ],
  },
  {
    title: 'Try it',
    links: [
      { label: 'Demo workspace', to: '/app', internal: true },
      { label: 'Demo storefront', to: DEMO_SHOP_PATH, internal: true },
      { label: 'Sign in', to: '/app', internal: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/legal/privacy', internal: true },
      { label: 'Terms', to: '/legal/terms', internal: true },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="border-t border-line py-12">
      <Container>
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <FunguaLogo size={22} />
            <p className="mt-3 max-w-xs text-sm text-ink-3">{BRAND.tagline}</p>
          </div>
          {FOOTER_COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="text-[13px] font-medium text-ink">{c.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-ink-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.internal ? (
                      <Link to={l.to} className="hover:text-ink">
                        {l.label}
                      </Link>
                    ) : (
                      <a href={l.to} className="hover:text-ink">
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-3 sm:flex-row sm:justify-between">
          <p>{BRAND.name} is a proposed name, pending trademark and domain clearance.</p>
          <p>M-Pesa is a trademark of Safaricom PLC. WhatsApp is a trademark of Meta Platforms, Inc.</p>
        </div>
      </Container>
    </footer>
  )
}
