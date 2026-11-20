import { randomUUID } from 'node:crypto'
import { createSupabaseGateway } from '../../src/gateway/supabase'
import type { CommerceGateway } from '../../src/gateway/gateway'
import type { ShopSettings } from '../../src/gateway/storefront'

/**
 * Seeds a real merchant through the SAME gateway code the browser uses (Supabase Auth + RPCs).
 * Shared by the gateway end-to-end test (vitest) and the browser end-to-end test (Playwright).
 */
export const SHOP_PIN = { lat: -1.2676, lng: 36.8108 }
export const PASSWORD = 'correct-horse-battery-9'

export function shopSettings(slug: string, patch: Partial<ShopSettings> = {}): ShopSettings {
  return {
    slug,
    published: true,
    tagline: 'Hand-made homeware',
    about: null,
    coverUrl: null,
    logoUrl: null,
    whatsappE164: '+254712345678',
    registeredName: null,
    locationLat: SHOP_PIN.lat,
    locationLng: SHOP_PIN.lng,
    locationLabel: 'Westlands',
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryBands: [
      { maxKm: 5, feeMinor: 20_000 },
      { maxKm: 15, feeMinor: 40_000 },
    ],
    deliveryPromise: 'Same day in Nairobi',
    codEnabled: true,
    mpesaTill: null,
    mpesaPaybill: null,
    returnPolicy: null,
    ...patch,
  }
}

export interface SeededMerchant {
  g: CommerceGateway
  email: string
  orgId: string
  productId: string
  variantId: string
  slug: string
}

export async function seedMerchant(api: string, anon: string, label: string, productName: string, priceMinor: number): Promise<SeededMerchant> {
  const g = createSupabaseGateway(api, anon)
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`
  const { needsEmailConfirmation } = await g.signUp(email, PASSWORD)
  if (needsEmailConfirmation) throw new Error('Local Supabase must have email confirmations off for this test')
  if (!(await g.getUser())) await g.signIn(email, PASSWORD)

  const orgId = await g.createOrganisation({
    name: `${label[0].toUpperCase()}${label.slice(1)} Home`,
    countryCode: 'KE',
    timezone: 'Africa/Nairobi',
    locale: 'en-KE',
    baseCurrency: 'KES',
    businessType: 'homeware',
    taxMode: 'exclusive',
  })
  const productId = await g.saveProduct(orgId, {
    name: productName,
    description: 'Woven by hand.',
    category: 'Home',
    status: 'active',
    trackStock: true,
    taxRateBps: 1600,
    taxCode: null,
    variants: [{ name: 'Standard', sku: `${label.toUpperCase()}-1`, priceMinor, lowStockThreshold: 1, isActive: true }],
  })
  const product = (await g.listProducts(orgId)).find((p) => p.id === productId)
  if (!product) throw new Error('Saved product not found')
  const variantId = product.variants[0].id
  await g.adjustStock(orgId, { variantId, delta: 10, reason: 'received_from_supplier', note: null }, randomUUID())
  const slug = `${label}-${randomUUID().slice(0, 6)}`
  await g.saveShopSettings(orgId, shopSettings(slug))
  return { g, email, orgId, productId, variantId, slug }
}
