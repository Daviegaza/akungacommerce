import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'flex h-11 w-full rounded-xl border-2 border-surface-200 bg-white px-4 text-sm text-surface-900 placeholder:text-surface-400 transition-all duration-200',
              'file:border-0 file:bg-transparent file:text-sm file:font-medium',
              'focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/10',
              icon && 'pl-11',
              error && 'border-red-500 focus:border-red-500 focus:ring-red-500/10 dark:border-red-400 dark:focus:ring-red-400/10',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { Input, type InputProps }
