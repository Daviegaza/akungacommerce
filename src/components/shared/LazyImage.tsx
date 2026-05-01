import { useState, useRef, useEffect, type ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  width?: number
  height?: number
  aspectRatio?: string
  blur?: boolean
  containerClassName?: string
}

export function LazyImage({
  src,
  alt,
  width,
  height,
  aspectRatio = '1 / 1',
  blur = true,
  className,
  containerClassName,
  ...props
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [inView, setInView] = useState(false)
  const imgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = imgRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={imgRef}
      className={cn('relative overflow-hidden', containerClassName)}
      style={{ aspectRatio, width: width ? `${width}px` : undefined }}
    >
      {/* Blur placeholder */}
      {blur && !loaded && (
        <div className="absolute inset-0 bg-surface-200 dark:bg-surface-800 animate-pulse" />
      )}

      {/* Low-res preview (optional: use a tiny base64 or thumbnail) */}
      {inView && (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            'h-full w-full object-cover transition-all duration-700',
            loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105',
            className
          )}
          {...props}
        />
      )}
    </div>
  )
}
