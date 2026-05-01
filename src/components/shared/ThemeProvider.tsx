import { useEffect } from 'react'
import { useUIStore } from '@/store/uiStore'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    const isDark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (mq.matches) document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return <>{children}</>
}
