import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProductImagesProps {
  images: string[]
  name: string
}

export function ProductImages({ images, name }: ProductImagesProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isZoomed, setIsZoomed] = useState(false)
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 })

  const navigate = (dir: 'prev' | 'next') => {
    setActiveIndex((i) => (dir === 'prev' ? (i - 1 + images.length) % images.length : (i + 1) % images.length))
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomed) return
    const rect = e.currentTarget.getBoundingClientRect()
    setZoomPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    })
  }

  return (
    <div className="space-y-4">
      {/* Main image */}
      <div
        className="relative overflow-hidden rounded-3xl bg-surface-100 dark:bg-surface-800 aspect-square cursor-crosshair group"
        onMouseEnter={() => setIsZoomed(true)}
        onMouseLeave={() => setIsZoomed(false)}
        onMouseMove={handleMouseMove}
      >
        <AnimatePresence mode="wait">
          <motion.img
            key={activeIndex}
            src={images[activeIndex]}
            alt={`${name} - Image ${activeIndex + 1}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'h-full w-full object-cover transition-transform duration-200',
              isZoomed && 'scale-150'
            )}
            style={
              isZoomed
                ? { transformOrigin: `${zoomPos.x}% ${zoomPos.y}%` }
                : undefined
            }
          />
        </AnimatePresence>

        {/* Zoom indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-xl bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 opacity-0 group-hover:opacity-100 transition-opacity">
          <ZoomIn className="h-3.5 w-3.5" />
          Hover to zoom
        </div>

        {/* Nav arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); navigate('prev') }}
              className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white dark:bg-surface-800 shadow-lg flex items-center justify-center text-surface-700 dark:text-surface-200 hover:scale-110 transition-all opacity-0 group-hover:opacity-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate('next') }}
              className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white dark:bg-surface-800 shadow-lg flex items-center justify-center text-surface-700 dark:text-surface-200 hover:scale-110 transition-all opacity-0 group-hover:opacity-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={cn(
                'relative shrink-0 overflow-hidden rounded-xl h-20 w-20 transition-all duration-200',
                i === activeIndex
                  ? 'ring-2 ring-brand-600 dark:ring-brand-400 ring-offset-2 ring-offset-white dark:ring-offset-surface-900'
                  : 'opacity-60 hover:opacity-100'
              )}
            >
              <img
                src={img}
                alt={`${name} thumbnail ${i + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
