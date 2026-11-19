import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  BadgeCheck,
  BellRing,
  Boxes,
  Check,
  ChevronDown,
  Globe,
  Map as MapIcon,
  MessageCircle,
  PackageCheck,
  Plug,
  Receipt,
  Share2,
  Store,
  Truck,
  Wallet,
} from 'lucide-react'
import { RafuLogo } from '@/brand/RafuLogo'
import { DEMO_SHOP_PATH } from './constants'

const EASE = [0.2, 0.8, 0.2, 1] as const

/** List item that rises gently into view once; static under reduced motion. */
function RevealItem({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return <li className={className}>{children}</li>
  return (
    <motion.li
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.35, ease: EASE, delay }}
    >
      {children}
    </motion.li>
  )
}

function SectionHeading({ eyebrow, title, body, id }: { eyebrow: string; title: ReactNode; body?: ReactNode; id: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-brand">{eyebrow}</p>
      <h2 id={id} className="font-display mt-2 text-3xl leading-[1.05] font-extrabold tracking-tight text-ink sm:text-[2.6rem]">
        {title}
      </h2>
      {body && <p className="mt-3 text-base leading-relaxed text-ink-2 sm:text-lg">{body}</p>}
    </div>
  )
}

/* ───────────── How it works ───────────── */

const STEPS = [
  {
    icon: Store,
    title: 'Add your products',
    body: 'Photos, prices, sizes and colours. Stock is tracked for you, so you never sell what you don’t have.',
  },
  {
    icon: Share2,
    title: 'Share your link',
    body: 'One shop link for your WhatsApp Status, Instagram bio and TikTok. A QR code for your stall and packaging.',
  },
  {
    icon: Truck,
    title: 'Get paid & deliver',
    body: 'Buyers pay by M-Pesa or cash on delivery, with delivery priced before they pay. You see each order the moment it lands.',
  },
]

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" id="how" className="scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading id="how-title" eyebrow="How it works" title="From chat to checkout in three steps." />
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <RevealItem key={s.title} delay={i * 0.08} className="relative border-t-2 border-ink pt-5">
                <span className="font-display tnum text-5xl font-extrabold text-brand">{i + 1}</span>
                <h3 className="font-display mt-3 flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
                  <s.icon className="size-5 text-ink-2" aria-hidden />
                  {s.title}
                </h3>
                <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
              </RevealItem>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ───────────── Features ───────────── */

const FEATURES = [
  {
    icon: Wallet,
    title: 'M-Pesa & cash on delivery',
    body: 'Show your Till or Paybill with the order number, or let buyers pay on delivery. Your registered business name is shown so buyers know who they’re paying.',
  },
  {
    icon: MessageCircle,
    title: 'Order on WhatsApp',
    body: 'Buyers who prefer to chat can send their whole cart to your WhatsApp as a ready-made message.',
  },
  {
    icon: MapIcon,
    title: 'Delivery zones on a map',
    body: 'Drop your pin and set fees by distance — “up to 5 km, KES 200”. Buyers drop their pin and see the exact fee before paying.',
  },
  {
    icon: PackageCheck,
    title: 'Tracking link for buyers',
    body: 'Every order gets a private link with a real, timestamped timeline. No account or app needed.',
  },
  {
    icon: BellRing,
    title: 'Live back office',
    body: 'Orders, payments and stock update live, with an optional sale chime. A to-do queue tells you what to confirm and pack next.',
  },
  {
    icon: Boxes,
    title: 'Stock that never oversells',
    body: 'Stock is reserved when an order is placed, so two buyers can’t both get the last one.',
  },
  {
    icon: Globe,
    title: 'Any currency, any country',
    body: 'Prices, phone numbers and time zones follow your business. Kenya first, with shillings and M-Pesa built in.',
  },
]

