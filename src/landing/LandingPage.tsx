import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import { BRAND } from '@/brand/brand'
import { FunguaLogo } from '@/brand/FunguaLogo'
import { buttonClass } from '@/app/ui/primitives'
import { StorefrontPreview, WorkspacePreview } from './ProductPreview'
import { Container, Faq, Features, FinalCta, Global, HowItWorks, IntegrationStatus, LandingFooter, Pricing, Trust } from './sections'
import { DEMO_SHOP_PATH } from './constants'

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#security', label: 'Security' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

function LandingHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link to="/" aria-label={`${BRAND.name} home`} className="rounded-md">
          <FunguaLogo size={24} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-ink-2 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/app" className={buttonClass('ghost', 'sm', 'hidden sm:inline-flex')}>
            Sign in
          </Link>
          <Link to="/app" className={buttonClass('primary', 'sm')}>
            Get started
          </Link>
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken lg:hidden"
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
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-canvas lg:hidden">
          <Container className="flex flex-col py-2">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex h-11 items-center text-[15px] text-ink-2 hover:text-ink">
                {n.label}
              </a>
            ))}
            <Link to="/app" onClick={() => setOpen(false)} className="flex h-11 items-center text-[15px] text-ink-2 hover:text-ink sm:hidden">
              Sign in
            </Link>
          </Container>
        </nav>
      )}
    </header>
  )
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden pt-14 pb-16 sm:pt-20 lg:pt-24 lg:pb-24">
      <Container>
        <div className="max-w-3xl">
          <h1 id="hero-title" className="font-display text-[clamp(2.5rem,6.4vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-ink">
            Open commerce.
            <br />
            Everywhere.
          </h1>
          <p className="mt-6 max-w-2xl text-[clamp(1.05rem,1.6vw,1.25rem)] leading-relaxed text-ink-2">
            {BRAND.name} is the commerce operating system for businesses that sell through their own storefront, social channels and in person. Products,
            orders, inventory, customers, payments and fulfilment run from one connected workspace.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/app" className={buttonClass('brand', 'lg')}>
              Explore the workspace <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to={DEMO_SHOP_PATH} className={buttonClass('secondary', 'lg')}>
              View a demo storefront
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-3">Working demo with sample data. No sign-up needed.</p>
        </div>

        <figure className="relative mt-14 lg:mt-20">
          <div className="lg:pr-[220px]">
            <WorkspacePreview />
          </div>
          <div className="absolute right-0 -bottom-6 hidden lg:block">
            <StorefrontPreview />
          </div>
          <figcaption className="mt-4 text-xs text-ink-3 lg:mt-10">
            Sample data. The workspace order list<span className="hidden lg:inline"> and the same business’s storefront on a phone</span>.
          </figcaption>
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
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="ak-root min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
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
