import { PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
      <div className="mb-6 rounded-full bg-surface-100 p-6 dark:bg-surface-800">
        {icon || <PackageOpen className="h-12 w-12 text-surface-400" />}
      </div>
      <h3 className="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-surface-500 dark:text-surface-400 max-w-sm mb-6">
          {description}
        </p>
      )}
      {action && (
        <Button variant="accent" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
