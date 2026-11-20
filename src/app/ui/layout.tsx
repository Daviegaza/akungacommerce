import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, Sparkline } from './primitives'

/** Page title row. Actions wrap under the title on narrow screens. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
  /** Small line above the title, e.g. a date. */
  eyebrow?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-line/80 pb-6 sm:mb-9 sm:flex-row sm:items-end sm:justify-between sm:pb-7">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        {eyebrow && <p className="mb-2 text-[11px] font-semibold tracking-[0.13em] text-ink-3 uppercase">{eyebrow}</p>}
        <h1 className="font-display text-[30px] leading-[1.08] font-semibold tracking-[-0.045em] text-ink sm:text-[34px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-2 sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * A titled block. `variant="open"` (default) is heading + content; `variant="card"`
 * wraps everything in a soft rounded surface.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  variant = 'open',
  icon,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  variant?: 'open' | 'card'
  icon?: ReactNode
}) {
  const card = variant === 'card'
  return (
    <section
      className={cn(
        'mb-8',
        card && 'rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:p-5',
        className,
      )}
    >
      {(title || actions) && (
        <div className={cn('mb-4 flex items-center justify-between gap-3', !card && 'pb-2')}>
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="flex shrink-0 items-center text-ink-3">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>}
              {description && <p className="mt-0.5 text-[12px] text-ink-3">{description}</p>}
            </div>
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
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-12 text-center">
      {icon && <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-ink-3">{icon}</div>}
      <div>
        <p className="font-display text-base font-semibold tracking-tight text-ink">{title}</p>
        {body && <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-3">{body}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-neg/25 bg-neg-soft px-4 py-3 text-sm text-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-neg" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-ink underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-relaxed text-ink-2', tone === 'info' ? 'border-line bg-sunken/60' : 'border-warn/25 bg-warn-soft')}>
      {tone === 'info' ? <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Key/value list used on detail pages. */
export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 py-3 text-sm">
          <dt className="text-ink-3">{it.label}</dt>
          <dd className="min-w-0 text-right font-medium text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Stat without a box: label, big number, optional footnote. */
export function Stat({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-ink-3">{label}</p>
      <p className="tnum mt-1 truncate font-display text-[26px] leading-tight font-semibold tracking-tight text-ink">{value}</p>
      {foot && <p className="mt-0.5 text-xs text-ink-3">{foot}</p>}
    </div>
  )
}

/**
 * KPI tile: label, headline value, comparison chip and an optional sparkline.
 * `change` is a ratio (0.12 = +12%); null hides the chip (e.g. no previous data).
 */
export function KpiTile({
  label,
  value,
  change,
  changeLabel = 'vs previous 14 days',
  spark,
  sparkLabel,
  foot,
  tone = 'brand',
  invert,
}: {
  label: string
  value: ReactNode
  change?: number | null
  changeLabel?: string
  spark?: number[]
  sparkLabel?: string
  foot?: ReactNode
  tone?: 'brand' | 'info' | 'pos' | 'warn'
  /** When true, a rise is bad (e.g. unpaid balance). */
  invert?: boolean
}) {
  const toneText = { brand: 'text-brand', info: 'text-info', pos: 'text-pos', warn: 'text-warn' }[tone]
  const up = change != null && change > 0
  const flat = change != null && Math.abs(change) < 0.005
  const good = flat ? null : invert ? !up : up
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-3">{label}</p>
        {change != null && Number.isFinite(change) && (
          <span
            className={cn(
              'tnum inline-flex h-5 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-semibold',
              good == null ? 'bg-sunken text-ink-2' : good ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg',
            )}
            title={changeLabel}
          >
            {flat ? null : up ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
            {flat ? '0%' : `${Math.abs(Math.round(change * 100))}%`}
            <span className="sr-only">
              {flat ? 'no change' : up ? 'up' : 'down'} {changeLabel}
            </span>
          </span>
        )}
      </div>
      <div className="tnum mt-2 min-w-0 font-display text-[clamp(1.05rem,5vw,1.75rem)] leading-tight font-semibold tracking-tight text-ink sm:text-[26px] xl:text-[28px]">{value}</div>
      <div className="mt-auto flex flex-col-reverse items-start gap-2 pt-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 text-xs text-ink-3">{foot}</div>
        {spark && sparkLabel && <Sparkline values={spark} label={sparkLabel} className={cn('shrink-0', toneText)} width={96} height={32} />}
      </div>
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0b0f17]/50 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content
          className={cn(
            'ak-root fixed z-50 flex flex-col bg-panel text-ink shadow-[var(--shadow-lift)] focus:outline-none',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-line data-[state=open]:animate-[fade-in-up_240ms_cubic-bezier(.2,.8,.2,1)]',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l sm:data-[state=open]:animate-[slide-in-right_240ms_cubic-bezier(.2,.8,.2,1)]',
            wide ? 'sm:w-[640px]' : 'sm:w-[480px]',
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-3 pb-3 sm:pt-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-ink-3">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" className="-mr-2 size-9 px-0">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Semantic table in a hairline panel; scrolls horizontally on small screens. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto border-y border-line bg-panel px-4 sm:mx-0 sm:rounded-[var(--radius-card)] sm:border sm:px-0 sm:[&_td:first-child]:pl-4 sm:[&_td:last-child]:pr-4 sm:[&_th:first-child]:pl-4 sm:[&_th:last-child]:pr-4">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <th scope="col" className={cn('border-b border-line bg-sunken/50 py-2.5 pr-4 text-xs font-medium whitespace-nowrap text-ink-3 last:pr-0', align === 'right' ? 'text-right' : 'text-left', className)}>
      {children}
    </th>
  )
}
export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={cn('border-b border-line py-3 pr-4 align-middle last:pr-0 [tr:last-child_&]:border-b-0', align === 'right' && 'tnum text-right', className)}>{children}</td>
}
