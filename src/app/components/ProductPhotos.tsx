/* eslint-disable react-refresh/only-export-components -- photo helpers live next to the component that uses them */
import { useEffect, useId, useRef, useState, type Dispatch, type DragEvent, type KeyboardEvent, type SetStateAction } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Camera, ImagePlus, Link2, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_PROFILE, ImageCompressionError, STORAGE_PROFILE, compressImage, formatBytes, MAX_INPUT_BYTES, validateImageFile } from '@/media/compress'
import { DEMO_MAX_UPLOADED_IMAGES, isUploadedImageUrl } from '@/media/upload'
import { useGateway, useOrg } from '../context'
import { Notice } from '../ui/layout'
import { Button, Field, Input, Thumb } from '../ui/primitives'

export const MAX_IMAGES = 10

export interface PhotoUpload {
  status: 'compressing' | 'uploading' | 'error'
  /** 0..1 while uploading */
  progress: number
  error?: string
  /** Original file, kept so a failed photo can be retried. */
  file: File
}

export interface ImageDraft {
  key: string
  /** '' until an uploaded photo has finished uploading. */
  url: string
  alt: string
  /** Present while a device photo is being compressed/uploaded, or after it failed. */
  upload?: PhotoUpload
  /** Local object URL of the compressed photo, shown while (and after) it uploads. */
  preview?: string
  /** Uploaded in this editing session and not saved to the product yet. */
  fresh?: boolean
}

/** Photos uploaded in this session that the product does not reference: safe to delete when the editor closes. */
export function unsavedUploads(images: ImageDraft[], saved: ReadonlySet<string>): string[] {
  return images.filter((i) => i.fresh && i.url && !saved.has(i.url)).map((i) => i.url)
}

/** Only absolute https URLs are accepted for pasted photo links. */
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

/** Validation for one photo in the editor. Uploads in progress are not errors (saving waits for them). */
export function imageDraftError(img: ImageDraft): string | undefined {
  if (img.upload?.status === 'error') return img.upload.error ?? 'Upload failed. Retry or remove this photo.'
  if (img.upload) return undefined
  if (isUploadedImageUrl(img.url)) return undefined
  return imageUrlError(img.url)
}

export function photosBusy(images: ImageDraft[]): boolean {
  return images.some((i) => i.upload && i.upload.status !== 'error')
}

/** How many more photos can be added, and why not when 0. */
export function photoCapacity(images: ImageDraft[], demo: boolean): { left: number; reason: string | null } {
  const totalLeft = MAX_IMAGES - images.length
  if (!demo) return { left: Math.max(0, totalLeft), reason: totalLeft <= 0 ? `You can add up to ${MAX_IMAGES} photos.` : null }
  const uploaded = images.filter((i) => i.upload || i.url.startsWith('data:')).length
  const uploadLeft = DEMO_MAX_UPLOADED_IMAGES - uploaded
  const left = Math.max(0, Math.min(totalLeft, uploadLeft))
  if (left > 0) return { left, reason: null }
  return {
    left: 0,
    reason: totalLeft <= 0 ? `You can add up to ${MAX_IMAGES} photos.` : `The demo workspace keeps up to ${DEMO_MAX_UPLOADED_IMAGES} uploaded photos per product.`,
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ImageCompressionError) return e.message
  if (e instanceof Error && e.message) return e.message
  return 'Upload failed. Retry.'
}

const ROUND_BTN =
  'flex size-9 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

/**
 * Product photo manager: add from the device (file picker, camera, drag and
 * drop) with client-side compression and upload, or paste an https link.
 * Reorder with buttons (first = cover), remove, and set alt text.
 */
