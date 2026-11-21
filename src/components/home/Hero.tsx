import { Link } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ROUTES } from '@/lib/constants'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-surface-50 dark:bg-surface-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text */}
          <div className="text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge variant="new" className="mb-6 px-4 py-1.5 text-sm gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                New Collection 2026
              </Badge>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight text-surface-900 dark:text-white leading-[1.05]"
            >
              Elevate your
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-brand-400 dark:from-brand-400 dark:to-brand-300">
                everyday life.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-6 text-lg text-surface-500 dark:text-surface-400 max-w-xl mx-auto lg:mx-0 leading-relaxed"
            >
              Discover premium products designed for the modern lifestyle. From cutting-edge audio to precision-engineered gear — every item curated for excellence.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start"
            >
              <Link to={ROUTES.products}>
                <Button size="xl" variant="accent">
                  Shop Now
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link to={`${ROUTES.products}?sale=true`}>
                <Button size="xl" variant="outline">
                  View Deals
                </Button>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-10 flex items-center gap-6 justify-center lg:justify-start text-sm text-surface-400 dark:text-surface-500"
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Free shipping over $75
              </div>
              <div className="hidden sm:block">·</div>
              <div className="hidden sm:block">30-day easy returns</div>
              <div className="hidden sm:block">·</div>
              <div className="hidden sm:block">2-year warranty</div>
            </motion.div>
          </div>

          {/* Hero Image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden aspect-[4/3] bg-gradient-to-br from-brand-100 to-brand-50 dark:from-brand-900/30 dark:to-brand-800/20">
              <img
                src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80"
                alt="Premium headphones"
                className="absolute inset-0 h-full w-full object-cover mix-blend-multiply dark:mix-blend-normal"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-brand-500/20 to-transparent" />
            </div>

            {/* Floating stats card */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.8 }}
              className="absolute -bottom-4 -left-4 glass rounded-2xl px-5 py-3 shadow-xl border border-white/20 dark:border-white/10"
            >
              <p className="text-xs text-surface-500 dark:text-surface-400 font-medium">Top Rated</p>
              <div className="flex items-center gap-1 mt-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <svg key={i} className="h-4 w-4 text-amber-400 fill-amber-400" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
                <span className="ml-1 text-sm font-bold text-surface-900 dark:text-white">4.8</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Background gradient */}
      <div className="absolute top-0 right-0 -z-10 h-[600px] w-[600px] rounded-full bg-gradient-to-bl from-brand-100/40 to-transparent blur-3xl dark:from-brand-900/20" />
    </section>
  )
}
