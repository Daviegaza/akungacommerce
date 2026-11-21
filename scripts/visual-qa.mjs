#!/usr/bin/env node
/**
 * Repeatable responsive visual check for every main surface, in demo mode.
 *
 *   npm run dev                                   # demo mode, default http://localhost:5173
 *   node scripts/visual-qa.mjs --base http://localhost:5173 --out visual-qa/after
 *
 * Options:
 *   --widths 1440,1024,768,390,360   CSS pixel widths (default: these five)
 *   --themes light,dark              colour schemes (default: both)
 *   --only landing,orders            route keys to include (default: all)
 *   --full                           full-page screenshots (default: first screen only)
 *
 * Writes PNGs plus report.json (horizontal overflow, console errors, failed requests per page)
 * into --out, which lives under the git-ignored visual-qa/ folder. Exits 1 if any page overflows
 * horizontally or logs a console error. Uses installed Chrome (channel "chrome").
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const BASE = arg('base', 'http://localhost:5173').replace(/\/$/, '')
const OUT = arg('out', 'visual-qa/latest')
const WIDTHS = arg('widths', '1440,1024,768,390,360').split(',').map(Number)
const THEMES = arg('themes', 'light,dark').split(',')
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean)
const FULL = process.argv.includes('--full')
const HEIGHT = { 1440: 900, 1024: 768, 768: 1024, 390: 844, 360: 780 }

const SHOP = '/s/mto-home'

/** Route list. `app: true` pages need the demo owner signed in. */
const ROUTES = [
  { key: 'landing', path: '/' },
  { key: 'shop', path: SHOP },
  { key: 'product', path: SHOP, then: async (p) => p.locator(`a[href*="${SHOP}/p/"]:visible`).first().click() },
  { key: 'checkout', path: `${SHOP}/checkout`, needsCart: true },
  { key: 'tracking', dynamic: 'track' },
  { key: 'rider', dynamic: 'rider' },
  { key: 'privacy', path: '/legal/privacy' },
  { key: 'signin', path: '/app', signedOut: true },
  { key: 'today', path: '/app', app: true },
  { key: 'orders', path: '/app/orders', app: true },
  { key: 'order-new', path: '/app/orders/new', app: true },
  { key: 'order-detail', path: '/app/orders', app: true, then: async (p) => p.locator('a[href^="/app/orders/"]:not([href$="/new"]):visible').first().click() },
  { key: 'invoice', dynamic: 'invoice', app: true },
  { key: 'products', path: '/app/products', app: true },
  { key: 'product-import', path: '/app/products/import', app: true },
  { key: 'inventory', path: '/app/inventory', app: true },
  { key: 'customers', path: '/app/customers', app: true },
  { key: 'customer-detail', path: '/app/customers', app: true, then: async (p) => p.locator('a[href^="/app/customers/"]:not([href$="reach-out"]):visible').first().click() },
  { key: 'reengage', path: '/app/customers/reach-out', app: true },
  { key: 'payments', path: '/app/payments', app: true },
  { key: 'fulfilment', path: '/app/fulfilment', app: true },
  { key: 'analytics', path: '/app/analytics', app: true },
  { key: 'storefront-settings', path: '/app/shop', app: true },
  { key: 'tools', path: '/app/tools', app: true },
  { key: 'trust', path: '/app/trust', app: true },
  { key: 'settings', path: '/app/settings', app: true },
  { key: 'platform-review', path: '/app/platform-review', app: true },
  { key: 'app-404', path: '/app/nope', app: true },
  { key: 'public-404', path: '/nope-not-here' },
].filter((r) => !ONLY.length || ONLY.includes(r.key))

/** page.goto that retries once when an in-app redirect aborts the navigation. */
async function go(page, url) {
  try {
    await page.goto(url)
  } catch {
    await page.waitForTimeout(1000)
    await page.goto(url)
  }
}

async function signIn(page) {
  await page.goto(`${BASE}/app`)
  const email = page.getByLabel('Email')
  if (await email.count()) {
    await email.fill('owner@example.com')
    await page.getByLabel('Password').fill('demo-pass-123')
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.waitForURL(/\/app/, { timeout: 15000 })
    await page.waitForTimeout(800)
  }
}

