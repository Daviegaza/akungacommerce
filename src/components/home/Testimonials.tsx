import { Star, Quote } from 'lucide-react'
import { motion } from 'framer-motion'

const testimonials = [
  {
    id: 1,
    name: 'Marcus Chen',
    role: 'Audio Engineer',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80',
    quote:
      'Akunga completely changed how I buy tech. The curation is spot on — every product I have ordered has exceeded expectations. The Aura Pro headphones are the best I have ever used, period.',
    rating: 5,
    product: 'Aura Pro Headphones',
  },
  {
    id: 2,
    name: 'Sarah Kim',
    role: 'Product Designer',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&q=80',
    quote:
      'I am incredibly picky about design and the products on Akunga match my standards. The DeskPad Merino transformed my home office. Fast shipping, beautiful packaging — it feels like receiving a gift from yourself.',
    rating: 5,
    product: 'DeskPad Merino XL',
  },
  {
    id: 3,
    name: 'Lisa Thompson',
    role: 'Marathon Runner',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
    quote:
      'Three half marathons, three personal bests since buying the Stride Ultras. The carbon plate technology is real — these shoes give you an edge. Plus the checkout experience was the smoothest I have ever seen.',
    rating: 5,
    product: 'Stride Ultra Running Shoes',
  },
  {
    id: 4,
    name: 'James Park',
    role: 'Software Developer',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&q=80',
    quote:
      'As a developer, I appreciate good UX. Akunga\'s site is a joy to use — fast, clean, and thoughtful. Bought the TypeForge Elite keyboard and it is endgame. The attention to detail in both the product and the platform is remarkable.',
    rating: 5,
    product: 'TypeForge Elite Keyboard',
  },
]

export function Testimonials() {
  return (
    <section className="py-20 sm:py-28 bg-surface-100/50 dark:bg-surface-900/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-white">
            Loved by creators
          </h2>
          <p className="mt-2 text-surface-500 dark:text-surface-400 text-lg">
            Join thousands of happy customers who found their perfect gear
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="relative rounded-2xl bg-white dark:bg-surface-800 p-6 shadow-sm border border-surface-100 dark:border-surface-700"
            >
              <Quote className="h-8 w-8 text-brand-100 dark:text-brand-900/50 mb-3" />

              <div className="flex items-center gap-0.5 mb-3">
                {[...Array(t.rating)].map((_, j) => (
                  <Star key={j} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
              </div>

              <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed mb-4 line-clamp-6">
                "{t.quote}"
              </p>

              <div className="flex items-center gap-3 mt-auto pt-4 border-t border-surface-100 dark:border-surface-700">
                <img
                  src={t.avatar}
                  alt={t.name}
                  className="h-10 w-10 rounded-full object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                    {t.name}
                  </p>
                  <p className="text-xs text-surface-400">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