export function Features() {
  return (
    <section aria-labelledby="features-title" id="features" className="scroll-mt-20 border-t border-line bg-panel px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="features-title"
          eyebrow="What you get"
          title="Everything a social seller needs. Nothing they don’t."
          body="Built around how people actually buy from small shops: on their phone, through chat, paying by mobile money."
        />
        <ul className="mt-12 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <RevealItem key={f.title} delay={(i % 3) * 0.06} className="flex gap-4 border-t border-line py-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">{f.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
                </div>
              </RevealItem>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ───────────── Built honest ───────────── */

const HONEST = [
  {
    icon: BadgeCheck,
    title: 'Verified reviews only',
    body: 'Only buyers with a delivered order can leave a review. Sellers can’t type, import or hide them.',
  },
  {
    icon: Check,
    title: 'No fake urgency',
    body: 'No looping countdowns, invented “people viewing” or made-up sold counts. “Only 3 left” appears only when it’s true.',
  },
  {
    icon: Receipt,
    title: 'Prices include delivery',
    body: 'Buyers see the full total, delivery included, before they pay. No surprise fees at the end.',
  },
]

export function BuiltHonest() {
  return (
    <section aria-labelledby="honest-title" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <SectionHeading
          id="honest-title"
          eyebrow="Built honest"
          title={
            <>
              Trust is the product. <span className="text-brand">We enforce it in code.</span>
            </>
          }
          body="Buyers of small online shops worry about scams. Every shop on Rafu plays by the same honest rules — they’re built into the platform, not left to good intentions."
        />
        <ul className="space-y-0">
          {HONEST.map((h, i) => (
            <RevealItem key={h.title} delay={i * 0.08} className="flex gap-4 border-b border-line py-6 first:pt-0">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pos-soft text-pos">
                  <h.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-display text-xl font-extrabold tracking-tight text-ink">{h.title}</h3>
                  <p className="mt-1 leading-relaxed text-ink-2">{h.body}</p>
                </div>
              </RevealItem>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ───────────── Integration status ───────────── */

type Status = 'live' | 'coming'
const INTEGRATIONS: { name: string; detail: string; status: Status }[] = [
  { name: 'M-Pesa Till & Paybill', detail: 'Buyers pay to your number with the order reference; you mark it paid.', status: 'live' },
  { name: 'Cash on delivery', detail: 'Optional, switched on per shop.', status: 'live' },
  { name: 'Order on WhatsApp', detail: 'Opens WhatsApp with the cart as a message to you.', status: 'live' },
  { name: 'M-Pesa STK push (Daraja)', detail: 'Payment prompt on the buyer’s phone and automatic confirmation. Adapter ready, not connected yet.', status: 'coming' },
  { name: 'WhatsApp Business API', detail: 'Automatic order updates to buyers. Adapter ready, not connected yet.', status: 'coming' },
]

export function IntegrationStatus() {
  return (
    <section aria-labelledby="status-title" className="border-y border-line bg-panel px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-2">
          <Plug className="size-5 text-ink-2" aria-hidden />
          <h2 id="status-title" className="font-display text-2xl font-extrabold tracking-tight text-ink">
            What’s connected today
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-ink-2">
          We’d rather tell you than surprise you. Until the M-Pesa prompt is connected, you confirm payments yourself from your M-Pesa messages.
        </p>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {INTEGRATIONS.map((it) => (
            <li key={it.name} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:gap-6">
              <span className="w-56 shrink-0 font-semibold text-ink">{it.name}</span>
              <span className="flex-1 text-sm text-ink-2">{it.detail}</span>
              <span
                className={`inline-flex h-6 w-fit items-center gap-1.5 rounded-md px-2 text-xs font-semibold ${
                  it.status === 'live' ? 'bg-pos-soft text-pos' : 'bg-warn-soft text-warn'
                }`}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {it.status === 'live' ? 'Live' : 'Coming — adapter ready'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ───────────── FAQ ───────────── */

const FAQS = [
  {
    q: 'Do my buyers need an account or an app?',
    a: 'No. They open your link, add to cart and check out with their name and phone number. Their tracking link works without signing in.',
  },
  {
    q: 'How do I get paid?',
    a: 'Buyers pay straight to your own M-Pesa Till or Paybill, or in cash on delivery. Rafu doesn’t hold your money. Until automatic M-Pesa confirmation is connected, you confirm each payment yourself.',
  },
  {
    q: 'How is delivery priced?',
    a: 'You drop a pin for your shop and set fees by distance. The buyer drops a pin for their address, and the matching fee is added to their total before they pay.',
  },
  {
    q: 'I already sell on WhatsApp. Why add a shop link?',
    a: 'Your catalogue, prices and stock live in one place instead of in screenshots. Buyers who still prefer chat can send you their cart on WhatsApp in one tap.',
  },
  {
    q: 'Can I use Rafu outside Kenya?',
    a: 'Yes. Your shop uses your country’s currency, phone format and time zone. M-Pesa options appear for sellers who use it; cash on delivery works everywhere.',
  },
  {
    q: 'Will my shop show reviews and ratings straight away?',
    a: 'Only once real buyers with delivered orders leave them. A new shop says so plainly — we never seed reviews or sales numbers.',
  },
]

export function Faq() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-3xl">
        <SectionHeading id="faq-title" eyebrow="Questions" title="Good questions, straight answers." />
        <div className="mt-10 divide-y divide-line border-y border-line">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-1">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-left text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-5 leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ───────────── Final CTA + footer ───────────── */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-brand px-6 py-14 text-center text-white sm:px-12">
        <h2 id="cta-title" className="font-display text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">
          Your buyers are already on WhatsApp.
          <br className="hidden sm:block" /> Give them a shop.
        </h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/app"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-[15px] font-semibold text-[#160F1E] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]"
          >
            Open your shop free
          </Link>
          <Link
            to={DEMO_SHOP_PATH}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/60 px-6 text-[15px] font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            See a demo shop
          </Link>
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <RafuLogo size={28} />
          <p className="mt-2 text-sm text-ink-3">Kenya first, built for everywhere.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
          <Link to="/app" className="hover:text-ink">
            Open your shop
          </Link>
          <Link to={DEMO_SHOP_PATH} className="hover:text-ink">
            Demo shop
          </Link>
          <a href="#faq" className="hover:text-ink">
            FAQ
          </a>
          <Link to="/app" className="hover:text-ink">
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-6xl text-xs text-ink-3">
        M-Pesa is a trademark of Safaricom PLC. WhatsApp is a trademark of Meta Platforms, Inc.
      </p>
    </footer>
  )
}
