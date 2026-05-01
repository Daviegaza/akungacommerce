import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We encountered an unexpected error. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
      <div className="mb-6 rounded-full bg-red-50 p-6 dark:bg-red-900/20">
        <AlertTriangle className="h-12 w-12 text-red-500 dark:text-red-400" />
      </div>
      <h3 className="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
        {title}
      </h3>
      <p className="text-surface-500 dark:text-surface-400 max-w-sm mb-6">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Button>
      )}
    </div>
  )
}
