import { describe, expect, it } from 'vitest'
import {
  DEMO_PROFILE,
  MAX_INPUT_BYTES,
  STORAGE_PROFILE,
  chooseResult,
  dataUrlBytes,
  encodeAttempts,
  extensionFor,
  fitWithin,
  formatBytes,
  validateImageFile,
} from './compress'
import {
  DEMO_DATA_URL_RE,
  DEMO_MAX_IMAGE_BYTES,
  blobToDataUrl,
  isUploadedImageUrl,
  productImagePath,
  publicObjectUrl,
  uploadErrorMessage,
  uploadProductImageToStorage,
} from './upload'

const ORG = '3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8'

describe('validateImageFile', () => {
  it('accepts common photo types up to 15 MB', () => {
    expect(validateImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 3_000_000 })).toBeNull()
    expect(validateImageFile({ name: 'a.heic', type: 'image/heic', size: MAX_INPUT_BYTES })).toBeNull()
    // Some Android pickers send no mime type; fall back to the extension.
    expect(validateImageFile({ name: 'IMG_001.JPG', type: '', size: 10 })).toBeNull()
  })

  it('rejects non-images, SVG, empty and oversize files with a clear message', () => {
    expect(validateImageFile({ name: 'cv.pdf', type: 'application/pdf', size: 10 })).toMatch(/not a photo/)
    expect(validateImageFile({ name: 'notes', type: '', size: 10 })).toMatch(/not a photo/)
    expect(validateImageFile({ name: 'logo.svg', type: 'image/svg+xml', size: 10 })).toMatch(/SVG/)
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/empty/)
    expect(validateImageFile({ name: 'big.jpg', type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 })).toMatch(/15 MB or smaller/)
  })
})

describe('fitWithin', () => {
  it('scales the longest side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(4032, 4032, 1600)).toEqual({ width: 1600, height: 1600 })
    expect(fitWithin(10000, 10, 1600)).toEqual({ width: 1600, height: 2 })
  })
  it('never upscales and never returns 0', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(20000, 1, 1600).height).toBe(1)
  })
  it('rejects images without a size', () => {
    expect(() => fitWithin(0, 100, 1600)).toThrow()
    expect(() => fitWithin(Number.NaN, 100, 1600)).toThrow()
  })
})

describe('encoding plan', () => {
  it('lowers quality before dimensions, staying within sane bounds', () => {
    const a = encodeAttempts()
    expect(a[0]).toEqual({ scale: 1, quality: 0.82 })
    for (let i = 1; i < a.length; i++) expect(a[i].scale).toBeLessThanOrEqual(a[i - 1].scale)
    expect(a.every((x) => x.quality >= 0.5 && x.quality <= 0.9 && x.scale >= 0.5)).toBe(true)
  })

  it('chooses the first result under target, else the smallest under the hard max, else null', () => {
    const p = STORAGE_PROFILE
    expect(chooseResult([{ size: 900_000 }, { size: 400_000 }, { size: 300_000 }], p)).toEqual({ size: 400_000 })
    expect(chooseResult([{ size: 1_900_000 }, { size: 700_000 }, { size: 800_000 }], p)).toEqual({ size: 700_000 })
    expect(chooseResult([{ size: 3_000_000 }], p)).toBeNull()
    expect(chooseResult([], p)).toBeNull()
  })

  it('keeps targets: storage <= 500 KB at 1600px; demo small enough to fit 8 photos in localStorage', () => {
    expect(STORAGE_PROFILE).toMatchObject({ maxEdge: 1600, targetBytes: 500 * 1024 })
    expect(DEMO_PROFILE.hardMaxBytes).toBeLessThanOrEqual(DEMO_MAX_IMAGE_BYTES)
    // 8 photos at target, base64-encoded (x4/3), stay under ~2 MB of a ~5 MB quota.
    expect((8 * DEMO_PROFILE.targetBytes * 4) / 3).toBeLessThan(2 * 1024 * 1024)
  })
})

describe('byte helpers', () => {
  it('measures the decoded size of a data URL', () => {
    expect(dataUrlBytes('data:image/webp;base64,AAAA')).toBe(3)
    expect(dataUrlBytes('data:image/webp;base64,AAA=')).toBe(2)
    expect(dataUrlBytes('data:image/webp;base64,AA==')).toBe(1)
    expect(dataUrlBytes('nonsense')).toBe(0)
  })
  it('formats sizes and extensions', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(480 * 1024)).toBe('480 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(extensionFor('image/webp')).toBe('webp')
    expect(extensionFor('image/jpeg')).toBe('jpg')
  })
  it('encodes blobs as data URLs that pass the demo validator', async () => {
    const url = await blobToDataUrl(new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' }))
    expect(url).toBe('data:image/jpeg;base64,AQIDBAU=')
    expect(DEMO_DATA_URL_RE.test(url)).toBe(true)
    expect(DEMO_DATA_URL_RE.test('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(DEMO_DATA_URL_RE.test('data:image/png;base64,AA AA')).toBe(false)
  })
})

describe('storage paths and URLs', () => {
  it('puts objects under the org folder with a random name', () => {
    expect(productImagePath(ORG, 'image/webp', 'abc')).toBe(`${ORG}/abc.webp`)
    expect(productImagePath(ORG.toUpperCase(), 'image/jpeg', 'x')).toBe(`${ORG}/x.jpg`)
    expect(productImagePath(ORG, 'image/webp')).toMatch(new RegExp(`^${ORG}/[0-9a-f-]{36}\\.webp$`))
    expect(() => productImagePath('../etc', 'image/webp')).toThrow()
  })
  it('builds public URLs and recognises uploaded images', () => {
    const url = publicObjectUrl('https://p.supabase.co/', 'product-images', `${ORG}/a.webp`)
    expect(url).toBe(`https://p.supabase.co/storage/v1/object/public/product-images/${ORG}/a.webp`)
    expect(isUploadedImageUrl(url)).toBe(true)
    expect(isUploadedImageUrl('data:image/webp;base64,AAAA')).toBe(true)
    expect(isUploadedImageUrl('https://images.unsplash.com/photo-1')).toBe(false)
  })
  it('maps storage failures to actionable messages', () => {
    expect(uploadErrorMessage(0, '')).toMatch(/connection/)
    expect(uploadErrorMessage(403, 'new row violates row-level security policy')).toMatch(/not allowed/)
    // What local Storage actually returns for an RLS denial (verified against the API).
    expect(uploadErrorMessage(400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}')).toMatch(/not allowed/)
    expect(uploadErrorMessage(400, 'The object exceeded the maximum allowed size')).toMatch(/too large/)
    expect(uploadErrorMessage(400, 'mime type image/gif is not supported')).toMatch(/not supported/)
    expect(uploadErrorMessage(503, '')).toMatch(/Retry/)
  })
  it('refuses unsupported or oversize blobs before any network call', async () => {
    const base = { baseUrl: 'https://p.supabase.co', anonKey: 'k', accessToken: 't', orgId: ORG }
    await expect(uploadProductImageToStorage({ ...base, image: new Blob(['x'], { type: 'image/gif' }) })).rejects.toThrow(/not supported/)
    await expect(
      uploadProductImageToStorage({ ...base, image: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/webp' }) }),
    ).rejects.toThrow(/too large/)
  })
})
