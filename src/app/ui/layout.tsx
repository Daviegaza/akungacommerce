import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './primitives'

/** Page title row. Actions wrap under the title on narrow screens. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** An open section: heading + hairline, no box. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-10', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-end justify-between gap-3 border-b border-line pb-2">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-y border-dashed border-line py-10 sm:items-center sm:text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div>
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {body && <p className="mt-1 max-w-md text-sm text-ink-3">{body}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg bg-neg-soft px-4 py-3 text-sm text-neg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg px-4 py-3 text-sm', tone === 'info' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn')}>
      {children}
    </div>
  )
}

/** Key/value list used on detail pages. */
export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
          <dt className="text-ink-3">{it.label}</dt>
          <dd className="min-w-0 text-right text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Stat without a box: label, big number, optional footnote. */
export function Stat({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
      <p className="tnum mt-1 truncate text-2xl font-semibold tracking-[-0.02em] text-ink">{value}</p>
      {foot && <p className="mt-0.5 text-xs text-ink-3">{foot}</p>}
    </div>
  )
}

/**
 * Side sheet on wide screens, bottom sheet on phones. Used for every create/edit
 * form so the list underneath stays in context.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content
          className={cn(
            'ak-root fixed z-50 flex flex-col bg-panel text-ink shadow-2xl focus:outline-none',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:rounded-none sm:border-l sm:border-line',
            wide ? 'sm:w-[640px]' : 'sm:w-[480px]',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-ink-3">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" className="-mr-2 px-2">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Plain semantic table with hairlines; wrap in a horizontal scroller on small screens. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <th scope="col" className={cn('border-b border-line py-2 pr-4 text-xs font-medium whitespace-nowrap text-ink-3 last:pr-0', align === 'right' ? 'text-right' : 'text-left', className)}>
      {children}
    </th>
  )
}
export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={cn('border-b border-line py-3 pr-4 align-middle last:pr-0', align === 'right' && 'tnum text-right', className)}>{children}</td>
}
