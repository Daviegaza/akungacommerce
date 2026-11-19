/* eslint-disable react-refresh/only-export-components -- editor helpers live next to the fields that use them */
import { useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, ImagePlus, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, Field, Input, Switch, Thumb } from '../ui/primitives'

export const MAX_IMAGES = 10

export interface ImageDraft {
  key: string
  url: string
  alt: string
}

/** Only absolute https URLs are accepted for product photos. */
export function imageUrlError(url: string): string | undefined {
  const v = url.trim()
  if (!v) return 'Paste an image link'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return 'Not a valid link'
  }
  if (u.protocol !== 'https:') return 'Use a secure link that starts with https://'
  return undefined
}

/** ISO instant -> value for <input type="datetime-local"> in this device's time zone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** datetime-local value (device time zone) -> ISO instant, or null when empty/invalid. */
export function localInputToIso(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const SWATCH_RE = /^#[0-9a-f]{6}$/i

const SWATCH_PRESETS = ['#111827', '#ffffff', '#9ca3af', '#7c2d12', '#dc2626', '#f97316', '#facc15', '#16a34a', '#0ea5e9', '#1d4ed8', '#7c3aed', '#ec4899']

/** Colour chip picker for a variant: presets plus a custom colour. Empty = no swatch. */
export function SwatchPicker({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  labelledBy: string
}) {
  const current = value.toLowerCase()
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        disabled={disabled}
        onClick={() => onChange('')}
        className={cn(
          'flex h-9 items-center rounded-full px-3 text-xs font-semibold ring-1 transition-shadow disabled:opacity-50',
          !value ? 'bg-primary text-on-primary ring-primary' : 'bg-panel text-ink-2 ring-line-strong hover:ring-ink-3',
        )}
      >
        None
      </button>
      {SWATCH_PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={current === hex}
          aria-label={`Colour ${hex}`}
          disabled={disabled}
          onClick={() => onChange(hex)}
          className={cn(
            'size-9 rounded-full ring-1 ring-black/10 transition-[box-shadow,transform] hover:scale-105 disabled:opacity-50',
            current === hex && 'shadow-[0_0_0_2px_var(--ak-panel),0_0_0_4px_var(--ak-brand)]',
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
      <label
        className={cn(
          'relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-line-strong',
          value && !SWATCH_PRESETS.includes(current) && 'shadow-[0_0_0_2px_var(--ak-panel),0_0_0_4px_var(--ak-brand)]',
          disabled && 'pointer-events-none opacity-50',
        )}
        style={{
          background: value && !SWATCH_PRESETS.includes(current) ? value : 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)',
        }}
        title="Custom colour"
      >
        <span className="sr-only">Custom colour</span>
        <input
          type="color"
          value={SWATCH_RE.test(value) ? value : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

/**
 * Storefront section of the product editor: photos (https links), featured flag
 * and an honest scheduled drop time. Controlled by ProductEditorSheet.
 */
export function ProductMerchandising({
  productName,
  images,
  onImagesChange,
  featured,
  onFeaturedChange,
  dropAt,
  onDropAtChange,
  readOnly,
  attempted,
  nowMs,
}: {
  productName: string
  images: ImageDraft[]
  onImagesChange: (next: ImageDraft[]) => void
  featured: boolean
  onFeaturedChange: (v: boolean) => void
  /** datetime-local value in the device time zone, '' = no drop. */
  dropAt: string
  onDropAtChange: (v: string) => void
  readOnly?: boolean
  attempted: boolean
  nowMs: number
}) {
  const [pendingUrl, setPendingUrl] = useState('')
  const [pendingError, setPendingError] = useState<string | undefined>()
  const pendingValid = pendingUrl.trim() !== '' && !imageUrlError(pendingUrl)
  const full = images.length >= MAX_IMAGES

  const add = () => {
    const err = imageUrlError(pendingUrl)
    if (err) {
      setPendingError(err)
      return
    }
    if (images.some((i) => i.url === pendingUrl.trim())) {
      setPendingError('This photo is already added')
      return
    }
    onImagesChange([...images, { key: crypto.randomUUID(), url: pendingUrl.trim(), alt: '' }])
    setPendingUrl('')
    setPendingError(undefined)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return
    const next = [...images]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onImagesChange(next)
  }
  const patch = (key: string, p: Partial<ImageDraft>) => onImagesChange(images.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const dropIso = localInputToIso(dropAt)
  const dropInPast = dropIso != null && Date.parse(dropIso) <= nowMs
  const dropInvalid = dropAt.trim() !== '' && dropIso == null

  return (
    <section aria-labelledby="merch-h" className="flex flex-col gap-5 rounded-[var(--radius-card)] bg-sunken/60 p-4 sm:p-5">
      <div>
        <h3 id="merch-h" className="font-display text-[17px] font-bold tracking-tight text-ink">
          Storefront
        </h3>
        <p className="text-xs text-ink-3">How this product looks in your online shop. The first photo is the cover.</p>
      </div>

      {/* Photos */}
      <div>
        <p className="mb-2 text-[13px] font-semibold text-ink">
          Photos <span className="tnum font-normal text-ink-3">{images.length}/{MAX_IMAGES}</span>
        </p>
        {images.length > 0 && (
          <ol className="mb-3 flex flex-col gap-2">
            {images.map((img, i) => {
              const err = attempted ? imageUrlError(img.url) : undefined
              return (
                <li key={img.key} className="flex items-start gap-3 rounded-2xl bg-panel p-2.5 ring-1 ring-line/60">
                  <span className="relative shrink-0">
                    <Thumb src={img.url} alt={img.alt || productName || 'Product photo'} className="size-16" />
                    {i === 0 && (
                      <span className="absolute -top-1.5 -left-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-on-brand">Cover</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-ink-3" title={img.url}>
                      {img.url}
                    </p>
                    {err && (
                      <p role="alert" className="text-xs font-medium text-neg">
                        {err}
                      </p>
                    )}
                    <label className="mt-1.5 block">
                      <span className="sr-only">Alt text for photo {i + 1}</span>
                      <Input
                        value={img.alt}
                        maxLength={200}
                        onChange={(e) => patch(img.key, { alt: e.target.value })}
                        placeholder={`Describe the photo (default: ${productName || 'product name'})`}
                        className="h-9 text-[13px]"
                        disabled={readOnly}
                      />
                    </label>
                  </div>
                  {!readOnly && (
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => move(i, i - 1)}
                        disabled={i === 0}
                        aria-label={`Move photo ${i + 1} up`}
                        className="flex size-9 items-center justify-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-30"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, i + 1)}
                        disabled={i === images.length - 1}
                        aria-label={`Move photo ${i + 1} down`}
                        className="flex size-9 items-center justify-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onImagesChange(images.filter((x) => x.key !== img.key))}
                        aria-label={`Remove photo ${i + 1}`}
                        className="flex size-9 items-center justify-center rounded-full text-ink-3 hover:bg-neg-soft hover:text-neg"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {!readOnly && (
          <Field
            label="Add a photo link"
            error={pendingError}
            hint={full ? `You can add up to ${MAX_IMAGES} photos.` : 'Paste a public https:// image link, e.g. from your website or cloud storage. Square photos look best.'}
          >
            {(p) => (
              <div className="flex items-start gap-2">
                <span className="shrink-0">
                  {pendingValid ? (
                    <Thumb src={pendingUrl.trim()} alt="Preview of the photo link" className="size-11" />
                  ) : (
                    <span className="flex size-11 items-center justify-center rounded-xl bg-panel text-ink-3 ring-1 ring-line" aria-hidden>
                      <ImagePlus className="size-5" />
                    </span>
                  )}
                </span>
                <Input
                  {...p}
                  type="url"
                  inputMode="url"
                  value={pendingUrl}
                  disabled={full}
                  onChange={(e) => {
                    setPendingUrl(e.target.value)
                    setPendingError(undefined)
                  }}
                  onKeyDown={onKey}
                  placeholder="https://…"
                />
                <Button onClick={add} disabled={full || !pendingUrl.trim()} className="shrink-0">
                  Add
                </Button>
              </div>
            )}
          </Field>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Switch
          checked={featured}
          onChange={onFeaturedChange}
          disabled={readOnly}
          label="Feature on shop home"
          description="Featured products appear first, marked with a star."
        />
        {featured && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-warn">
            <Star className="size-3.5 fill-current" aria-hidden /> Featured
          </p>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Field
          label="Scheduled drop"
          optional
          error={attempted && dropInvalid ? 'Pick a valid date and time' : undefined}
          hint={
            dropInPast
              ? 'This time has passed, so the product is on sale now. Clear it or pick a future time.'
              : "Shoppers can see the product with its drop time but can't buy it before then. The time is real: it never moves or resets on its own. Uses this device's time zone."
          }
        >
          {(p) => (
            <div className="flex items-center gap-2">
              <span className="relative flex-1">
                <CalendarClock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input {...p} type="datetime-local" value={dropAt} disabled={readOnly} onChange={(e) => onDropAtChange(e.target.value)} className="pl-10" />
              </span>
              {dropAt && !readOnly && (
                <Button variant="ghost" size="sm" onClick={() => onDropAtChange('')}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </Field>
      </div>
    </section>
  )
}
