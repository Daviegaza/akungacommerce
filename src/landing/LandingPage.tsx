import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Menu, X } from 'lucide-react'
import { BRAND } from '@/brand/brand'
import { FunguaLogo } from '@/brand/FunguaLogo'
import { buttonClass } from '@/app/ui/primitives'
import { WorkspacePreview } from './ProductPreview'
import { Container, Faq, Features, FinalCta, Global, HowItWorks, IntegrationStatus, LandingFooter, Pricing, Trust } from './sections'
import { DEMO_SHOP_PATH } from './constants'

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Platform' },
  { href: '#security', label: 'Security' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

function LandingHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/95 backdrop-blur-xl">
      <Container className="flex h-[72px] items-center justify-between gap-4">
        <Link to="/" aria-label={`${BRAND.name} home`} className="rounded-md">
          <FunguaLogo size={27} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 text-[13px] font-medium text-ink-2 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="transition-colors hover:text-ink">{n.label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/app" className={buttonClass('ghost', 'sm', 'hidden sm:inline-flex')}>Sign in</Link>
          <Link to="/app" className={buttonClass('primary', 'sm')}>Get started <ArrowRight className="size-3.5" aria-hidden /></Link>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </Container>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-panel lg:hidden">
          <Container className="flex flex-col py-2">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex h-12 items-center text-sm font-medium text-ink-2 hover:text-ink">{n.label}</a>
            ))}
            <Link to="/app" onClick={() => setOpen(false)} className="flex h-12 items-center text-sm font-medium text-ink-2 sm:hidden">Sign in</Link>
          </Container>
        </nav>
      )}
    </header>
  )
}

function Hero() {
  const points = ['Your own branded storefront', 'One live order and stock view', 'Sell across channels and countries']
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden border-b border-line">
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:min-h-[650px] lg:grid-cols-[0.88fr_1.12fr] lg:gap-8 lg:py-24">
        <div className="relative z-10 max-w-[590px]">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1.5 text-[11px] font-semibold tracking-[0.13em] text-ink-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            COMMERCE OPERATING SYSTEM
          </div>
          <h1 id="hero-title" className="font-display text-[clamp(3.1rem,6.2vw,5.4rem)] leading-[0.98] font-semibold tracking-[-0.065em] text-ink">
            Open commerce.
            <span className="mt-2 block text-brand">Everywhere.</span>
          </h1>
          <p className="mt-7 max-w-[520px] text-[clamp(1.05rem,1.5vw,1.2rem)] leading-[1.75] text-ink-2">
            Run your storefront, social sales and in-person orders from one connected place. Keep products, stock, customers, payments and fulfilment in sync as your business grows.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/app" className={buttonClass('brand', 'lg')}>
              Explore the workspace <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to={DEMO_SHOP_PATH} className={buttonClass('secondary', 'lg')}>View a sample shop</Link>
          </div>
          <ul className="mt-8 grid gap-3 text-[13px] text-ink-2 sm:grid-cols-2">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><Check className="size-3" strokeWidth={2.5} aria-hidden /></span>
                {point}
              </li>
            ))}
          </ul>
          <p className="mt-7 text-[11px] leading-5 text-ink-3">Explore with fictional sample data. No sign-up needed for the demo.</p>
        </div>

        <figure className="relative min-w-0 lg:pl-2">
          <WorkspacePreview />
          <figcaption className="mt-3 text-[11px] text-ink-3">Illustrative preview with fictional sample data: the workspace order list.</figcaption>
        </figure>
      </Container>
    </section>
  )
}

/** Public product landing at "/". */
export default function LandingPage() {
  useEffect(() => {
    const previous = document.title
    document.title = `${BRAND.name} — ${BRAND.tagline}`
    return () => { document.title = previous }
  }, [])

  return (
    <div className="ak-root min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">
        Skip to content
      </a>
      <LandingHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <Global />
        <Trust />
        <Pricing />
        <IntegrationStatus />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
