import { expect, test } from '@playwright/test'
import { PASSWORD, seedMerchant, type SeededMerchant } from '../tests/support/merchant'

/**
 * Real browser, real backend: a merchant's product (created through the merchant gateway) is
 * bought in the public shop by a guest, the order reaches the merchant workspace, the merchant
 * moves it on, and the buyer's tracking page shows it. A second merchant proves isolation.
 */
const API = process.env.SUPABASE_API_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
test.skip(!API || !ANON, 'SUPABASE_API_URL and SUPABASE_ANON_KEY are required')

let alpha: SeededMerchant
let bravo: SeededMerchant

test.beforeAll(async () => {
  alpha = await seedMerchant(API, ANON, 'alpha', 'Sisal Market Basket', 250_000)
  bravo = await seedMerchant(API, ANON, 'bravo', 'Clay Bud Vase', 99_000)
})

test.afterAll(async () => {
  await alpha?.g.signOut().catch(() => {})
  await bravo?.g.signOut().catch(() => {})
})

test('guest buys from a real shop, merchant fulfils, tracking follows', async ({ page }) => {
  // Public shop: real catalogue of this merchant only, no demo banner.
  await page.goto(`/s/${alpha.slug}`)
  await expect(page.getByText('Sisal Market Basket').first()).toBeVisible()
  await expect(page.getByText('Clay Bud Vase')).toHaveCount(0)

  await page.getByText('Sisal Market Basket').first().click()
  await expect(page).toHaveURL(new RegExp(`/s/${alpha.slug}/p/`))
  await page.getByRole('button', { name: /add to cart/i }).first().click()

  await page.goto(`/s/${alpha.slug}/checkout`)
  await page.getByRole('radio', { name: /pickup/i }).first().check({ force: true }).catch(async () => {
    await page.getByText('Pickup', { exact: true }).first().click()
  })
  await page.getByLabel('Full name').fill('Wanjiku Kamau')
  await page.getByLabel('Phone number').fill('0711000222')

  // Server-calculated total: KES 2,500 + 16 % tax, no delivery fee for pickup.
  const place = page.getByRole('button', { name: /place order/i })
  await expect(place).toContainText('2,900')
  await place.click()

  // Tracking page.
  await expect(page).toHaveURL(/\/t\//, { timeout: 30_000 })
  const trackingUrl = page.url()
  await expect(page.getByText(/Sisal Market Basket/).first()).toBeVisible()

  // The merchant gets the order (server data, through RLS).
  const orders = await alpha.g.listOrders(alpha.orgId)
  expect(orders).toHaveLength(1)
  const order = orders[0]
  expect(order).toMatchObject({ status: 'pending_confirmation', channel: 'storefront', totalMinor: 290_000, customerName: 'Wanjiku Kamau' })
  expect(await bravo.g.listOrders(bravo.orgId)).toHaveLength(0)

  // Stock is reserved.
  const v = (await alpha.g.listProducts(alpha.orgId))[0].variants[0]
  expect({ onHand: v.onHand, reserved: v.reserved }).toEqual({ onHand: 10, reserved: 1 })

  // Merchant workspace in the browser shows the order.
  const staff = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:4174' })
  const app = await staff.newPage()
  await app.goto('/app')
  await app.getByLabel(/email/i).fill(alpha.email)
  await app.getByLabel(/password/i).fill(PASSWORD)
  await app.getByRole('button', { name: /^sign in$/i }).click()
  await expect(app.getByRole('heading', { name: 'Sign in' })).toHaveCount(0, { timeout: 30_000 })
  await app.goto('/app/orders')
  await expect(app.getByText('Wanjiku Kamau').first()).toBeVisible()
  await staff.close()

  // Merchant confirms and prepares; tracking shows it.
  await alpha.g.transitionOrder(alpha.orgId, order.id, 'confirmed', null)
  await alpha.g.transitionOrder(alpha.orgId, order.id, 'preparing', null)
  await page.goto(trackingUrl)
  await expect(page.getByText(/preparing/i).first()).toBeVisible()
})
