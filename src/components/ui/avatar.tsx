import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string
  alt?: string
  fallback?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
}

export function Avatar({ src, alt = '', fallback, size = 'md', className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full',
        sizeClasses[size],
        className
      )}
    >
      <AvatarPrimitive.Image
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
      />
      <AvatarPrimitive.Fallback
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full font-semibold uppercase',
          'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
        )}
        delayMs={600}
      >
        {fallback?.slice(0, 2) || alt?.slice(0, 2) || '?'}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
