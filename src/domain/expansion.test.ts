import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/integrations/csv-parse'
import { importTemplateCsv, parseImportCsv, parsePriceCell, planImport, toServerRows, validateServerRows } from './catalogue-import'
import { ga4ScriptUrl, mayTrack, metaPixelScriptUrl, normaliseGa4Id, normaliseMetaPixelId, parseConsent, toGa4Event, toMetaEvent } from './tracking'
import {
  assignableRoles,
  effectiveInviteStatus,
  generateInviteToken,
  hashInviteToken,
  inviteLink,
  isPlausibleInviteToken,
  maskContact,
  parseInviteContact,
  roleCapabilities,
} from './team-invites'
import { dnsInstructions, dnsTargetsFromEnv, isApexDomain, isPlatformHost, normaliseHostname } from './custom-domain'
import {
  formatInvoiceNumber,
  invoiceLine,
  invoicesCsv,
  invoiceTotals,
  nextInvoiceNumber,
  normaliseKraPin,
  suggestedTaxBand,
  taxBreakdown,
  type TaxInvoiceRecord,
} from './etims'
import { computeLine } from './orders'
import { bankTransferAvailable, bankTransferEligible, isNuban } from './bank-transfer'
import { PERMISSION_MATRIX, ROLES } from './permissions'

describe('CSV parser', () => {
  it('handles quotes, escaped quotes, newlines in fields, CRLF and BOM', () => {
    const r = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",2\r\n\r\n')
    expect(r.error).toBeNull()
    expect(r.records).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2'],
    ])
  })
  it('detects semicolon files and reports unclosed quotes', () => {
    expect(parseCsv('a;b\n1;2').records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\n"open,2').error).toMatch(/never closed/)
  })
})

