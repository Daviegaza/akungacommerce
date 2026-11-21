import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function Newsletter() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email) {
      setSubscribed(true)
    }
  }

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-3xl bg-surface-900 dark:bg-surface-800 px-6 py-16 sm:px-16 sm:py-20 text-center"
        >
          {/* Background decoration */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-bl from-brand-500/20 to-transparent blur-3xl" />
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 h-[300px] w-[300px] rounded-full bg-gradient-to-tr from-brand-700/15 to-transparent blur-3xl" />

          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', delay: 0.2 }}
              className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 mb-8"
            >
              <Mail className="h-7 w-7 text-white" />
            </motion.div>

            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              {subscribed ? 'Welcome to the club!' : 'Stay in the loop'}
            </h2>
            <p className="mt-3 text-surface-300 max-w-md mx-auto text-lg">
              {subscribed
                ? 'You are now on the list. Exclusive deals and new drops are headed your way.'
                : 'Get early access to new drops, exclusive deals, and curated recommendations.'}
            </p>

            {subscribed ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-8 inline-flex items-center gap-2 text-green-400 font-semibold"
              >
                <Check className="h-5 w-5" />
                Subscribed successfully
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 bg-white/10 border-white/20 text-white placeholder:text-surface-400 focus:border-white/40 focus:ring-white/10"
                />
                <Button type="submit" variant="primary" size="lg" className="bg-white text-surface-900 hover:bg-surface-100">
                  Subscribe
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            )}

            <p className="mt-6 text-xs text-surface-400">
              No spam, ever. Unsubscribe anytime.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
