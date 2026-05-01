import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: { label: string; value: string }[]
  placeholder?: string
  className?: string
}

export function Select({ value, onValueChange, options, placeholder = 'Select...', className }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        className={cn(
          'inline-flex h-10 w-full items-center justify-between rounded-xl border-2 border-surface-200 bg-white px-4 text-sm text-surface-900',
          'focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:focus:border-brand-400',
          'transition-all duration-200',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 text-surface-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cn(
            'z-50 min-w-[8rem] overflow-hidden rounded-xl border border-surface-200 bg-white shadow-lg',
            'dark:border-surface-700 dark:bg-surface-900',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
          position="popper"
          sideOffset={8}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-10 text-sm outline-none',
                  'text-surface-700 dark:text-surface-300',
                  'hover:bg-surface-100 dark:hover:bg-surface-800',
                  'data-[state=checked]:text-surface-900 dark:data-[state=checked]:text-surface-100',
                  'data-[state=checked]:bg-brand-50 dark:data-[state=checked]:bg-brand-900/20',
                  'transition-colors duration-100'
                )}
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
