import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartStore } from '@/store/cartStore'
import { useSearchStore } from '@/store/searchStore'
import { useUIStore } from '@/store/uiStore'

export function KeyboardShortcuts() {
  const navigate = useNavigate()
  const toggleCart = useCartStore((s) => s.toggleCart)
  const openSearch = useSearchStore((s) => s.openSearch)
  const setTheme = useUIStore((s) => s.setTheme)
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      // Cmd/Ctrl + K = Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openSearch()
        return
      }

      // Cmd/Ctrl + Shift + C = Cart
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault()
        toggleCart()
        return
      }

      // Cmd/Ctrl + Shift + D = Toggle dark mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setTheme(theme === 'dark' ? 'light' : 'dark')
        return
      }

      // Vim-style navigation: g + key
      const gPrefix = sessionStorage.getItem('ks-g-prefix')
      const gAge = gPrefix ? Date.now() - Number(gPrefix) : Infinity

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        sessionStorage.setItem('ks-g-prefix', String(Date.now()))
        return
      }

      if (gAge < 500 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        sessionStorage.removeItem('ks-g-prefix')
        switch (e.key) {
          case 'h':
            e.preventDefault()
            navigate('/')
            break
          case 'p':
            e.preventDefault()
            navigate('/products')
            break
          case 'c':
            e.preventDefault()
            navigate('/cart')
            break
          case 'a':
            e.preventDefault()
            navigate('/account')
            break
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, toggleCart, openSearch, setTheme, theme])

  return null
}
