import { Sun, Moon, Monitor } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  const themes = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ]

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-xl bg-surface-100 p-1 dark:bg-surface-800',
        className
      )}
      role="radiogroup"
      aria-label="Color theme"
    >
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={cn(
            'relative flex items-center justify-center rounded-lg p-2 transition-all duration-200',
            'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300',
            theme === value &&
              'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-100'
          )}
          aria-label={`${label} mode`}
          aria-pressed={theme === value}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}
