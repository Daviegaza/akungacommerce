import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useScrollToTop } from '@/hooks/usePageTransition'

const pageVariants = {
  initial: {
    opacity: 0,
    y: 12,
    scale: 0.995,
  },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.35,
      ease: 'easeOut' as const,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.995,
    transition: {
      duration: 0.2,
      ease: 'easeIn' as const,
    },
  },
}

interface PageTransitionProps {
  children: React.ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation()
  useScrollToTop()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="enter"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
