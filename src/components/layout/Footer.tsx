import { Link } from 'react-router-dom'
import { Globe, MessageCircle, Camera, Play, Heart } from 'lucide-react'
import { APP_NAME, APP_DESCRIPTION, ROUTES } from '@/lib/constants'

const footerLinks = {
  shop: {
    title: 'Shop',
    links: [
      { label: 'All Products', href: ROUTES.products },
      { label: 'New Arrivals', href: `${ROUTES.products}?sort=newest` },
      { label: 'Best Sellers', href: `${ROUTES.products}?sort=bestselling` },
      { label: 'Sale', href: `${ROUTES.products}?sale=true` },
    ],
  },
  support: {
    title: 'Support',
    links: [
      { label: 'Contact Us', href: '#' },
      { label: 'FAQs', href: '#' },
      { label: 'Shipping & Returns', href: '#' },
      { label: 'Size Guide', href: '#' },
    ],
  },
  company: {
    title: 'Company',
    links: [
      { label: 'About Us', href: '#' },
      { label: 'Careers', href: '#' },
      { label: 'Press', href: '#' },
      { label: 'Privacy Policy', href: '#' },
    ],
  },
}

const socialLinks = [
  { label: 'Twitter', icon: MessageCircle, href: '#' },
  { label: 'Instagram', icon: Camera, href: '#' },
  { label: 'Youtube', icon: Play, href: '#' },
  { label: 'Website', icon: Globe, href: '#' },
]

export function Footer() {
  return (
    <footer className="border-t border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2">
            <Link to="/" className="flex items-center gap-2 font-semibold text-xl text-surface-900 dark:text-white mb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-900 text-white dark:bg-white dark:text-surface-900 text-sm font-semibold">
                A
              </span>
              {APP_NAME}
            </Link>
            <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed max-w-xs mb-6">
              {APP_DESCRIPTION}
            </p>
            <div className="flex items-center gap-2">
              {socialLinks.map(({ label, icon: Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-all duration-200"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {Object.values(footerLinks).map(({ title, links }) => (
            <div key={title}>
              <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
                {title}
              </h4>
              <ul className="space-y-2.5">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      to={href}
                      className="text-sm text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100 transition-colors duration-200"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-surface-200 dark:border-surface-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-surface-400 dark:text-surface-500">
            &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
          <p className="text-xs text-surface-400 dark:text-surface-500 flex items-center gap-1">
            Made with <Heart className="h-3 w-3 text-red-500 fill-red-500" /> for creators everywhere
          </p>
        </div>
      </div>
    </footer>
  )
}