describe('CSV product import', () => {
  const header = 'name,description,category,variant name,sku,price,compare-at price,stock,image url'

  it('parses prices into minor units per currency', () => {
    expect(parsePriceCell('1,500.50', 'KES')).toEqual({ ok: true, minor: 150050 })
    expect(parsePriceCell('1500', 'JPY')).toEqual({ ok: true, minor: 1500 })
    expect(parsePriceCell('12.345', 'KWD')).toEqual({ ok: true, minor: 12345 })
    expect(parsePriceCell('12.5', 'JPY').ok).toBe(false)
    expect(parsePriceCell('KES 100', 'KES').ok).toBe(false)
    expect(parsePriceCell('-5', 'KES').ok).toBe(false)
  })

  it('validates rows with line numbers', () => {
    const csv = [
      header,
      'Towel,,Home,Blue,KIK-1,2500,3000,12,https://img.example/a.jpg',
      ',,,,,abc,,,',
      'Basket,,,,KIK-1,100,90,-1,http://x',
    ].join('\n')
    const { rows, fileErrors } = parseImportCsv(csv, { currency: 'KES' })
    expect(fileErrors).toEqual([])
    expect(rows[0]).toMatchObject({ line: 2, name: 'Towel', priceMinor: 250000, compareAtMinor: 300000, stock: 12, errors: [] })
    expect(rows[1].line).toBe(3)
    expect(rows[1].errors.join(' ')).toMatch(/Name is missing/)
    expect(rows[1].errors.join(' ')).toMatch(/Price: use numbers only/)
    const e3 = rows[2].errors.join(' | ')
    expect(e3).toMatch(/also on line 2/)
    expect(e3).toMatch(/Compare-at price must be higher/)
    expect(e3).toMatch(/Stock must be a whole number/)
    expect(e3).toMatch(/https/)
  })

  it('accepts header aliases and reports missing required columns', () => {
    const ok = parseImportCsv('Product Name,Selling Price,Qty\nMug,450,3', { currency: 'KES' })
    expect(ok.rows[0]).toMatchObject({ name: 'Mug', priceMinor: 45000, stock: 3 })
    const bad = parseImportCsv('title,colour\nMug,red', { currency: 'KES' })
    expect(bad.fileErrors).toContain('Missing the "price" column')
    expect(bad.ignoredHeaders).toEqual(['colour'])
  })

  it('enforces the row limit', () => {
    const body = Array.from({ length: 6 }, (_, i) => `P${i},10`).join('\n')
    const r = parseImportCsv(`name,price\n${body}`, { currency: 'KES', maxRows: 5 })
    expect(r.fileErrors.join(' ')).toMatch(/at most 5 rows/)
  })

  it('plans create / update / skip by SKU', () => {
    const { rows } = parseImportCsv([header, 'Towel,,,Blue,A1,10,,,', 'Towel,,,Red,B2,10,,,', 'Mug,,,,,5,,,', 'Bad,,,,,x,,,'].join('\n'), { currency: 'USD' })
    const existing = new Map([['a1', { productName: 'Old towel', variantName: 'Blue' }]])
    const upd = planImport(rows, existing, 'update')
    expect(upd.rows.map((r) => r.action)).toEqual(['update', 'create', 'create', 'error'])
    expect(upd.newProducts).toBe(2)
    expect(upd.canImport).toBe(false)
    const skip = planImport(rows.slice(0, 3), existing, 'skip')
    expect(skip.counts).toEqual({ create: 2, update: 0, skip: 1, error: 0 })
    expect(skip.canImport).toBe(true)
    expect(toServerRows(rows)).toHaveLength(3)
  })

  it('template parses cleanly in its own currency', () => {
    for (const c of ['KES', 'JPY', 'NGN']) {
      const r = parseImportCsv(importTemplateCsv(c), { currency: c })
      expect(r.fileErrors).toEqual([])
      expect(r.rows.every((x) => x.errors.length === 0)).toBe(true)
      expect(r.rows).toHaveLength(3)
    }
  })

  it('server-row validation mirrors the SQL checks', () => {
    const good = { line: 2, name: 'A', description: null, category: null, variant_name: null, sku: 'X', price_minor: 100, compare_at_minor: null, stock: 1, image_url: null }
    expect(validateServerRows([good])).toEqual([])
    expect(validateServerRows([])[0].message).toMatch(/no product rows/)
    const errs = validateServerRows([good, { ...good, line: 3, sku: 'Y', price_minor: -1 }, { ...good, line: 4, sku: 'x', compare_at_minor: 50, price_minor: 100 }])
    expect(errs.map((e) => e.line)).toEqual([3, 4, 4])
  })
})

