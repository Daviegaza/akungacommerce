import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BRAND } from '@/brand/brand'
import { FunguaLogo } from '@/brand/FunguaLogo'

/*
 * Public legal pages (/legal/privacy and /legal/terms).
 * DRAFT: written in plain English from the product's real behaviour, not yet reviewed by a lawyer.
 * Placeholders in [square brackets] must be filled in before these are relied on.
 */

const LAST_UPDATED_ISO = '2026-11-22'
const LAST_UPDATED_LABEL = '22 November 2026'
const CONTACT_PLACEHOLDER = '[contact email to be added]'

interface LegalSection {
  id: string
  title: string
  body: ReactNode
}

/* ───────────── Shared layout ───────────── */

function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-relaxed text-ink-2">{children}</p>
}

function List({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-ink-2 marker:text-ink-3">{children}</ul>
}

function Term({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>
}

const linkClass = 'rounded-sm font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink'

function LegalLayout({
  title,
  intro,
  sections,
  other,
}: {
  title: string
  intro: ReactNode
  sections: LegalSection[]
  other: { to: string; label: string }
}) {
  const { hash } = useLocation()

  useEffect(() => {
    const previous = document.title
    document.title = `${title} · ${BRAND.name}`
    return () => {
      document.title = previous
    }
  }, [title])

  // Arriving from a shop footer keeps the old scroll position; start at the top unless a section was linked.
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [title, hash])

  return (
    <div className="ak-root min-h-dvh overflow-x-clip">
      <a
        href="#legal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4 sm:px-6">
          <Link to="/" aria-label={`${BRAND.name} home`} className="rounded-lg">
            <FunguaLogo size={26} />
          </Link>
        </div>
      </header>

      <main id="legal-main" className="mx-auto max-w-3xl px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
        <article className="max-w-[65ch]">
          <p role="note" className="border-l-2 border-warn pl-4 text-sm leading-relaxed text-ink">
            <strong className="font-semibold">Draft — not yet reviewed by a lawyer.</strong> Do not rely on this until it is approved.
          </p>

          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-ink-3">
            Last updated <time dateTime={LAST_UPDATED_ISO}>{LAST_UPDATED_LABEL}</time>
          </p>

          <div className="text-[15px] sm:text-base">{intro}</div>

          <nav aria-labelledby="legal-toc" className="mt-10 border-y border-line py-6">
            <h2 id="legal-toc" className="text-sm font-semibold tracking-normal text-ink">
              On this page
            </h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2 marker:text-ink-3">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="rounded-sm hover:text-ink hover:underline hover:underline-offset-4">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {sections.map((s, i) => (
            <section key={s.id} aria-labelledby={s.id} className="mt-12 text-[15px] sm:text-base">
              <h2 id={s.id} className="scroll-mt-6 text-xl font-bold tracking-tight text-ink sm:text-2xl">
                <span className="tnum mr-2 text-ink-3">{i + 1}.</span>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}

          <p className="mt-16 border-t border-line pt-6 text-sm text-ink-3">
            See also{' '}
            <Link to={other.to} className={linkClass}>
              {other.label}
            </Link>
            .
          </p>
        </article>
      </main>
    </div>
  )
}

/* ───────────── Privacy notice ───────────── */

const privacySections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who is responsible for your data',
    body: (
      <>
        <P>
          {BRAND.name} is a tool that small sellers use to run an online shop. Each seller (we call them “the shop”) gets a shop link. Buyers can order
          from that link without creating an account, and the shop’s staff manage orders in a private workspace.
        </P>
        <P>Who is responsible depends on whose data it is:</P>
        <List>
          <li>
            <Term>If you buy from a shop,</Term> that shop decides what happens with your order details. The shop is the data controller and {BRAND.name}{' '}
            processes your data on the shop’s behalf, as its processor. For most questions about an order, contact the shop first.
          </li>
          <li>
            <Term>If you run a shop or work in one,</Term> {BRAND.name} is the data controller for your account details.
          </li>
        </List>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    body: (
      <>
        <P>
          <Term>From buyers, when you place an order:</Term>
        </P>
        <List>
          <li>your name and phone number;</li>
          <li>your email address, if you choose to give one;</li>
          <li>where you want the order delivered, including the pin you drop on the map;</li>
          <li>what you ordered;</li>
          <li>
            payment references, such as the M-Pesa receipt code and the last 3 digits of the phone number that paid. We do not see or store your M-Pesa
            PIN or full card details.
          </li>
        </List>
        <P>
          <Term>From shop owners and staff:</Term> your email address and your role in the shop (for example owner or staff).
        </P>
        <P>
          <Term>From everyone:</Term> technical logs, including your IP address. We use these to keep the service working and to limit abuse, such as
          someone sending hundreds of fake orders.
        </P>
      </>
    ),
  },
  {
    id: 'how-we-use-it',
    title: 'How we use it',
    body: (
      <List>
        <li>
          <Term>To fulfil your order:</Term> so the shop can confirm it, pack it and deliver it to the right place.
        </li>
        <li>
          <Term>To match payments:</Term> so the shop can see which payment belongs to which order.
        </li>
        <li>
          <Term>To let you track your order:</Term> you get a private tracking link that shows its progress.
        </li>
        <li>
          <Term>To prevent abuse:</Term> for example, limiting how many requests can come from one IP address in a short time.
        </li>
        <li>
          <Term>For marketing, only if you opt in.</Term> You can stop at any time by replying STOP on WhatsApp or by using the link on your order page.
        </li>
      </List>
    ),
  },
  {
    id: 'how-long',
    title: 'How long we keep it',
    body: (
      <>
        <List>
          <li>
            <Term>Order tracking links</Term> stop working a set number of days after an order is closed. Each shop chooses this period, between 7 and
            3,650 days. If the shop does not choose, it is 90 days.
          </li>
          <li>
            <Term>Raw messages from payment and messaging providers</Term> (the technical notifications they send us) have personal details removed
            after 30 days.
          </li>
          <li>
            <Term>Rate-limit records</Term>, which include IP addresses, are deleted after 2 days.
          </li>
        </List>
        <P>
          Shops keep their own order records for as long as they need them, for example for accounting or tax. Ask the shop if you want to know how long
          it keeps your order.
        </P>
      </>
    ),
  },
  {
    id: 'who-we-share-with',
    title: 'Who we share it with',
    body: (
      <>
        <P>
          We share your data with the shop you ordered from, and with service providers that help us run {BRAND.name}. Depending on what the shop
          connects, these may include:
        </P>
        <List>
          <li>Supabase, for the database and hosting;</li>
          <li>Safaricom M-Pesa (Daraja), for M-Pesa payments;</li>
          <li>Meta WhatsApp Business, for order messages;</li>
          <li>Paystack and Stripe, for card and other online payments;</li>
          <li>Resend, for email;</li>
          <li>Twilio, for SMS;</li>
          <li>Vercel, for web hosting.</li>
        </List>
        <P>
          These providers only get what they need to do their job. Some of them may store data outside your country.
        </P>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <>
        <P>You can ask to:</P>
        <List>
          <li>see the personal data held about you;</li>
          <li>correct anything that is wrong;</li>
          <li>delete your data, where the law allows;</li>
          <li>object to how your data is used, including for marketing.</li>
        </List>
        <P>
          If you bought from a shop, start with that shop, because it controls your order data. We will help the shop answer you. For anything about a
          shop or staff account, contact us directly.
        </P>
        <P>
          You can also complain to a data protection regulator. In Kenya that is the Office of the Data Protection Commissioner (ODPC), under the Data
          Protection Act, 2019. In other countries, contact your local data protection authority.
        </P>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <P>
        Questions about this notice or your data: <span className="text-ink">{CONTACT_PLACEHOLDER}</span>.
      </P>
    ),
  },
]

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy notice"
      other={{ to: '/legal/terms', label: 'Terms of use' }}
      intro={
        <P>
          This notice explains what personal data {BRAND.name} handles, why, how long it is kept, and what you can do about it. It applies to buyers who
          order from shops on {BRAND.name}, and to the sellers and staff who run those shops.
        </P>
      }
      sections={privacySections}
    />
  )
}

