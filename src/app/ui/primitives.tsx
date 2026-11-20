/* eslint-disable react-refresh/only-export-components -- shared UI module exports small helpers next to components */
import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ImageOff, Loader2, Package } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ───────────── Button ───────────── */
type ButtonVariant = 'primary' | 'brand' | 'mango' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none transition-[transform,background-color,color,box-shadow,opacity] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50'
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  brand: 'bg-brand text-on-brand hover:bg-brand-strong',
  mango: 'bg-mango text-on-mango hover:brightness-95',
  secondary: 'bg-panel text-ink border border-line-strong hover:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-neg text-white hover:opacity-90',
}
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)
}

/** Round icon-only button. Always pass an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }>(function IconButton(
  { className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-sunken hover:text-ink active:scale-95 disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

/* ───────────── Form fields ───────────── */
const CONTROL =
  'w-full rounded-lg border border-line-strong bg-panel px-3.5 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] hover:border-ink-3 focus:border-brand focus:shadow-[0_0_0_3px_var(--ak-brand-soft)] focus:outline-none disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-neg'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-11', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-2.5 leading-relaxed', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237d7584' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  )
})

/**
 * Label + control + hint/error, wired with ids for screen readers.
 * The render prop receives the ids so any control can be used.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3"> (optional)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-neg">
          {error}
        </p>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {description && <p className="text-xs leading-relaxed text-ink-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)]',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/* ───────────── Badges ───────────── */
export type Tone = 'neutral' | 'pos' | 'warn' | 'neg' | 'info' | 'accent'
const TONE: Record<Tone | 'brand' | 'mango', string> = {
  brand: 'bg-brand text-on-brand',
  mango: 'bg-mango text-on-mango',
  neutral: 'bg-sunken text-ink-2',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  neg: 'bg-neg-soft text-neg',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
}

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone | 'brand' | 'mango'; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-3">
      <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
      {label}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-sunken', className)} aria-hidden />
}

/* ───────────── Surfaces ───────────── */

/** Soft rounded surface. `interactive` adds a hover lift for clickable cards. */
export function Card({
  className,
  interactive,
  children,
  as: As = 'div',
  ...rest
}: HTMLAttributes<HTMLElement> & { interactive?: boolean; as?: 'div' | 'section' | 'article' | 'li' }) {
  return (
    <As
      className={cn(
        'rounded-[var(--radius-card)] bg-panel shadow-[var(--shadow-card)] ring-1 ring-line/60',
        interactive && 'transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  )
}

/* ───────────── Avatar ───────────── */
const AVATAR_TONES = [
  'bg-brand-soft text-brand-strong',
  'bg-mango-soft text-warn',
  'bg-info-soft text-info',
  'bg-pos-soft text-pos',
  'bg-sunken text-ink-2',
] as const

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Initials avatar with a stable colour per name. Decorative: the name is always shown next to it. */
export function Avatar({ name, size = 40, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const tone = AVATAR_TONES[hashOf(name ?? '') % AVATAR_TONES.length]
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold', tone, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </span>
  )
}

/* ───────────── Thumbnail ───────────── */

/** Square product image with a calm placeholder when missing or broken. */
export function Thumb({
  src,
  alt,
  className,
  rounded = 'rounded-xl',
  iconClassName,
}: {
  src: string | null | undefined
  alt: string
  className?: string
  rounded?: string
  iconClassName?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = Boolean(src) && failedSrc === src
  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={failed ? `${alt} (image could not load)` : `${alt} (no photo yet)`}
        className={cn('flex aspect-square items-center justify-center bg-sunken text-ink-3', rounded, className)}
      >
        {failed ? <ImageOff className={cn('size-1/3 max-h-8 max-w-8', iconClassName)} aria-hidden /> : <Package className={cn('size-1/3 max-h-8 max-w-8', iconClassName)} aria-hidden />}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={cn('aspect-square bg-sunken object-cover', rounded, className)}
    />
  )
}

/* ───────────── Sparkline ───────────── */

/**
 * Tiny inline trend line. Values are drawn as-is (no smoothing, no invented points).
 * `label` describes it for screen readers.
 */
export function Sparkline({
  values,
  label,
  className,
  width = 120,
  height = 36,
}: {
  values: number[]
  label: string
  className?: string
  width?: number
  height?: number
}) {
  const gradId = useId()
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const pad = 3
  const stepX = (width - pad * 2) / (values.length - 1)
  const pts = values.map((v, i) => [pad + i * stepX, height - pad - ((v - min) / span) * (height - pad * 2)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height - pad} L${pts[0][0].toFixed(1)},${height - pad} Z`
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={cn('overflow-visible', className)}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3" fill="currentColor" />
    </svg>
  )
}

/* ───────────── Segmented tabs (pill style) ───────────── */

export interface PillTab<T extends string> {
  id: T
  label: string
  count?: number
  icon?: ReactNode
}

/** Horizontally scrolling pill tabs with counts. Acts as a tablist that filters the content below. */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: PillTab<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0', className)}>
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200',
              active ? 'bg-primary text-on-primary shadow-[0_6px_16px_-8px_rgb(14_20_32/0.5)]' : 'bg-panel text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong',
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  'tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                  active ? 'bg-on-primary/15 text-on-primary' : t.count > 0 ? 'bg-sunken text-ink' : 'text-ink-3',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
