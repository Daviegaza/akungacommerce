import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { RafuMark } from '@/brand/RafuLogo'

const COPY: Record<number, { title: string; body: string }> = {
  1: { title: 'Your first sale!', body: 'The first order is in. Every shop starts exactly here.' },
  10: { title: '10 orders', body: 'Double digits. People are buying from you.' },
  50: { title: '50 orders', body: 'Fifty real orders. Your shelf is moving.' },
  100: { title: '100 orders', body: 'A hundred orders. This is a real business.' },
  500: { title: '500 orders', body: 'Five hundred orders and counting.' },
  1000: { title: '1,000 orders', body: 'A thousand orders. Take a moment to enjoy this one.' },
}

const PETALS = Array.from({ length: 10 }, (_, i) => i)

/** Gentle hibiscus burst behind the mark. No confetti; static under reduced motion. */
function Burst({ reduce }: { reduce: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      {PETALS.map((i) => {
        const angle = (i / PETALS.length) * Math.PI * 2
        const dist = 34
        const x = Math.cos(angle) * dist
        const y = Math.sin(angle) * dist
        return (
          <motion.span
            key={i}
            className={i % 3 === 0 ? 'absolute size-2.5 rounded-full bg-mango' : 'absolute h-3.5 w-2 rounded-full bg-brand'}
            style={{ rotate: `${(angle * 180) / Math.PI + 90}deg` }}
            initial={reduce ? { opacity: 0.85, x, y } : { opacity: 0, x: 0, y: 0, scale: 0.4 }}
            animate={reduce ? { opacity: 0.85, x, y } : { opacity: [0, 1, 0.85], x, y, scale: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.1 + i * 0.015, ease: [0.2, 0.8, 0.2, 1] }}
          />
        )
      })}
    </span>
  )
}

/**
 * One-time milestone moment (first sale, 10th, 100th order…). The milestone is
 * computed from real order counts by useMilestone; dismissing records it as seen.
 */
export function Celebration({ milestone, onDismiss }: { milestone: number | null; onDismiss: () => void }) {
  const reduce = useReducedMotion() ?? false
  const copy = milestone != null ? (COPY[milestone] ?? { title: `${milestone} orders`, body: 'Another milestone reached.' }) : null

  useEffect(() => {
    if (milestone == null) return
    const t = setTimeout(onDismiss, 12_000)
    return () => clearTimeout(t)
  }, [milestone, onDismiss])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-8" aria-live="polite">
      <AnimatePresence>
        {copy && (
          <motion.div
            key={milestone}
            role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: reduce ? 0.01 : 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto flex w-full max-w-md items-center gap-4 rounded-[24px] bg-panel p-4 pr-3 shadow-[var(--shadow-lift)] ring-1 ring-brand/25"
          >
            <span className="relative flex size-16 shrink-0 items-center justify-center">
              <Burst reduce={reduce} />
              <motion.span
                initial={reduce ? false : { scale: 0.6, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                className="relative"
              >
                <RafuMark size={40} />
              </motion.span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg leading-tight font-extrabold tracking-tight text-ink">{copy.title}</span>
              <span className="mt-0.5 block text-sm text-ink-2">{copy.body}</span>
            </span>
            <button
              type="button"
              onClick={onDismiss}
              className="flex size-10 shrink-0 items-center justify-center self-start rounded-full text-ink-3 hover:bg-sunken hover:text-ink"
              aria-label="Dismiss celebration"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
