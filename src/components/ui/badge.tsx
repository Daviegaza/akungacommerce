import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'sale' | 'new'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300',
  success: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  sale: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-semibold',
  new: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 font-semibold',
}

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
