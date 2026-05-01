import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface ReducedMotionContextType {
  prefersReducedMotion: boolean
}

const ReducedMotionContext = createContext<ReducedMotionContextType>({
  prefersReducedMotion: false,
})

export function useReducedMotion() {
  return useContext(ReducedMotionContext)
}

export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)

    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return (
    <ReducedMotionContext.Provider value={{ prefersReducedMotion }}>
      {children}
    </ReducedMotionContext.Provider>
  )
}
