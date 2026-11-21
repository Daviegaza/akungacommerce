#!/usr/bin/env node
/**
 * Regenerates every Fungua logo file from the geometry in src/brand/FunguaLogo.tsx
 * (the single source of truth), so the React component and the static assets cannot drift.
 *
 *   node scripts/brand-assets.mjs
 *
 * Writes vector files to public/ and public/brand/, then renders the PNG icons and the
 * 1200 × 630 social image with installed Chrome (Playwright, channel "chrome").
 * The social image headline loads Geist from Google Fonts, so it needs network access.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('src/brand/FunguaLogo.tsx', 'utf8')
const pick = (name) => {
  const m = src.match(new RegExp(`${name} = '([^']+)'`))
  if (!m) throw new Error(`${name} not found in FunguaLogo.tsx`)
  return m[1]
}
const F = pick('MARK_F')
const PATH = pick('MARK_PATH')
const WORD = pick('WORDMARK')

const C = { ink: '#0E1420', cobalt: '#2F5BEA', white: '#FFFFFF', cobaltOnDark: '#9DB5FF' }
const TONES = {
  brand: [C.ink, C.cobalt],
  reversed: [C.white, C.cobaltOnDark],
  mono: ['currentColor', 'currentColor'],
}
/** Wordmark placement inside the 64-unit mark system: x-height centred on the mark. */
const WORD_SCALE = 0.6528
const WORD_BASELINE = 49.43
const svg = (viewBox, body, label = 'Fungua') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">\n${body}\n</svg>\n`
const mark = ([ink, accent], t = '') =>
  `  <g${t ? ` transform="${t}"` : ''}><path fill="${ink}" d="${F}"/><path fill="${accent}" d="${PATH}"/></g>`
const word = (ink, x, baseline) => `  <path fill="${ink}" transform="translate(${x} ${baseline}) scale(${WORD_SCALE})" d="${WORD}"/>`
/** App icon: the mark at 87.5% on a graphite tile (keeps 8 units of clear space inside the tile). */
const tile = (rx = 15) => `  <rect width="64" height="64" rx="${rx}" fill="${C.ink}"/>\n${mark(TONES.reversed, 'translate(4 4) scale(0.875)')}`

const files = {
  'public/fungua-mark.svg': svg('0 0 64 64', mark(TONES.brand)),
  'public/favicon.svg': svg('0 0 64 64', tile()),
  'public/brand/fungua-app-icon.svg': svg('0 0 64 64', tile()),
  'public/brand/fungua-mark-reversed.svg': svg('0 0 64 64', mark(TONES.reversed)),
  'public/brand/fungua-mark-mono.svg': svg('0 0 64 64', mark(TONES.mono)),
  // Horizontal lockup: wordmark starts 6 units after the mark's 64-unit box.
  'public/brand/fungua-logo.svg': svg('0 0 287 64', `${mark(TONES.brand)}\n${word(C.ink, 70, WORD_BASELINE)}`),
  'public/brand/fungua-logo-reversed.svg': svg('0 0 287 64', `${mark(TONES.reversed)}\n${word(C.white, 70, WORD_BASELINE)}`),
  'public/brand/fungua-logo-mono.svg': svg('0 0 287 64', `${mark(TONES.mono)}\n${word('currentColor', 70, WORD_BASELINE)}`),
  // Stacked lockup: mark at 1.5x, centred above the wordmark.
  'public/brand/fungua-logo-stacked.svg': svg('0 0 240 164', `${mark(TONES.brand, 'translate(72 0) scale(1.5)')}\n${word(C.ink, 12.9, 146)}`),
  'public/brand/fungua-logo-stacked-reversed.svg': svg('0 0 240 164', `${mark(TONES.reversed, 'translate(72 0) scale(1.5)')}\n${word(C.white, 12.9, 146)}`),
  'public/brand/fungua-logo-stacked-mono.svg': svg('0 0 240 164', `${mark(TONES.mono, 'translate(72 0) scale(1.5)')}\n${word('currentColor', 12.9, 146)}`),
  'public/brand/fungua-wordmark.svg': svg('-2 -73 331 92', `  <path fill="${C.ink}" d="${WORD}"/>`),
  'public/brand/fungua-wordmark-reversed.svg': svg('-2 -73 331 92', `  <path fill="${C.white}" d="${WORD}"/>`),
}
for (const [path, body] of Object.entries(files)) writeFileSync(path, body)

const iconHtml = (size, maskable = false) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg width="${size}" height="${size}" viewBox="0 0 64 64">${
  maskable
    ? // Maskable: full-bleed graphite, mark inside the central 60% safe zone.
      `<rect width="64" height="64" fill="${C.ink}"/>${mark(TONES.reversed, 'translate(12.8 12.8) scale(0.6)')}`
    : tile(size >= 180 ? 14 : 15)
}</svg></body></html>`

const og = `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=block">
<style>
body{margin:0;width:1200px;height:630px;background:#0B0F17;font-family:Geist,system-ui,sans-serif;color:#fff;position:relative;overflow:hidden}
.wrap{position:absolute;inset:88px 96px;display:flex;flex-direction:column;justify-content:space-between}
h1{font-weight:600;font-size:80px;line-height:1.02;letter-spacing:-0.035em;margin:0}
p{font-size:28px;color:#A9B3C4;margin:26px 0 0;max-width:800px;line-height:1.38;font-weight:400}
.big{position:absolute;right:-48px;top:110px;width:430px;height:430px;opacity:.09}
</style></head><body>
<svg class="big" viewBox="0 0 64 64">${mark([C.white, C.cobaltOnDark])}</svg>
<div class="wrap">
<svg height="54" viewBox="0 0 287 64" style="align-self:flex-start">${mark(TONES.reversed)}${word(C.white, 70, WORD_BASELINE)}</svg>
<div><h1>Open commerce.<br>Everywhere.</h1><p>Storefronts, social selling and in-person sales, with orders, stock, payments and fulfilment in one workspace.</p></div>
</div></body></html>`

const browser = await chromium.launch({ channel: 'chrome' })
const render = async (html, out, w, h, transparent = true) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } })
  await page.close()
}
// Apple touch icons are shown on their own rounded mask, so give them a full-bleed tile.
await render(
  `<!doctype html><html><body style="margin:0"><svg width="180" height="180" viewBox="0 0 64 64"><rect width="64" height="64" fill="${C.ink}"/>${mark(TONES.reversed, 'translate(8 8) scale(0.75)')}</svg></body></html>`,
  'public/apple-touch-icon.png',
  180,
  180,
  false,
)
await render(iconHtml(192), 'public/icon-192.png', 192, 192)
await render(iconHtml(512), 'public/icon-512.png', 512, 512)
await render(iconHtml(512, true), 'public/icon-maskable-512.png', 512, 512, false)
await render(og, 'public/og-image.png', 1200, 630, false)
await browser.close()
console.log(`Wrote ${Object.keys(files).length} SVG files and 5 PNG files.`)
