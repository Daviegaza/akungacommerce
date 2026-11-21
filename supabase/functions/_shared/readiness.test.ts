import { describe, expect, it } from 'vitest'
import { INTEGRATION_SECRETS, integrationReadiness } from './readiness.ts'

const get = (env: Record<string, string>) => (k: string) => env[k]

describe('integrationReadiness', () => {
  it('reports every integration as not ready with nothing set, naming the missing secrets', () => {
    const r = integrationReadiness(get({}))
    expect(Object.keys(r).sort()).toEqual(Object.keys(INTEGRATION_SECRETS).sort())
    expect(Object.values(r).every((x) => !x.ready)).toBe(true)
    expect(r.paystack.missing).toEqual(['PAYSTACK_SECRET_KEY'])
  })

  it('never returns secret values', () => {
    const r = integrationReadiness(get({ PAYSTACK_SECRET_KEY: 'sk_test_supersecret', RESEND_API_KEY: 're_hidden' }))
    expect(r.paystack).toEqual({ ready: true, missing: [] })
    expect(JSON.stringify(r)).not.toMatch(/supersecret|re_hidden/)
  })

  it('treats whitespace as missing and needs explicit opt-in flags', () => {
    expect(integrationReadiness(get({ PAYSTACK_SECRET_KEY: '  ' })).paystack.ready).toBe(false)
    const wa = { WHATSAPP_ACCESS_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: '1' }
    expect(integrationReadiness(get({ ...wa, WHATSAPP_SEND_ENABLED: 'yes' })).whatsapp_outbound.ready).toBe(false)
    expect(integrationReadiness(get({ ...wa, WHATSAPP_SEND_ENABLED: 'true' })).whatsapp_outbound.ready).toBe(true)
    const daraja = { DARAJA_ENV: 'sandbox', DARAJA_CONSUMER_KEY: 'k', DARAJA_CONSUMER_SECRET: 's', DARAJA_SHORTCODE: '174379', DARAJA_PASSKEY: 'p' }
    expect(integrationReadiness(get({ ...daraja, DARAJA_ALLOW_PLATFORM_SHORTCODE: 'false' })).mpesa_platform_account.ready).toBe(false)
    expect(integrationReadiness(get({ ...daraja, DARAJA_ALLOW_PLATFORM_SHORTCODE: 'true' })).mpesa_platform_account.ready).toBe(true)
  })
})