describe('Meta Pixel and GA4', () => {
  it('validates IDs strictly (no script injection)', () => {
    expect(normaliseMetaPixelId(' 1234 5678 9012 345 ')).toEqual({ ok: true, value: '123456789012345' })
    expect(normaliseMetaPixelId('')).toEqual({ ok: true, value: null })
    expect(normaliseMetaPixelId("123');alert(1)//").ok).toBe(false)
    expect(normaliseMetaPixelId('1234567').ok).toBe(false)
    expect(normaliseGa4Id('g-ab12cd34')).toEqual({ ok: true, value: 'G-AB12CD34' })
    expect(normaliseGa4Id('UA-1234-1').ok).toBe(false)
    expect(normaliseGa4Id('G-AB"><script>').ok).toBe(false)
    expect(metaPixelScriptUrl('abc')).toBeNull()
    expect(ga4ScriptUrl('G-AB12CD34')).toBe('https://www.googletagmanager.com/gtag/js?id=G-AB12CD34')
    expect(ga4ScriptUrl('G-<x>')).toBeNull()
  })

  it('only tracks after explicit consent', () => {
    const ids = { metaPixelId: '123456789012345', ga4Id: null }
    expect(parseConsent(null)).toBe('unknown')
    expect(parseConsent('yes')).toBe('unknown')
    expect(mayTrack('unknown', ids)).toBe(false)
    expect(mayTrack('denied', ids)).toBe(false)
    expect(mayTrack('granted', ids)).toBe(true)
    expect(mayTrack('granted', { metaPixelId: null, ga4Id: null })).toBe(false)
  })

  it('maps storefront events to Meta and GA4 standard events with major-unit values', () => {
    expect(toMetaEvent({ type: 'page_view' }).name).toBe('PageView')
    expect(toMetaEvent({ type: 'view_content', productId: 'p1', valueMinor: 250000, currency: 'KES' })).toEqual({
      name: 'ViewContent',
      params: { content_ids: ['p1'], content_type: 'product', value: 2500, currency: 'KES' },
    })
    const add = toMetaEvent({ type: 'add_to_cart', productId: 'p1', variantId: 'v1', quantity: 3, unitPriceMinor: 1050, currency: 'USD' })
    expect(add.name).toBe('AddToCart')
    expect(add.params.value).toBe(31.5)
    const purchase = { type: 'purchase' as const, orderNumber: 1042, productIds: ['p1', 'p2'], numItems: 3, valueMinor: 1500, currency: 'JPY' }
    expect(toMetaEvent(purchase)).toMatchObject({ name: 'Purchase', eventId: 'order-1042', params: { value: 1500, currency: 'JPY', num_items: 3 } })
    expect(toGa4Event(purchase)).toMatchObject({ name: 'purchase', params: { transaction_id: '1042', value: 1500 } })
    expect(toGa4Event({ type: 'initiate_checkout', productIds: ['p1'], numItems: 1, valueMinor: 999, currency: 'USD' }).name).toBe('begin_checkout')
    expect(toGa4Event({ type: 'view_content', productId: 'p1', valueMinor: 1, currency: 'USD' }).name).toBe('view_item')
  })

  it('never puts personal data in event params', () => {
    const json = JSON.stringify(toMetaEvent({ type: 'purchase', orderNumber: 7, productIds: ['p'], numItems: 1, valueMinor: 1, currency: 'KES' }).params)
    expect(json).not.toMatch(/phone|name|email|token/i)
  })
})

describe('Team invitations', () => {
  it('reads email or phone contacts', () => {
    expect(parseInviteContact(' Wanjiru@Shop.co.ke ')).toEqual({ ok: true, contact: { kind: 'email', email: 'wanjiru@shop.co.ke' } })
    expect(parseInviteContact('0712 345 678', 'KE')).toEqual({ ok: true, contact: { kind: 'phone', phoneE164: '+254712345678' } })
    expect(parseInviteContact('').ok).toBe(false)
    expect(parseInviteContact('bad@').ok).toBe(false)
  })

  it('only owners can hand out owner; non-managers hand out nothing', () => {
    expect(assignableRoles('owner')).toContain('owner')
    expect(assignableRoles('admin')).not.toContain('owner')
    expect(assignableRoles('admin')).toContain('fulfilment')
    expect(assignableRoles('sales')).toEqual([])
  })

  it('generates URL-safe tokens and hashes them with SHA-256', async () => {
    const t = generateInviteToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isPlausibleInviteToken(t)).toBe(true)
    expect(isPlausibleInviteToken('short')).toBe(false)
    expect(generateInviteToken()).not.toBe(t)
    // Known vector: SHA-256("abc")
    expect(await hashInviteToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(inviteLink('https://fungua.test/', t)).toBe(`https://fungua.test/app/join/${t}`)
  })

  it('expires pending invites only', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    expect(effectiveInviteStatus('pending', '2026-11-20T09:59:59Z', now)).toBe('expired')
    expect(effectiveInviteStatus('pending', '2026-11-21T00:00:00Z', now)).toBe('pending')
    expect(effectiveInviteStatus('accepted', '2026-01-01T00:00:00Z', now)).toBe('accepted')
  })

  it('masks contacts and describes every role in plain language', () => {
    expect(maskContact({ kind: 'email', email: 'wanjiru@shop.co.ke' })).toBe('w***@shop.co.ke')
    expect(maskContact({ kind: 'phone', phoneE164: '+254712345149' })).toBe('***149')
    const total = Object.keys(PERMISSION_MATRIX).length
    for (const r of ROLES) {
      const c = roleCapabilities(r)
      expect(c.can.length + c.cannot.length).toBe(total)
    }
    expect(roleCapabilities('analyst').can).toEqual([])
    expect(roleCapabilities('owner').cannot).toEqual([])
  })
})

