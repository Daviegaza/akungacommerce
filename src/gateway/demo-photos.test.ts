import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setDemoRole, createDemoGateway, isQuotaError, resetDemoWorkspace } from './demo'
import { createDemoStorefront } from './storefront-demo'
import { DEMO_MAX_IMAGE_BYTES, DEMO_MAX_UPLOADED_IMAGES } from '@/media/upload'

const gw = createDemoGateway()

async function setup() {
  const orgs = await gw.listOrganisations()
  const org = orgs.find((o) => o.baseCurrency === 'KES')!
  const product = (await gw.listProducts(org.id)).find((p) => p.name === 'Olive Wood Serving Board')!
  return { org, product }
}

const webp = (bytes: number) => new Blob([new Uint8Array(bytes).fill(7)], { type: 'image/webp' })

beforeEach(() => {
  resetDemoWorkspace()
})

describe('demo product photo uploads', () => {
  it('returns a data URL, reports progress and saves it as a product image the storefront can show', async () => {
    const { org, product } = await setup()
    const progress: number[] = []
    const url = await gw.uploadProductImage(org.id, webp(1200), { onProgress: (f) => progress.push(f) })
    expect(url).toMatch(/^data:image\/webp;base64,/)
    expect(progress.at(-1)).toBe(1)

    await gw.setProductMerchandising(org.id, product.id, {
      images: [{ url, alt: 'Board from above' }, { url: 'https://images.example.test/b.jpg' }],
      featured: false,
      availableFrom: null,
    })
    const saved = (await gw.listProducts(org.id)).find((p) => p.id === product.id)!
    expect(saved.images[0]).toEqual({ url, alt: 'Board from above' })

    const shop = await gw.getShopSettings(org.id)
    const sf = await createDemoStorefront().getStorefront(shop!.slug)
    expect(sf.products.find((p) => p.id === product.id)?.images[0].url).toBe(url)
  })

  it('refuses non-image types, oversize photos and roles without catalogue.write', async () => {
    const { org } = await setup()
    await expect(gw.uploadProductImage(org.id, new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(/JPG, PNG or WebP/)
    await expect(gw.uploadProductImage(org.id, webp(DEMO_MAX_IMAGE_BYTES + 1))).rejects.toThrow(/too large/)
    __setDemoRole(org.id, 'sales')
    await expect(gw.uploadProductImage(org.id, webp(100))).rejects.toThrow(/cannot/)
  })

  it('validates data URLs on save: type, size and count per product', async () => {
    const { org, product } = await setup()
    const save = (urls: string[]) =>
      gw.setProductMerchandising(org.id, product.id, { images: urls.map((url) => ({ url })), featured: false, availableFrom: null })
    await expect(save(['data:image/svg+xml;base64,PHN2Zz4='])).rejects.toThrow(/JPG, PNG or WebP/)
    await expect(save(['data:text/html;base64,PGI+'])).rejects.toThrow(/JPG, PNG or WebP/)
    const big = await gw.uploadProductImage(org.id, webp(DEMO_MAX_IMAGE_BYTES))
    await expect(save([big.replace(',', ',AAAAAAAA')])).rejects.toThrow(/too large/)

    const small = await gw.uploadProductImage(org.id, webp(64))
    await expect(save(Array(DEMO_MAX_UPLOADED_IMAGES + 1).fill(small))).rejects.toThrow(new RegExp(`at most ${DEMO_MAX_UPLOADED_IMAGES}`))
    await save(Array(DEMO_MAX_UPLOADED_IMAGES).fill(small))
    expect((await gw.listProducts(org.id)).find((p) => p.id === product.id)?.images).toHaveLength(DEMO_MAX_UPLOADED_IMAGES)
  })
})

describe('demo storage quota', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('detects quota errors across browsers', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaError({ code: 22 })).toBe(true)
    expect(isQuotaError(new Error('nope'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })

  it('reports a full browser storage on save and keeps the previous product unchanged', async () => {
    const store = new Map<string, string>()
    let limit = Infinity
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (v.length > limit) throw new DOMException('full', 'QuotaExceededError')
          store.set(k, v)
        },
        removeItem: (k: string) => store.delete(k),
      },
    })
    resetDemoWorkspace() // seed into the fake storage
    const { org, product } = await setup()
    const url = await gw.uploadProductImage(org.id, webp(5000))
    const before = (await gw.listProducts(org.id)).find((p) => p.id === product.id)!
    limit = [...store.values()][0].length + 100 // room for small edits, not for a photo

    const err = await gw
      .setProductMerchandising(org.id, product.id, { images: [{ url }], featured: true, availableFrom: null })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'storage_full' })
    expect(String((err as Error).message)).toMatch(/out of space/)

    const after = (await gw.listProducts(org.id)).find((p) => p.id === product.id)!
    expect(after.images).toEqual(before.images)
    expect(after.featured).toBe(before.featured)
  })
})
