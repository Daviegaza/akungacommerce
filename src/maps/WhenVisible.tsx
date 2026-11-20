import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Renders `children` only once the placeholder is near the viewport (or right
 * away where IntersectionObserver is missing). Used to keep MapLibre out of a
 * screen's first load when the map sits below the fold.
 */
export function WhenVisible({ children, fallback, rootMargin = '200px' }: { children: ReactNode; fallback: ReactNode; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])

  return visible ? <>{children}</> : <div ref={ref}>{fallback}</div>
}
