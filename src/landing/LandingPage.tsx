import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { BRAND } from '@/brand/brand'
import { RafuLogo } from '@/brand/RafuLogo'
import { buttonClass } from '@/app/ui/primitives'
import { HeroVisual } from './HeroVisual'
import { BuiltHonest, Faq, Features, FinalCta, HowItWorks, IntegrationStatus, LandingFooter } from './sections'
import { DEMO_SHOP_PATH } from './constants'

const EASE = [0.2, 0.8, 0.2, 1] as const

function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label={`${BRAND.name} home`} className="rounded-lg">
          <RafuLogo size={30} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-ink-2 md:flex">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#features" className="hover:text-ink">
            Features
          </a>
          <a href="#faq" className="hover:text-ink">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link to="/app" className={buttonClass('ghost', 'md', 'hidden sm:inline-flex')}>
            Sign in
          </Link>
          <Link to="/app" className={buttonClass('brand', 'md')}>
            Open your shop
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  const reduce = useReducedMotion()
  const rise = (delay: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: EASE, delay } }

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden px-4 pt-10 pb-16 sm:px-6 lg:pt-16 lg:pb-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <div>
          <motion.p {...rise(0)} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[13px] font-medium text-ink-2">
            <span className="size-2 rounded-full bg-[#25D366]" aria-hidden />
            For sellers on WhatsApp, Instagram & TikTok
          </motion.p>
          <motion.h1
            {...rise(0.05)}
            id="hero-title"
            className="font-display mt-5 text-[clamp(2.75rem,8vw,5.25rem)] leading-[0.95] font-extrabold tracking-[-0.035em] text-ink"
          >
            Your shop,
            <br />
            open{' '}
            <span className="relative inline-block text-brand">
              everywhere.
              <svg aria-hidden viewBox="0 0 300 18" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-mango">
                <path d="M3 13 C 70 3, 160 3, 297 10" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </span>
          </motion.h1>
          <motion.p {...rise(0.1)} className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2 sm:text-xl">
            One link with your products, M-Pesa or cash-on-delivery checkout, delivery priced by distance, and a back office that tells you the moment an
            order lands. Made for people who sell through chat.
          </motion.p>
          <motion.div {...rise(0.15)} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/app" className={buttonClass('brand', 'lg', 'h-13 px-6 text-base')}>
              Open your shop free
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to={DEMO_SHOP_PATH} className={buttonClass('secondary', 'lg', 'h-13 px-6 text-base')}>
              See a demo shop
            </Link>
          </motion.div>
          <motion.p {...rise(0.2)} className="mt-5 text-sm text-ink-3">
            Kenya first · any country, any currency · buyers don’t need an account
          </motion.p>
        </div>
        <HeroVisual />
      </div>
    </section>
  )
}

/** Public product landing for Rafu at "/". */
export default function LandingPage() {
  useEffect(() => {
    const previous = document.title
    document.title = `${BRAND.name} — ${BRAND.tagline.replace(/\.$/, '')}`
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
        <BuiltHonest />
        <IntegrationStatus />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
