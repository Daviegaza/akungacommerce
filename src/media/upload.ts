import { extensionFor } from './compress'

/** Public bucket for storefront product photos (migration 20261120000010). */
export const PRODUCT_IMAGES_BUCKET = 'product-images'

/** Matches the bucket's file_size_limit. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export const UPLOAD_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'] as const

/** Demo data URLs: accepted mime types and per-image size cap (decoded bytes). */
export const DEMO_DATA_URL_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/
export const DEMO_MAX_IMAGE_BYTES = 400 * 1024
/** Uploaded (data URL) photos per product in the demo workspace. */
export const DEMO_MAX_UPLOADED_IMAGES = 8

export interface ImageUploadOptions {
  /** 0..1 */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Object key inside the bucket. The first folder must be the org id (storage RLS checks it). */
export function productImagePath(orgId: string, type: string, id: string = crypto.randomUUID()): string {
  if (!UUID_RE.test(orgId)) throw new Error('Invalid organisation id')
  return `${orgId.toLowerCase()}/${id}.${extensionFor(type)}`
}

export function publicObjectUrl(baseUrl: string, bucket: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${encoded}`
}

/** Whether a stored image URL came from an upload (data URL or our public bucket) rather than a pasted link. */
export function isUploadedImageUrl(url: string): boolean {
  return url.startsWith('data:image/') || url.includes(`/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`)
}

/** Read a blob as a base64 data URL (FileReader in browsers, arrayBuffer elsewhere). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error ?? new Error('Could not read the photo'))
      r.readAsDataURL(blob)
    })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

export class UploadError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'UploadError'
    this.status = status
  }
}

/** Turn a storage HTTP failure into a message a merchant can act on. */
export function uploadErrorMessage(status: number, body: string): string {
  if (status === 0) return 'No connection. Check your internet and retry.'
  // Storage often answers 400 with the real status inside the JSON body (e.g. RLS denial = "403").
  if (status === 401 || status === 403 || /row-level security|"statusCode":\s*"40[13]"/i.test(body)) return 'You are not allowed to upload photos for this business. Sign in again or ask an owner.'
  if (status === 413 || /maximum allowed size|too large/i.test(body)) return 'This photo is too large to upload.'
  if (status === 415 || /mime type/i.test(body)) return 'This photo type is not supported.'
  if (status >= 500) return 'The photo service is having trouble. Retry in a moment.'
  return 'The photo could not be uploaded. Retry.'
}

/**
 * Upload with real progress events (supabase-js has none) to the Storage REST
 * API, authenticated as the signed-in user so storage RLS applies.
 */
export function xhrUpload(opts: {
  url: string
  headers: Record<string, string>
  blob: Blob
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new UploadError('Upload cancelled'))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', opts.url)
    for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1)
        resolve()
      } else reject(new UploadError(uploadErrorMessage(xhr.status, xhr.responseText ?? ''), xhr.status))
    }
    xhr.onerror = () => reject(new UploadError(uploadErrorMessage(0, '')))
    xhr.onabort = () => reject(new UploadError('Upload cancelled'))
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(opts.blob)
  })
}

/**
 * Upload a compressed photo to the public product-images bucket as the
 * signed-in user and return its public URL. Throws UploadError.
 */
export async function uploadProductImageToStorage(args: {
  baseUrl: string
  anonKey: string
  accessToken: string
  orgId: string
  image: Blob
  opts?: ImageUploadOptions
}): Promise<string> {
  const { baseUrl, anonKey, accessToken, orgId, image, opts } = args
  if (!(UPLOAD_TYPES as readonly string[]).includes(image.type)) throw new UploadError('This photo type is not supported.', 415)
  if (image.size > MAX_UPLOAD_BYTES) throw new UploadError('This photo is too large to upload.', 413)
  const path = productImagePath(orgId, image.type)
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  await xhrUpload({
    url: `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/${PRODUCT_IMAGES_BUCKET}/${encoded}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': image.type,
      'x-upsert': 'false',
      // Object names are random and never overwritten, so they can be cached for a long time.
      'cache-control': 'max-age=31536000',
    },
    blob: image,
    onProgress: opts?.onProgress,
    signal: opts?.signal,
  })
  return publicObjectUrl(baseUrl, PRODUCT_IMAGES_BUCKET, path)
}
