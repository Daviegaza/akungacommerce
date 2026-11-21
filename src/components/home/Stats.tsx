import { motion } from 'framer-motion'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Package, Users, Star, Truck } from 'lucide-react'

const stats = [
  {
    icon: Package,
    value: 24,
    suffix: '+',
    label: 'Premium Products',
    description: 'Curated across 6 categories',
  },
  {
    icon: Users,
    value: 12500,
    suffix: '+',
    label: 'Happy Customers',
    description: 'And growing every day',
  },
  {
    icon: Star,
    value: 4.7,
    suffix: '',
    label: 'Average Rating',
    description: 'Across all products',
    formatter: (v: number) => v.toFixed(1),
  },
  {
    icon: Truck,
    value: 98,
    suffix: '%',
    label: 'On-Time Delivery',
    description: 'Free shipping over $75',
  },
]

export function Stats() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map(({ icon: Icon, value, suffix, label, description, formatter }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
              className="text-center"
            >
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 mb-4">
                <Icon className="h-6 w-6" />
              </div>
              <div className="text-3xl sm:text-4xl font-semibold tracking-tight text-surface-900 dark:text-white">
                <AnimatedCounter
                  to={value}
                  suffix={suffix}
                  formatter={formatter}
                />
              </div>
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">
                {label}
              </p>
              <p className="text-xs text-surface-400 mt-0.5">{description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
