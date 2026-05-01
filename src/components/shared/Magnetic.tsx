import { useRef, useState, useCallback, type ReactNode } from 'react'
import { motion } from 'framer-motion'

interface MagneticProps {
  children: ReactNode
  strength?: number
  className?: string
}

export function Magnetic({ children, strength = 0.3, className }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleMouse = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const distX = e.clientX - centerX
      const distY = e.clientY - centerY

      setPosition({ x: distX * strength, y: distY * strength })
    },
    [strength]
  )

  const reset = useCallback(() => {
    setPosition({ x: 0, y: 0 })
  }, [])

  return (
    <motion.div
      ref={ref}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: 'spring', stiffness: 200, damping: 15, mass: 0.1 }}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      className={className}
    >
      {children}
    </motion.div>
  )
}
