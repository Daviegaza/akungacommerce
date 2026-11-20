import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/store/uiStore'
import { NAV_LINKS, APP_NAME } from '@/lib/constants'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { Separator } from '@/components/ui/separator'
import { User } from 'lucide-react'

export function MobileMenu() {
  const isOpen = useUIStore((s) => s.isMobileMenuOpen)
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen)
  const activeNavLink = useUIStore((s) => s.activeNavLink)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 z-40 h-full w-80 max-w-[85vw] bg-white dark:bg-surface-900 shadow-2xl md:hidden"
          >
            <div className="flex flex-col h-full p-6">
              <div className="flex items-center justify-between mb-8">
                <span className="font-semibold text-lg text-surface-900 dark:text-white">
                  {APP_NAME}
                </span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl p-2 text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>

              <Separator className="mb-6" />

              <nav className="flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-xl px-4 py-3 text-base font-medium transition-all duration-200 ${
                      activeNavLink === link.href
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                        : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              <Separator className="my-6" />

              <Link
                to="/account"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              >
                <User className="h-5 w-5" />
                Account
              </Link>

              <div className="mt-auto">
                <ThemeToggle className="w-full justify-center" />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
