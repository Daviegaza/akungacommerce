import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Laptop, Headphones, Watch, Gem, Home, Trophy, type LucideIcon } from 'lucide-react'
import { CATEGORIES, ROUTES } from '@/lib/constants'

const iconMap: Record<string, LucideIcon> = {
  Laptop,
  Headphones,
  Watch,
  Gem,
  Home,
  Trophy,
}

export function Categories() {
  return (
    <section className="py-20 sm:py-28 bg-surface-100/50 dark:bg-surface-900/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-surface-900 dark:text-white">
            Shop by Category
          </h2>
          <p className="mt-2 text-surface-500 dark:text-surface-400 text-lg">
            Find exactly what you are looking for
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-5">
          {CATEGORIES.map((category, i) => {
            const Icon = iconMap[category.icon]
            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <Link
                  to={`${ROUTES.products}?category=${category.id}`}
                  className="group flex flex-col items-center gap-4 rounded-2xl bg-white dark:bg-surface-800 p-6 text-center transition-all duration-300 hover:shadow-xl hover:shadow-surface-900/5 dark:hover:shadow-black/20 hover:-translate-y-1 border border-surface-200/50 dark:border-surface-700/50"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400 transition-all duration-300 group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 group-hover:scale-110">
                    {Icon && <Icon className="h-6 w-6" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                      {category.name}
                    </h3>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                      {category.productCount} products
                    </p>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
