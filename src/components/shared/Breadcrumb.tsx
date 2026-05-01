import { Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 text-sm', className)}>
      <Link
        to="/"
        className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
        aria-label="Home"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-surface-300 dark:text-surface-600" />
          {item.href && i < items.length - 1 ? (
            <Link
              to={item.href}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors font-medium"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-surface-900 dark:text-surface-100 font-semibold truncate max-w-[200px]">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
