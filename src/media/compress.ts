/**
 * Client-side product photo compression.
 *
 * The sizing, validation and attempt-planning logic is pure and unit tested.
 * The canvas part (decode -> draw -> encode) is a thin browser-only wrapper.
 */

/** Files bigger than this are rejected before we even try to decode them. */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024

/** Mime types the storage bucket accepts (and that we can produce). */
export const OUTPUT_TYPES = ['image/webp', 'image/jpeg'] as const
export type OutputType = (typeof OUTPUT_TYPES)[number]

export interface CompressionProfile {
  /** Longest side in pixels after resizing. */
  maxEdge: number
  /** Aim for this size or less. */
  targetBytes: number
  /** Never accept a result larger than this (falls back to the smallest attempt below it). */
  hardMaxBytes: number
}

/** Storage uploads: sharp enough for a full-width product page. */
export const STORAGE_PROFILE: CompressionProfile = { maxEdge: 1600, targetBytes: 500 * 1024, hardMaxBytes: 2 * 1024 * 1024 }

/**
 * Demo workspace: photos live inside browser localStorage (~5 MB for everything),
 * so they are kept much smaller.
 */
export const DEMO_PROFILE: CompressionProfile = { maxEdge: 1080, targetBytes: 160 * 1024, hardMaxBytes: 320 * 1024 }

export interface FileLike {
  name: string
  type: string
  size: number
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i

/** Returns a user-facing reason when the file can't be used, or null when it can. */
export function validateImageFile(file: FileLike): string | null {
  const looksLikeImage = file.type ? file.type.startsWith('image/') : IMAGE_EXT.test(file.name)
  if (!looksLikeImage) return `“${file.name}” is not a photo. Choose a JPG, PNG, WebP or HEIC image.`
  if (file.type === 'image/svg+xml') return `“${file.name}” is a drawing (SVG). Choose a photo instead.`
  if (file.size <= 0) return `“${file.name}” is empty.`
  if (file.size > MAX_INPUT_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)}. Photos must be ${formatBytes(MAX_INPUT_BYTES)} or smaller.`
  }
  return null
}

/** Scale (w, h) down so the longest side is at most maxEdge. Never upscales. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new Error('Image has no size')
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface EncodeAttempt {
  /** Multiplier on the fitted size (1 = full maxEdge). */
  scale: number
  quality: number
}

/**
 * Encoding attempts in order: lower quality first, then smaller dimensions.
 * Compression stops at the first attempt that meets the target.
 */
export function encodeAttempts(): EncodeAttempt[] {
  return [
    { scale: 1, quality: 0.82 },
    { scale: 1, quality: 0.72 },
    { scale: 1, quality: 0.62 },
    { scale: 0.8, quality: 0.68 },
    { scale: 0.65, quality: 0.64 },
    { scale: 0.5, quality: 0.6 },
  ]
}

/**
 * Pick the result to keep from the attempts made so far: the first one at or
 * under target, otherwise the smallest under the hard max, otherwise null.
 */
export function chooseResult<T extends { size: number }>(results: T[], profile: CompressionProfile): T | null {
  const hit = results.find((r) => r.size <= profile.targetBytes)
  if (hit) return hit
  const ok = results.filter((r) => r.size <= profile.hardMaxBytes).sort((a, b) => a.size - b.size)
  return ok[0] ?? null
}

/** Exact byte length of a base64 data URL's payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const b64 = dataUrl.slice(comma + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export function extensionFor(type: string): string {
  if (type === 'image/webp') return 'webp'
  if (type === 'image/png') return 'png'
  if (type === 'image/avif') return 'avif'
  return 'jpg'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

export class ImageCompressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageCompressionError'
  }
}

export interface CompressedImage {
  blob: Blob
  type: OutputType
  width: number
  height: number
}

/* ───────────── Browser-only canvas wrapper ───────────── */

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      // fall through to <img>, which some browsers decode more formats with (e.g. HEIC on Safari)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageCompressionError('This photo could not be opened. Try a JPG or PNG, or take a screenshot of it.')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Resize and re-encode a photo. Prefers WebP; falls back to JPEG when the
 * browser can't encode WebP. Throws ImageCompressionError with a user-facing message.
 */
export async function compressImage(file: File, profile: CompressionProfile = STORAGE_PROFILE): Promise<CompressedImage> {
  const invalid = validateImageFile(file)
  if (invalid) throw new ImageCompressionError(invalid)
  const decoded = await decode(file)
  try {
    const fitted = fitWithin(decoded.width, decoded.height, profile.maxEdge)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageCompressionError('Your browser could not process this photo.')
    let type: OutputType = 'image/webp'
    const results: CompressedImage[] = []
    for (const attempt of encodeAttempts()) {
      const width = Math.max(1, Math.round(fitted.width * attempt.scale))
      const height = Math.max(1, Math.round(fitted.height * attempt.scale))
      canvas.width = width
      canvas.height = height
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff' // JPEG has no transparency
        ctx.fillRect(0, 0, width, height)
      } else {
        ctx.clearRect(0, 0, width, height)
      }
      ctx.drawImage(decoded.source, 0, 0, width, height)
      let blob = await toBlob(canvas, type, attempt.quality)
      if (blob && type === 'image/webp' && blob.type !== 'image/webp') {
        // No WebP encoder (older Safari): switch to JPEG for this and later attempts.
        type = 'image/jpeg'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(decoded.source, 0, 0, width, height)
        blob = await toBlob(canvas, type, attempt.quality)
      }
      if (!blob) continue
      results.push({ blob, type, width, height })
      if (blob.size <= profile.targetBytes) break
    }
    const chosen = chooseResult(
      results.map((r) => ({ ...r, size: r.blob.size })),
      profile,
    )
    if (!chosen) throw new ImageCompressionError('This photo could not be made small enough. Try a smaller or simpler photo.')
    return { blob: chosen.blob, type: chosen.type, width: chosen.width, height: chosen.height }
  } finally {
    decoded.close()
  }
}