async function addToCart(page) {
  await page.goto(`${BASE}${SHOP}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const hrefs = [...new Set(await page.locator(`a[href*="${SHOP}/p/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href'))))]
  // Skip scheduled drops and sold-out items: use the first product that can be added now.
  for (const href of hrefs.slice(0, 10)) {
    await page.goto(`${BASE}${href}`)
    const add = page.getByRole('button', { name: /add to (cart|bag)/i }).filter({ visible: true }).first()
    await add.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if ((await add.count()) && (await add.isEnabled())) {
      await add.click()
      await page.waitForTimeout(400)
      return
    }
  }
  throw new Error('no purchasable product found')
}

/** Places a demo pickup + cash order and returns its tracking path. */
async function placeOrder(page) {
  await addToCart(page)
  await page.goto(`${BASE}${SHOP}/checkout`)
  await page.getByText(/^pick ?up$/i).first().click().catch(() => {})
  await page.getByLabel(/full name|your name/i).first().fill('Sample Buyer')
  await page.getByLabel(/phone/i).first().fill('0712345678').catch(() => {})
  await page.getByRole('radio', { name: /cash|pay when you collect|pay on delivery/i }).first().check({ force: true }).catch(() => {})
  await page.getByRole('button', { name: /place order/i }).click()
  await page.waitForURL(/\/t\//, { timeout: 15000 })
  return new URL(page.url()).pathname
}

/** Creates a rider link on the first confirmed delivery order; returns its path or null. */
async function riderPath(page) {
  await signIn(page)
  await go(page, `${BASE}/app/orders?tab=all`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const links = await page.locator('a[href^="/app/orders/"]:not([href$="/new"])').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  for (const href of links.slice(0, 12)) {
    await go(page, `${BASE}${href}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const btn = page.getByRole('button', { name: /create rider link|make a new link/i }).filter({ visible: true })
    await btn.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    if (await btn.count()) {
      await btn.first().click()
      const text = await page.waitForFunction(() => document.body.innerText.match(/\/r\/[A-Za-z0-9_-]{16,}/)?.[0], null, { timeout: 8000 }).catch(() => null)
      const path = text && (await text.jsonValue())
      if (path) return path
    }
  }
  return null
}

const results = []
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: HEIGHT[width] ?? 900 }, colorScheme: theme, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    let errors = []
    let failed = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('requestfailed', (r) => !/ERR_ABORTED/.test(r.failure()?.errorText ?? '') && !/unsplash|tile|openstreetmap|fonts\.g/.test(r.url()) && failed.push(r.url()))
    page.on('response', (r) => r.status() >= 400 && r.url().startsWith(BASE) && failed.push(`${r.status()} ${r.url()}`))

    const dyn = {}
    let signedIn = false
    for (const route of ROUTES) {
      errors = []
      failed = []
      let path = route.path
      try {
        if (route.signedOut && signedIn) continue
        if (route.app && !signedIn) {
          await signIn(page)
          signedIn = true
        }
        if (route.dynamic === 'track') path = dyn.track ??= await placeOrder(page)
        if (route.dynamic === 'rider') path = dyn.rider ??= await riderPath(page)
        if (route.dynamic === 'invoice') {
          await go(page, `${BASE}/app/orders?tab=all`)
          await page.waitForLoadState('networkidle').catch(() => {})
          const href = await page.locator('a[href^="/app/orders/"]:not([href$="/new"])').first().getAttribute('href')
          path = `${href}/invoice`
        }
        if (route.dynamic === 'rider') signedIn = true
        if (!path) {
          results.push({ key: route.key, theme, width, skipped: 'no path' })
          continue
        }
        if (route.needsCart) await addToCart(page)
        errors = []
        failed = []
        await page.goto(`${BASE}${path}`)
        if (route.then) await route.then(page)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(700)
        const overflow = await page.evaluate(() => {
          const w = document.documentElement.clientWidth
          const offenders = [...document.querySelectorAll('body *')]
            .filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed'
            })
            .filter((el) => !el.closest('[data-overflow-ok], .overflow-x-auto, .overflow-auto, .overflow-hidden, .overflow-x-clip'))
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
          return { scroll: document.documentElement.scrollWidth - w, offenders }
        })
        const file = `${route.key}-${width}-${theme}.png`
        await page.screenshot({ path: join(OUT, file), fullPage: FULL })
        results.push({ key: route.key, theme, width, url: new URL(page.url()).pathname, overflow, errors: [...errors], failed: [...failed], file })
      } catch (e) {
        results.push({ key: route.key, theme, width, error: String(e.message ?? e).split('\n')[0] })
      }
    }
    await ctx.close()
  }
}
await browser.close()

writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2))
const bad = results.filter((r) => r.error || r.errors?.length || r.failed?.length || r.overflow?.scroll > 0 || r.overflow?.offenders?.length)
for (const r of bad) {
  const why = [
    r.error && `error: ${r.error}`,
    r.overflow?.scroll > 0 && `overflow ${r.overflow.scroll}px`,
    r.overflow?.offenders?.length && `wide: ${r.overflow.offenders.join(', ')}`,
    r.errors?.length && `console: ${r.errors.slice(0, 2).join(' | ')}`,
    r.failed?.length && `requests: ${r.failed.slice(0, 2).join(' | ')}`,
  ].filter(Boolean)
  console.log(`${r.key} ${r.width} ${r.theme}: ${why.join('; ')}`)
}
console.log(`${results.length} page checks, ${bad.length} with issues, ${results.filter((r) => r.skipped).length} skipped. Report: ${join(OUT, 'report.json')}`)
process.exit(bad.some((r) => r.error || r.errors?.length || r.overflow?.scroll > 0) ? 1 : 0)