describe('Custom domains', () => {
  it('normalises pasted domains', () => {
    expect(normaliseHostname('https://Shop.MyBrand.co.ke/path?x=1')).toEqual({ ok: true, hostname: 'shop.mybrand.co.ke', isApex: false })
    expect(normaliseHostname('mybrand.com.')).toEqual({ ok: true, hostname: 'mybrand.com', isApex: true })
    expect(normaliseHostname('mybrand.co.ke')).toMatchObject({ ok: true, isApex: true })
    expect(normaliseHostname('café.com')).toMatchObject({ ok: true, hostname: 'xn--caf-dma.com' })
  })
  it('rejects invalid and reserved hosts', () => {
    for (const bad of ['', 'localhost', 'shop', '192.168.0.1', 'my_shop.com', '-a.com', 'shop.vercel.app', 'shop.example.com', 'a.com:8080', 'x@y.com']) {
      expect(normaliseHostname(bad).ok, bad).toBe(false)
    }
  })
  it('gives CNAME for subdomains, A for apex, and a TXT ownership record', () => {
    const sub = dnsInstructions('shop.mybrand.com', 'abc', { cname: 'shops.fungua.test', aRecord: null })
    expect(sub[0]).toMatchObject({ type: 'CNAME', host: 'shop', value: 'shops.fungua.test' })
    expect(sub[1]).toMatchObject({ type: 'TXT', host: '_fungua-verification.shop.mybrand.com', value: 'fungua-verify=abc' })
    const apex = dnsInstructions('mybrand.com', 'abc', { cname: null, aRecord: null })
    expect(apex[0]).toMatchObject({ type: 'A', host: '@', value: null })
    expect(isApexDomain('www.mybrand.co.uk')).toBe(false)
    expect(dnsTargetsFromEnv({ VITE_CUSTOM_DOMAIN_A_RECORD: 'not-ip', VITE_CUSTOM_DOMAIN_CNAME_TARGET: ' shops.fungua.test ' })).toEqual({ cname: 'shops.fungua.test', aRecord: null })
  })
  it('recognises platform hosts', () => {
    expect(isPlatformHost('localhost')).toBe(true)
    expect(isPlatformHost('127.0.0.1')).toBe(true)
    expect(isPlatformHost('fungua-git-main.vercel.app')).toBe(true)
    expect(isPlatformHost('app.fungua.test', ['fungua.test'])).toBe(true)
    expect(isPlatformHost('shop.mybrand.com', ['fungua.test'])).toBe(false)
  })
})

