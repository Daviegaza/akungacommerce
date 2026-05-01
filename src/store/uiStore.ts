import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface UIStore {
  theme: Theme
  isMobileMenuOpen: boolean
  isCartDrawerOpen: boolean
  isSearchOpen: boolean
  activeNavLink: string

  setTheme: (theme: Theme) => void
  toggleMobileMenu: () => void
  setMobileMenuOpen: (open: boolean) => void
  setCartDrawerOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
  setActiveNavLink: (link: string) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: 'system',
      isMobileMenuOpen: false,
      isCartDrawerOpen: false,
      isSearchOpen: false,
      activeNavLink: '/',

      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },

      toggleMobileMenu: () => set((s) => ({ isMobileMenuOpen: !s.isMobileMenuOpen })),
      setMobileMenuOpen: (open) => set({ isMobileMenuOpen: open }),
      setCartDrawerOpen: (open) => set({ isCartDrawerOpen: open }),
      setSearchOpen: (open) => set({ isSearchOpen: open }),
      setActiveNavLink: (link) => set({ activeNavLink: link }),
    }),
    {
      name: 'akunga-ui',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const isDark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  if (isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('akunga-ui')
  if (saved) {
    try {
      const { state } = JSON.parse(saved)
      if (state?.theme) applyTheme(state.theme)
    } catch {
      // ignore parse errors
    }
  }
}
