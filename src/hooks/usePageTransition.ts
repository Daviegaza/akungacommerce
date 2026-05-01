import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export function usePageTransition() {
  const location = useLocation()
  const prevPath = useRef(location.pathname)

  useEffect(() => {
    prevPath.current = location.pathname
  }, [location.pathname])

  return {
    isNavigating: prevPath.current !== location.pathname,
    currentPath: location.pathname,
    previousPath: prevPath.current,
  }
}

// Scroll to top on route change
export function useScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
}
