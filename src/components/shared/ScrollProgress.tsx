import { useEffect, useState } from 'react'
import { motion, useSpring, useScroll } from 'framer-motion'

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > 100)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-50 h-[2px] origin-left"
    >
      <motion.div
        style={{ scaleX }}
        className="h-full bg-gradient-to-r from-brand-500 to-brand-400"
      />
    </motion.div>
  )
}
