/* eslint-disable react-refresh/only-export-components -- editor helpers live next to the fields that use them */
import type { Dispatch, SetStateAction } from 'react'
import { CalendarClock, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, Field, Input, Switch } from '../ui/primitives'
import { ProductPhotos, type ImageDraft } from './ProductPhotos'

export { MAX_IMAGES, imageUrlError, type ImageDraft } from './ProductPhotos'

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
          'flex h-9 items-center rounded-lg px-3 text-xs font-medium ring-1 transition-shadow disabled:opacity-50',
          !value ? 'bg-sunken text-ink ring-ink' : 'bg-panel text-ink-2 ring-line-strong hover:ring-ink-3',
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
 * Storefront section of the product editor: photos (uploads or https links), featured flag
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
  onImagesChange: Dispatch<SetStateAction<ImageDraft[]>>
  featured: boolean
  onFeaturedChange: (v: boolean) => void
  /** datetime-local value in the device time zone, '' = no drop. */
  dropAt: string
  onDropAtChange: (v: string) => void
  readOnly?: boolean
  attempted: boolean
  nowMs: number
}) {
  const dropIso = localInputToIso(dropAt)
  const dropInPast = dropIso != null && Date.parse(dropIso) <= nowMs
  const dropInvalid = dropAt.trim() !== '' && dropIso == null

  return (
    <section aria-labelledby="merch-h" className="flex min-w-0 flex-col gap-5 border-t border-line pt-6">
      <div>
        <h3 id="merch-h" className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Storefront
        </h3>
        <p className="mt-0.5 text-xs text-ink-3">How this product looks in your online shop. The first photo is the cover.</p>
      </div>

      <ProductPhotos productName={productName} images={images} onImagesChange={onImagesChange} readOnly={readOnly} attempted={attempted} />

      <div className="border-t border-line pt-4">
        <Switch
          checked={featured}
          onChange={onFeaturedChange}
          disabled={readOnly}
          label="Feature on shop home"
          description="Featured products appear first, marked with a star."
        />
        {featured && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <Star className="size-3.5 text-ink-3" aria-hidden /> Featured
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
