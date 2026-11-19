import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Check, Heart, MessageCircle, Plus, Smartphone } from 'lucide-react'

const img = (id: string) => `https://images.unsplash.com/${id}?w=360&h=360&q=70&auto=format&fit=crop`

/** Illustrative catalogue for the phone mock-up. Not real sales data. */
const TILES = [
  { name: 'Studio headphones', price: 'KES 6,500', src: img('photo-1505740420928-5e560c06d30e') },
  { name: 'Classic watch', price: 'KES 4,200', src: img('photo-1523275335684-37898b6baf30') },
  { name: 'Tinted sunglasses', price: 'KES 1,800', src: img('photo-1572635196237-14b3f281503f') },
  { name: 'Red runners', price: 'KES 3,900', src: img('photo-1542291026-7eec264c27ff') },
]

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * Hero illustration built in HTML/CSS: a phone showing a mini Rafu shop, with a
 * floating M-Pesa chip and an order-status card. Motion is decorative only and
 * switches off under prefers-reduced-motion.
 */
export function HeroVisual() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const phoneY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [24, -24])
  const chipY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [48, -48])

  const float = (delay: number, distance = 8) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -distance, 0] },
          transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' as const, delay },
        }

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[420px] py-6" role="img" aria-label="Illustration: a Rafu shop on a phone, an M-Pesa payment prompt and an order on its way">
      {/* soft brand glow behind the phone */}
      <div aria-hidden className="absolute inset-x-6 top-10 bottom-10 rounded-[3rem] bg-brand-soft blur-2xl" />

      <motion.div
        aria-hidden
        style={{ y: phoneY }}
        initial={reduce ? false : { opacity: 0 }}
        whileInView={reduce ? undefined : { opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: EASE }}
        className="relative mx-auto w-[260px] rounded-[2.6rem] border-[10px] border-[#160F1E] bg-[#160F1E] shadow-[var(--shadow-lift)] sm:w-[280px]"
      >
        <div className="overflow-hidden rounded-[2rem] bg-canvas">
          {/* notch */}
          <div className="flex justify-center bg-canvas pt-2">
            <span className="h-1.5 w-16 rounded-full bg-line-strong" />
          </div>
          {/* shop header */}
          <div className="px-3 pt-2">
            <div className="h-16 rounded-2xl bg-[linear-gradient(120deg,#ffe4eb,#fff1d6)]" />
            <div className="-mt-5 flex items-end gap-2 px-2">
              <span className="font-display flex size-10 items-center justify-center rounded-xl border-2 border-canvas bg-brand text-lg font-extrabold text-white">A</span>
              <div className="min-w-0 pb-0.5">
                <p className="font-display truncate text-[13px] leading-tight font-extrabold text-ink">Amani Studio</p>
                <p className="truncate text-[10px] text-ink-3">Delivers today in Westlands</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5 overflow-hidden">
              {['All', 'Audio', 'Watches', 'Shoes'].map((c, i) => (
                <span key={c} className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${i === 0 ? 'bg-ink text-canvas' : 'bg-sunken text-ink-2'}`}>
                  {c}
                </span>
              ))}
            </div>
          </div>
          {/* product grid */}
          <div className="grid grid-cols-2 gap-2 p-3">
            {TILES.map((t, i) => (
              <div key={t.name} className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-xl bg-sunken">
                  <img src={t.src} alt="" loading={i < 2 ? 'eager' : 'lazy'} className="size-full object-cover" />
                  <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-white/90">
                    <Heart className="size-3 text-ink-2" />
                  </span>
                  <span className="absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded-full bg-brand text-white shadow">
                    <Plus className="size-3.5" />
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-ink-2">{t.name}</p>
                <p className="font-display tnum text-[12px] font-extrabold text-ink">{t.price}</p>
              </div>
            ))}
          </div>
          {/* sticky bar */}
          <div className="flex gap-1.5 border-t border-line bg-panel p-2.5">
            <span className="flex h-8 flex-1 items-center justify-center rounded-lg bg-brand text-[11px] font-semibold text-white">Checkout · KES 6,950</span>
            <span className="flex h-8 items-center gap-1 rounded-lg border border-line-strong px-2 text-[11px] font-semibold text-ink">
              <MessageCircle className="size-3.5 text-[#25D366]" />
              WhatsApp
            </span>
          </div>
        </div>
      </motion.div>

      {/* M-Pesa chip */}
      <motion.div aria-hidden style={{ y: chipY }} className="absolute top-40 -left-2 sm:top-16 sm:-left-10">
        <motion.div {...float(0)} className="flex items-center gap-2.5 rounded-2xl border border-line bg-panel px-3 py-2.5 shadow-[var(--shadow-lift)]">
          <span className="flex size-8 items-center justify-center rounded-xl bg-pos-soft text-pos">
            <Smartphone className="size-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-[11px] font-semibold text-ink">Pay with M-Pesa</span>
            <span className="tnum block text-[10px] text-ink-3">Till or Paybill · KES 6,950</span>
          </span>
        </motion.div>
      </motion.div>

      {/* Order status card */}
      <motion.div aria-hidden style={{ y: chipY }} className="absolute -right-2 bottom-10 sm:-right-12">
        <motion.div {...float(1.4, 6)} className="w-[190px] rounded-2xl border border-line bg-panel p-3 shadow-[var(--shadow-lift)]">
          <div className="flex items-center justify-between">
            <span className="tnum text-[11px] font-semibold text-ink">Order #1042</span>
            <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-[9px] font-semibold text-info">On the way</span>
          </div>
          <ol className="mt-2.5 space-y-1.5">
            {[
              ['Received', '10:02'],
              ['Paid', '10:04'],
              ['Packed', '11:30'],
            ].map(([label, time]) => (
              <li key={label} className="flex items-center gap-2 text-[10px] text-ink-2">
                <span className="flex size-3.5 items-center justify-center rounded-full bg-pos text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
                <span className="flex-1">{label}</span>
                <span className="tnum text-ink-3">{time}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-[10px] font-semibold text-ink">
              <span className="flex size-3.5 items-center justify-center rounded-full border-2 border-brand bg-panel" />
              <span className="flex-1">Out for delivery</span>
              <span className="tnum text-ink-3">12:15</span>
            </li>
          </ol>
        </motion.div>
      </motion.div>
    </div>
  )
}