describe('eTIMS invoices', () => {
  it('validates KRA PIN format', () => {
    expect(normaliseKraPin(' p051234567x ')).toEqual({ ok: true, value: 'P051234567X' })
    expect(normaliseKraPin('')).toEqual({ ok: true, value: null })
    for (const bad of ['P05123456X', 'P0512345678X', '1051234567X', 'P051234567', 'PP51234567X']) expect(normaliseKraPin(bad).ok, bad).toBe(false)
  })

  const src = (unit: number, qty: number, bps: number, mode: 'exclusive' | 'inclusive', discount = 0) => {
    const t = computeLine({ unitPriceMinor: unit, quantity: qty, taxRateBps: bps, discountMinor: discount }, mode)
    return { productName: 'Kikoi', variantName: 'Blue', sku: 'K1', quantity: qty, unitPriceMinor: unit, discountMinor: discount, taxRateBps: bps, subtotalMinor: t.subtotalMinor, taxMinor: t.taxMinor, lineTotal: t.totalMinor }
  }

  it('net excludes tax in both modes and totals match the order', () => {
    const ex = src(250000, 2, 1600, 'exclusive')
    const lex = invoiceLine(ex, 'exclusive')
    expect(lex).toMatchObject({ description: 'Kikoi - Blue', netMinor: 500000, taxMinor: 80000, grossMinor: 580000 })
    expect(lex.grossMinor).toBe(ex.lineTotal)

    const inc = src(116000, 1, 1600, 'inclusive')
    const linc = invoiceLine(inc, 'inclusive')
    expect(linc).toMatchObject({ netMinor: 100000, taxMinor: 16000, grossMinor: 116000 })

    const lines = [lex, invoiceLine(src(999, 3, 800, 'exclusive', 100), 'exclusive')]
    const totals = invoiceTotals(lines, 20000)
    expect(totals.totalMinor).toBe(lines.reduce((a, l) => a + l.grossMinor, 0) + 20000)
    expect(taxBreakdown(lines).map((b) => b.taxRateBps)).toEqual([1600, 800])
  })

  it('numbers invoices gaplessly', () => {
    expect(nextInvoiceNumber([])).toBe(1)
    expect(nextInvoiceNumber([1, 2, 3])).toBe(4)
    expect(formatInvoiceNumber(42)).toBe('INV-000042')
    expect(suggestedTaxBand(1600)).toBe('B (16%)')
    expect(suggestedTaxBand(0)).toBe('Check')
  })

  it('exports a CSV line per item plus delivery, never claiming KRA submission', () => {
    const line = invoiceLine(src(250000, 2, 1600, 'exclusive'), 'exclusive')
    const inv: TaxInvoiceRecord = {
      id: 'i1', orderId: 'o1', orderNumber: 1001, invoiceNumber: 7, sellerName: 'Mto Home', sellerPin: 'P051234567X', buyerPin: null, buyerName: '=HYPERLINK("x")',
      currency: 'KES', taxMode: 'exclusive', lines: [line], netMinor: 500000, taxMinor: 80000, deliveryMinor: 15000, totalMinor: 595000,
      issuedAt: '2026-11-19T22:30:00Z', kraStatus: 'not_submitted',
    }
    const csv = invoicesCsv([inv])
    const rows = parseCsv(csv).records
    expect(rows).toHaveLength(3)
    expect(rows[1][0]).toBe('INV-000007')
    expect(rows[1][1]).toBe('2026-11-20') // Nairobi business date
    expect(rows[1][5]).toBe(`'=HYPERLINK("x")`) // formula injection neutralised
    expect(rows[1]).toContain('2500.00')
    expect(rows[1]).toContain('800.00')
    expect(rows[2][6]).toMatch(/Delivery/)
    expect(csv).toMatch(/Not submitted/)
  })
})

describe('Bank transfer (NGN)', () => {
  it('is only offered for NGN shops with a connected provider', () => {
    expect(bankTransferEligible('NGN')).toBe(true)
    expect(bankTransferEligible('KES')).toBe(false)
    expect(bankTransferAvailable({ currency: 'NGN', provider: 'paystack_dva', connected: true })).toBe(true)
    expect(bankTransferAvailable({ currency: 'NGN', provider: 'paystack_dva', connected: false })).toBe(false)
    expect(bankTransferAvailable({ currency: 'NGN', provider: 'none', connected: true })).toBe(false)
    expect(bankTransferAvailable({ currency: 'KES', provider: 'flutterwave_va', connected: true })).toBe(false)
    expect(isNuban('0123456789')).toBe(true)
    expect(isNuban('123')).toBe(false)
  })
})
