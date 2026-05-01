import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '@/lib/utils'

interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
  decorative?: boolean
}

export function Separator({
  orientation = 'horizontal',
  className,
  decorative = true,
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-surface-200 dark:bg-surface-800',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
    />
  )
}
