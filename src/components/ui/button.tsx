import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const variants = {
  primary:
    'bg-surface-900 text-white hover:bg-surface-800 dark:bg-white dark:text-surface-900 dark:hover:bg-surface-200 shadow-lg shadow-surface-900/10 dark:shadow-white/5',
  secondary:
    'bg-surface-100 text-surface-900 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-100 dark:hover:bg-surface-700',
  outline:
    'border-2 border-surface-200 text-surface-900 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-100 dark:hover:bg-surface-800',
  ghost: 'text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-surface-800',
  destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/20',
  accent:
    'bg-brand-600 text-white hover:bg-brand-700 shadow-lg shadow-brand-600/25 dark:shadow-brand-600/20',
}

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
  xl: 'h-14 px-8 text-lg gap-3 rounded-2xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 cursor-pointer',
          variants[variant],
          sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'

export { Button, type ButtonProps }
