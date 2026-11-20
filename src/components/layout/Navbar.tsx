import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, ShoppingBag, User, Menu, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useSearchStore } from '@/store/searchStore'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { NAV_LINKS, APP_NAME } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { MobileMenu } from './MobileMenu'
import { CartDrawer } from '@/components/cart/CartDrawer'
import { SearchOverlay } from '@/components/search/SearchBar'

export function Navbar() {
  const itemCount = useCartStore((s) => s.totalItems())
  const openCart = useCartStore((s) => s.openCart)
  const isMobileMenuOpen = useUIStore((s) => s.isMobileMenuOpen)
  const toggleMobileMenu = useUIStore((s) => s.toggleMobileMenu)
  const openSearch = useSearchStore((s) => s.openSearch)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 w-full transition-all duration-300',
          scrolled
            ? 'glass-strong border-b border-surface-200/50 dark:border-surface-700/50'
            : 'bg-transparent'
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-xl tracking-tight text-surface-900 dark:text-white shrink-0"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-900 text-white dark:bg-white dark:text-surface-900 text-sm font-semibold">
              A
            </span>
            {APP_NAME}
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="px-3.5 py-2 text-sm font-medium text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-1">
            <ThemeToggle className="hidden sm:flex" />

            <button
              onClick={openSearch}
              className="flex items-center justify-center h-10 w-10 rounded-xl text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>

            <Link
              to="/account"
              className="hidden sm:flex items-center justify-center h-10 w-10 rounded-xl text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              aria-label="Account"
            >
              <User className="h-5 w-5" />
            </Link>

            <button
              onClick={openCart}
              className="relative flex items-center justify-center h-10 w-10 rounded-xl text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              aria-label={`Cart with ${itemCount} items`}
            >
              <ShoppingBag className="h-5 w-5" />
              <AnimatePresence>
                {itemCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white shadow-md"
                  >
                    {itemCount > 99 ? '99+' : itemCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            <button
              onClick={toggleMobileMenu}
              className="flex md:hidden items-center justify-center h-10 w-10 rounded-xl text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
              aria-label="Menu"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <MobileMenu />
      <CartDrawer />
      <SearchOverlay />
    </>
  )
}