/* ───────────── Terms of use ───────────── */

const termsSections: LegalSection[] = [
  {
    id: 'about',
    title: 'What these terms cover',
    body: (
      <>
        <P>
          These terms apply when you use {BRAND.name}, whether you run a shop, work in one, or buy from one. By using {BRAND.name} you agree to them.
        </P>
        <P>
          {BRAND.name} provides the software. Each shop is an independent business. When you buy something, your contract is with the shop, not with{' '}
          {BRAND.name}.
        </P>
      </>
    ),
  },
  {
    id: 'sellers',
    title: 'What sellers are responsible for',
    body: (
      <>
        <P>If you run a shop, you are responsible for:</P>
        <List>
          <li>the products you list, and describing them honestly;</li>
          <li>your prices, and any taxes that apply to your sales;</li>
          <li>delivering orders, or making them available for pickup, as promised;</li>
          <li>returns, refunds and complaints from your buyers;</li>
          <li>following the laws that apply to your business, including data protection law for your buyers’ details;</li>
          <li>who you give access to your workspace, and what they do there.</li>
        </List>
      </>
    ),
  },
  {
    id: 'payments',
    title: 'Payments',
    body: (
      <>
        <P>
          {BRAND.name} does not hold buyers’ money. Payments go straight to the seller’s own M-Pesa till or paybill, or to the seller’s own account with
          a payment provider. {BRAND.name} only records the payment reference so the order can be matched.
        </P>
        <P>
          If something goes wrong with a payment or a refund, the buyer should contact the shop. Payment providers have their own terms, which also apply.
        </P>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <P>You must not use {BRAND.name} to:</P>
        <List>
          <li>sell illegal goods or services;</li>
          <li>defraud or mislead buyers, sellers or anyone else;</li>
          <li>send spam, or message people who have not agreed to hear from you;</li>
          <li>place fake orders, or try to break, overload or get around the security of the service.</li>
        </List>
      </>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspending accounts',
    body: (
      <P>
        We may suspend or close a shop or account that breaks these terms, harms buyers, or puts the service at risk. Where it is safe and reasonable, we
        will tell you why and give you a chance to respond.
      </P>
    ),
  },
  {
    id: 'liability',
    title: 'The service and our liability',
    body: (
      <>
        <P>
          {BRAND.name} is provided “as is”. We work to keep it available and accurate, but we cannot promise it will always be uninterrupted or free of
          errors.
        </P>
        <P>[Limitation of liability wording to be added after legal review.]</P>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <P>
        We may update these terms as the product changes. The date at the top shows when they last changed. If a change is significant, we will let
        shop owners know before it takes effect.
      </P>
    ),
  },
  {
    id: 'law',
    title: 'Governing law and contact',
    body: (
      <>
        <P>Governing law: [to be confirmed].</P>
        <P>
          Questions about these terms: <span className="text-ink">{CONTACT_PLACEHOLDER}</span>.
        </P>
      </>
    ),
  },
]

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of use"
      other={{ to: '/legal/privacy', label: 'Privacy notice' }}
      intro={
        <P>
          The short version: sellers run their own shops and are responsible for what they sell, {BRAND.name} never holds buyers’ money, and nobody may
          use the service for fraud, spam or illegal goods.
        </P>
      }
      sections={termsSections}
    />
  )
}
