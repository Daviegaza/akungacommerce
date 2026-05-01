import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

interface AnimatedCounterProps {
  from?: number
  to: number
  duration?: number
  suffix?: string
  prefix?: string
  className?: string
  formatter?: (value: number) => string
}

export function AnimatedCounter({
  from = 0,
  to,
  duration = 1500,
  suffix = '',
  prefix = '',
  className = '',
  formatter,
}: AnimatedCounterProps) {
  const [count, setCount] = useState(from)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-50px' })
  const started = useRef(false)

  useEffect(() => {
    if (!inView || started.current) return
    started.current = true

    const startTime = performance.now()

    function animate(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased
      setCount(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setCount(to)
      }
    }

    requestAnimationFrame(animate)
  }, [inView, from, to, duration])

  const display = formatter ? formatter(count) : Math.round(count).toLocaleString()

  return (
    <span ref={ref} className={className}>
      {prefix}{display}{suffix}
    </span>
  )
}
