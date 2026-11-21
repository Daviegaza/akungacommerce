import { createContext, type ReactNode } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'

interface ReducedMotionContextType {
  prefersReducedMotion: boolean
}

const ReducedMotionContext = createContext<ReducedMotionContextType>({
  prefersReducedMotion: false,
})

/** Provides the user's reduced-motion preference (live) to the classic template. */
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return <ReducedMotionContext.Provider value={{ prefersReducedMotion }}>{children}</ReducedMotionContext.Provider>
}
