import { describe, expect, it } from 'vitest'
import { presetForBrowser } from './onboarding-defaults'

describe('presetForBrowser', () => {
  it('uses the browser language region', () => {
    expect(presetForBrowser('en-GB', 'Asia/Tokyo').code).toBe('GB')
    expect(presetForBrowser('de-DE', undefined).code).toBe('DE')
    expect(presetForBrowser('pt-BR', undefined).code).toBe('BR')
  })

  it('infers the region from a bare language and falls back to the time zone', () => {
    expect(presetForBrowser('ja', undefined).code).toBe('JP')
    expect(presetForBrowser('xx-ZZ', 'Africa/Lagos').code).toBe('NG')
  })

  it('falls back to the first preset when nothing matches', () => {
    expect(presetForBrowser(undefined, 'Pacific/Fiji').code).toBe('KE')
    expect(presetForBrowser('not a locale!!', undefined).code).toBe('KE')
  })
})
