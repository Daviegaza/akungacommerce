import { describe, expect, it } from 'vitest'
import { MAX_IMAGES, imageDraftError, photoCapacity, photosBusy, type ImageDraft } from './ProductPhotos'
import { DEMO_MAX_UPLOADED_IMAGES } from '@/media/upload'

const file = new File([new Uint8Array(4)], 'p.jpg', { type: 'image/jpeg' })
const link = (url: string): ImageDraft => ({ key: url, url, alt: '' })
const uploading = (status: 'compressing' | 'uploading' | 'error' = 'uploading'): ImageDraft => ({
  key: crypto.randomUUID(),
  url: '',
  alt: '',
  upload: { status, progress: 0.5, file, ...(status === 'error' ? { error: 'No connection. Check your internet and retry.' } : {}) },
})

describe('product photo drafts', () => {
  it('validates pasted links but trusts finished uploads (data URLs and storage URLs)', () => {
    expect(imageDraftError(link('http://x.test/a.jpg'))).toMatch(/https/)
    expect(imageDraftError(link('https://x.test/a.jpg'))).toBeUndefined()
    expect(imageDraftError(link('data:image/webp;base64,AAAA'))).toBeUndefined()
    expect(imageDraftError(link('http://127.0.0.1:58321/storage/v1/object/public/product-images/o/a.webp'))).toBeUndefined()
  })

  it('treats in-flight uploads as busy (save waits) and failed ones as errors (retry or remove)', () => {
    expect(imageDraftError(uploading('compressing'))).toBeUndefined()
    expect(imageDraftError(uploading('error'))).toMatch(/connection/)
    expect(photosBusy([link('https://x.test/a.jpg'), uploading('compressing')])).toBe(true)
    expect(photosBusy([uploading('uploading')])).toBe(true)
    expect(photosBusy([uploading('error'), link('https://x.test/a.jpg')])).toBe(false)
  })

  it('caps photos per product, with a lower cap for uploaded photos in the demo', () => {
    const links = Array.from({ length: 3 }, (_, i) => link(`https://x.test/${i}.jpg`))
    expect(photoCapacity(links, false)).toEqual({ left: MAX_IMAGES - 3, reason: null })
    const demoUploads = Array.from({ length: DEMO_MAX_UPLOADED_IMAGES }, (_, i) => link(`data:image/webp;base64,A${i}==`))
    const demoFull = photoCapacity(demoUploads, true)
    expect(demoFull.left).toBe(0)
    expect(demoFull.reason).toMatch(/demo workspace/)
    // In-flight uploads count toward the demo cap too.
    expect(photoCapacity([...demoUploads.slice(1), uploading()], true).left).toBe(0)
    const all = Array.from({ length: MAX_IMAGES }, (_, i) => link(`https://x.test/${i}.jpg`))
    expect(photoCapacity(all, false)).toEqual({ left: 0, reason: `You can add up to ${MAX_IMAGES} photos.` })
  })
})