export function ProductPhotos({
  productName,
  images,
  onImagesChange,
  readOnly,
  attempted,
}: {
  productName: string
  images: ImageDraft[]
  onImagesChange: Dispatch<SetStateAction<ImageDraft[]>>
  readOnly?: boolean
  attempted: boolean
}) {
  const gateway = useGateway()
  const { org } = useOrg()
  const demo = gateway.mode === 'demo'
  const profile = demo ? DEMO_PROFILE : STORAGE_PROFILE
  const ids = useId()

  const [rejected, setRejected] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [pendingUrl, setPendingUrl] = useState('')
  const [pendingError, setPendingError] = useState<string | undefined>()

  // Uploads run one at a time (decoding several 12 MP photos at once can exhaust phone memory).
  const queue = useRef<Promise<void>>(Promise.resolve())
  const controllers = useRef(new Map<string, AbortController>())
  const objectUrls = useRef<string[]>([])
  useEffect(() => {
    const ctrls = controllers.current
    const urls = objectUrls.current
    return () => {
      ctrls.forEach((c) => c.abort())
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const capacity = photoCapacity(images, demo)
  const pendingValid = pendingUrl.trim() !== '' && !imageUrlError(pendingUrl)

  const patchDraft = (key: string, p: Partial<ImageDraft>) => onImagesChange((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  async function runUpload(key: string, file: File, ctrl: AbortController) {
    // Removed (or editor closed) while waiting in the queue: don't start.
    if (ctrl.signal.aborted) return
    try {
      patchDraft(key, { upload: { status: 'compressing', progress: 0, file } })
      const compressed = await compressImage(file, profile)
      if (ctrl.signal.aborted) return
      const preview = URL.createObjectURL(compressed.blob)
      objectUrls.current.push(preview)
      patchDraft(key, { preview, upload: { status: 'uploading', progress: 0, file } })
      const url = await gateway.uploadProductImage(org.id, compressed.blob, {
        signal: ctrl.signal,
        onProgress: (progress) => {
          if (!ctrl.signal.aborted) patchDraft(key, { upload: { status: 'uploading', progress, file } })
        },
      })
      if (ctrl.signal.aborted) return
      patchDraft(key, { url, upload: undefined, fresh: true })
    } catch (e) {
      if (!ctrl.signal.aborted) patchDraft(key, { upload: { status: 'error', progress: 0, error: errorMessage(e), file } })
    } finally {
      if (controllers.current.get(key) === ctrl) controllers.current.delete(key)
    }
  }

  function enqueue(key: string, file: File) {
    const ctrl = new AbortController()
    controllers.current.set(key, ctrl)
    queue.current = queue.current.then(() => runUpload(key, file, ctrl))
  }

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list)
    if (!files.length) return
    const problems: string[] = []
    const accepted: File[] = []
    for (const f of files) {
      const err = validateImageFile(f)
      if (err) problems.push(err)
      else accepted.push(f)
    }
    const fits = accepted.slice(0, capacity.left)
    const drafts: ImageDraft[] = fits.map((file) => ({
      key: crypto.randomUUID(),
      url: '',
      alt: '',
      upload: { status: 'compressing', progress: 0, file },
    }))
    if (accepted.length > fits.length) {
      const skipped = accepted.length - fits.length
      const reason = photoCapacity([...images, ...drafts], demo).reason ?? ''
      problems.push(`${skipped} photo${skipped === 1 ? ' was' : 's were'} not added. ${reason}`.trim())
    }
    setRejected(problems)
    if (!drafts.length) return
    onImagesChange((prev) => [...prev, ...drafts])
    drafts.forEach((d) => enqueue(d.key, d.upload!.file))
  }

  function remove(img: ImageDraft) {
    controllers.current.get(img.key)?.abort()
    onImagesChange((list) => list.filter((x) => x.key !== img.key))
    // Uploaded in this session and never saved: delete it now (best effort; the scheduled cleanup catches misses).
    if (img.fresh && img.url) void gateway.deleteProductImage(org.id, img.url).catch(() => undefined)
  }

  function retry(img: ImageDraft) {
    if (!img.upload) return
    const file = img.upload.file
    patchDraft(img.key, { upload: { status: 'compressing', progress: 0, file } })
    enqueue(img.key, file)
  }

  const move = (from: number, to: number) =>
    onImagesChange((list) => {
      if (to < 0 || to >= list.length) return list
      const next = [...list]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })

  const addLink = () => {
    const err = imageUrlError(pendingUrl)
    if (err) return setPendingError(err)
    if (images.some((i) => i.url === pendingUrl.trim())) return setPendingError('This photo is already added')
    if (images.length >= MAX_IMAGES) return setPendingError(`You can add up to ${MAX_IMAGES} photos.`)
    onImagesChange((list) => [...list, { key: crypto.randomUUID(), url: pendingUrl.trim(), alt: '' }])
    setPendingUrl('')
    setPendingError(undefined)
  }
  const onLinkKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addLink()
    }
  }

  const onDragOver = (e: DragEvent) => {
    if (readOnly || !Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = capacity.left > 0 ? 'copy' : 'none'
    setDragging(true)
  }
  const onDrop = (e: DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const full = capacity.left <= 0
  const busy = photosBusy(images)

  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-ink">
        Photos <span className="tnum font-normal text-ink-3">{images.length}/{MAX_IMAGES}</span>
      </p>

      {images.length > 0 && (
        <ol className="mb-3 flex flex-col gap-2" aria-label="Product photos, first is the cover">
          {images.map((img, i) => {
            const err = img.upload?.status === 'error' ? img.upload.error : attempted ? imageDraftError(img) : undefined
            const src = img.preview ?? (img.url || null)
            const uploading = img.upload && img.upload.status !== 'error'
            const label = img.alt || productName || 'Product photo'
            return (
              <li key={img.key} className="flex items-start gap-3 rounded-2xl bg-panel p-2.5 ring-1 ring-line/60">
                <span className="relative shrink-0">
                  <Thumb src={src} alt={label} className={cn('size-16', uploading && 'opacity-60')} />
                  {uploading && (
                    <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                      <Loader2 className="size-5 animate-spin text-ink" />
                    </span>
                  )}
                  {img.upload?.status === 'error' && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-neg-soft/80 text-neg" aria-hidden>
                      <AlertCircle className="size-5" />
                    </span>
                  )}
                  {i === 0 && (
                    <span className="absolute -top-1.5 -left-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-on-brand">Cover</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div aria-live="polite" className="min-h-[18px]">
                    {img.upload?.status === 'compressing' && <p className="text-xs font-medium text-ink-2">Preparing photo…</p>}
                    {img.upload?.status === 'uploading' && (
                      <div className="flex items-center gap-2">
                        <span
                          role="progressbar"
                          aria-label={`Uploading photo ${i + 1}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(img.upload.progress * 100)}
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
                        >
                          <span
                            className="block h-full rounded-full bg-brand transition-[width] duration-200"
                            style={{ width: `${Math.max(4, Math.round(img.upload.progress * 100))}%` }}
                          />
                        </span>
                        <span className="tnum text-xs font-medium text-ink-2">{Math.round(img.upload.progress * 100)}%</span>
                      </div>
                    )}
                    {err && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p role="alert" className="text-xs font-medium text-neg">
                          {err}
                        </p>
                        {img.upload?.status === 'error' && !readOnly && (
                          <button
                            type="button"
                            onClick={() => retry(img)}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 text-xs font-semibold text-ink underline underline-offset-2 hover:text-brand"
                          >
                            <RotateCcw className="size-3" aria-hidden /> Retry
                          </button>
                        )}
                      </div>
                    )}
                    {!img.upload && !err && (
                      <p className="truncate text-[11px] text-ink-3" title={isUploadedImageUrl(img.url) ? undefined : img.url}>
                        {isUploadedImageUrl(img.url) ? 'Uploaded photo' : <span className="font-mono">{img.url}</span>}
                      </p>
                    )}
                  </div>
                  <label className="mt-1.5 block">
                    <span className="sr-only">Alt text for photo {i + 1}</span>
                    <Input
                      value={img.alt}
                      maxLength={200}
                      onChange={(e) => patchDraft(img.key, { alt: e.target.value })}
                      placeholder={`Describe the photo (default: ${productName || 'product name'})`}
                      className="h-9 text-[13px]"
                      disabled={readOnly}
                    />
                  </label>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move photo ${i + 1} up`} className={ROUND_BTN}>
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, i + 1)}
                      disabled={i === images.length - 1}
                      aria-label={`Move photo ${i + 1} down`}
                      className={ROUND_BTN}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(img)}
                      aria-label={uploading ? `Cancel and remove photo ${i + 1}` : `Remove photo ${i + 1}`}
                      className={cn(ROUND_BTN, 'hover:bg-neg-soft hover:text-neg')}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-3">
          <div
            onDragOver={onDragOver}
            onDragEnter={onDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
            }}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors',
              dragging ? 'border-brand bg-brand-soft/60' : 'border-line-strong bg-panel/60',
              full && 'opacity-60',
            )}
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
              <ImagePlus className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{dragging ? 'Drop photos to add them' : 'Add photos from your phone or computer'}</p>
              <p id={`${ids}-hint`} className="mt-0.5 text-xs text-ink-3">
                {full
                  ? capacity.reason
                  : `JPG, PNG, WebP or HEIC, up to ${formatBytes(MAX_INPUT_BYTES)} each. Photos are resized before upload. Square photos look best.`}
                <span className="hidden sm:inline">{full ? '' : ' You can also drag them here.'}</span>
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <label
                className={cn(
                  'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-solid',
                  full && 'pointer-events-none opacity-50',
                )}
              >
                <Upload className="size-4" aria-hidden />
                Choose photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={full}
                  aria-describedby={`${ids}-hint`}
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              {/* Camera shortcut on touch devices; "Choose photos" also offers the camera on most phones. */}
              <label
                className={cn(
                  'hidden h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-strong bg-panel px-4 text-sm font-semibold text-ink pointer-coarse:inline-flex hover:bg-sunken',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-solid',
                  full && 'pointer-events-none opacity-50',
                )}
              >
                <Camera className="size-4" aria-hidden />
                Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={full}
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          {rejected.length > 0 && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl bg-neg-soft px-4 py-3 text-sm text-neg">
              <ul className="flex flex-col gap-1">
                {rejected.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" className="-my-1 shrink-0 text-neg hover:text-neg" onClick={() => setRejected([])}>
                Dismiss
              </Button>
            </div>
          )}

          {busy && <p className="text-xs text-ink-3">You can keep editing while photos upload. Saving waits until they finish.</p>}

          {demo && (
            <Notice>
              Demo workspace: photos are kept in this browser only and shrunk to save space (browsers allow about 5 MB for the whole demo). Up to{' '}
              {DEMO_MAX_UPLOADED_IMAGES} uploaded photos per product.
            </Notice>
          )}

          <details className="group rounded-2xl">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg text-[13px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Link2 className="size-4" aria-hidden />
              Paste a photo link instead
            </summary>
            <div className="mt-3">
              <Field
                label="Photo link"
                error={pendingError}
                hint={images.length >= MAX_IMAGES ? `You can add up to ${MAX_IMAGES} photos.` : 'A public https:// image link, e.g. from your website or cloud storage.'}
              >
                {(p) => (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0">
                      {pendingValid ? (
                        <Thumb src={pendingUrl.trim()} alt="Preview of the photo link" className="size-11" />
                      ) : (
                        <span className="flex size-11 items-center justify-center rounded-xl bg-panel text-ink-3 ring-1 ring-line" aria-hidden>
                          <Link2 className="size-5" />
                        </span>
                      )}
                    </span>
                    <Input
                      {...p}
                      type="url"
                      inputMode="url"
                      value={pendingUrl}
                      disabled={images.length >= MAX_IMAGES}
                      onChange={(e) => {
                        setPendingUrl(e.target.value)
                        setPendingError(undefined)
                      }}
                      onKeyDown={onLinkKey}
                      placeholder="https://…"
                    />
                    <Button onClick={addLink} disabled={images.length >= MAX_IMAGES || !pendingUrl.trim()} className="shrink-0">
                      Add
                    </Button>
                  </div>
                )}
              </Field>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
