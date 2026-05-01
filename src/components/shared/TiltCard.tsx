import { useRef, useState, useCallback, type ReactNode } from 'react'
import { motion } from 'framer-motion'

interface TiltCardProps {
  children: ReactNode
  className?: string
  maxTilt?: number
  glare?: boolean
}

export function TiltCard({ children, className, maxTilt = 8, glare = true }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [rotate, setRotate] = useState({ x: 0, y: 0 })
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouse = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height

      setRotate({
        x: (y - 0.5) * -maxTilt * 2,
        y: (x - 0.5) * maxTilt * 2,
      })
      setGlarePos({ x: x * 100, y: y * 100 })
    },
    [maxTilt]
  )

  const reset = useCallback(() => {
    setRotate({ x: 0, y: 0 })
    setGlarePos({ x: 50, y: 50 })
    setIsHovered(false)
  }, [])

  return (
    <motion.div
      ref={ref}
      animate={{
        rotateX: rotate.x,
        rotateY: rotate.y,
      }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      onMouseMove={handleMouse}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={reset}
      style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
      className={className}
    >
      {children}
      {glare && (
        <div
          className="pointer-events-none absolute inset-0 rounded-inherit overflow-hidden transition-opacity duration-300"
          style={{ opacity: isHovered ? 0.15 : 0 }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, white, transparent 60%)`,
            }}
          />
        </div>
      )}
    </motion.div>
  )
}
