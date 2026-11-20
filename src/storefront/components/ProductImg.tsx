import { useState } from 'react'
import { cn } from '@/lib/utils'
import { initialOf } from './storefront-utils'

/**
 * Lazy product image with an honest fallback: a brand-tinted tile with the
 * product initial when the photo is missing or fails to load.
 */
export function ProductImg({
  src,
  name,
  className,
  eager,
  initialClassName,
}: {
  src: string | null | undefined
  name: string
  className?: string
  eager?: boolean
  initialClassName?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || failedSrc === src) {
    return (
      <div role="img" aria-label={name} className={cn('grid place-items-center bg-brand-soft text-brand select-none', className)}>
        <span className={cn('font-display text-4xl font-semibold leading-none', initialClassName)} aria-hidden>
          {initialOf(name)}
        </span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={cn('object-cover', className)}
    />
  )
}
