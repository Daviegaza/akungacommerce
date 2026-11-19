import { describe, expect, it, vi } from 'vitest'
import { verifyMetaSignature, verifyPaystackSignature, verifyStripeSignature } from './signatures.ts'
import {
  ResendEmailSender,
  TwilioSmsSender,
  WhatsAppCloudSender,
  extractWhatsAppEvents,
  parsePaystackEvent,
  parseStripeEvent,
  paystackEventKey,
  type FetchLike,
} from './providers.ts'
import { canSendMarketing, isOptOut } from './consent.ts'

// Expected signatures are computed independently here with crypto.subtle.
async function hmacHex(hash: 'SHA-256' | 'SHA-512', secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '123' }] })

describe('verifyMetaSignature', () => {
  const secret = 'meta-app-secret'
  it('accepts a valid signature', async () => {
    const header = `sha256=${await hmacHex('SHA-256', secret, BODY)}`
    expect(await verifyMetaSignature(BODY, header, secret)).toEqual({ ok: true })
  })
  it('accepts upper-case hex', async () => {
    const header = `sha256=${(await hmacHex('SHA-256', secret, BODY)).toUpperCase()}`
    expect((await verifyMetaSignature(BODY, header, secret)).ok).toBe(true)
  })
  it('rejects a signature over a different body', async () => {
    const header = `sha256=${await hmacHex('SHA-256', secret, BODY)}`
    const r = await verifyMetaSignature(BODY + ' ', header, secret)
    expect(r).toEqual({ ok: false, reason: 'Signature mismatch' })
  })
  it('rejects the wrong secret', async () => {
    const header = `sha256=${await hmacHex('SHA-256', 'other', BODY)}`
    expect((await verifyMetaSignature(BODY, header, secret)).ok).toBe(false)
  })
  it('rejects a missing header', async () => {
    const r = await verifyMetaSignature(BODY, null, secret)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Missing/)
  })
  it.each(['sha1=abcd', 'sha256=', 'sha256=zz', 'sha256=abc', `sha256=${'a'.repeat(62)}`, 'garbage'])(
    'rejects malformed header %s',
    async (header) => {
      const r = await verifyMetaSignature(BODY, header, secret)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/Malformed/)
    },
  )
  it('refuses when the secret is not configured', async () => {
    const header = `sha256=${'0'.repeat(64)}`
    expect(await verifyMetaSignature(BODY, header, '')).toEqual({ ok: false, reason: 'App secret not configured' })
  })
})

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret'
  const t = 1_700_000_000
  const sign = (body: string, ts = t, key = secret) => hmacHex('SHA-256', key, `${ts}.${body}`)

  it('accepts a valid signature inside the tolerance', async () => {
    const header = `t=${t},v1=${await sign(BODY)}`
    expect(await verifyStripeSignature(BODY, header, secret, { now: t + 10 })).toEqual({ ok: true })
  })
  it('rejects a tampered body', async () => {
    const header = `t=${t},v1=${await sign(BODY)}`
    const r = await verifyStripeSignature(BODY.replace('123', '124'), header, secret, { now: t })
    expect(r).toEqual({ ok: false, reason: 'Signature mismatch' })
  })
  it('rejects the wrong secret', async () => {
    const header = `t=${t},v1=${await sign(BODY, t, 'whsec_other')}`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t })).ok).toBe(false)
  })
  it('rejects an expired timestamp (replay) even with a valid signature', async () => {
    const header = `t=${t},v1=${await sign(BODY)}`
    const r = await verifyStripeSignature(BODY, header, secret, { now: t + 301 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/tolerance/)
  })
  it('rejects a timestamp too far in the future', async () => {
    const header = `t=${t},v1=${await sign(BODY)}`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t - 301 })).ok).toBe(false)
  })
  it('honours a custom tolerance', async () => {
    const header = `t=${t},v1=${await sign(BODY)}`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t + 500, toleranceSeconds: 600 })).ok).toBe(true)
  })
  it('rejects a re-signed timestamp that does not match the signature', async () => {
    const header = `t=${t + 100},v1=${await sign(BODY)}`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t + 100 })).ok).toBe(false)
  })
  it('accepts when any one of multiple v1 signatures matches', async () => {
    const wrong = await sign(BODY, t, 'whsec_old')
    const header = `t=${t},v1=${wrong},v1=${await sign(BODY)},v0=deadbeef`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t })).ok).toBe(true)
  })
  it('rejects when none of multiple v1 signatures match', async () => {
    const header = `t=${t},v1=${await sign(BODY, t, 'a')},v1=${await sign(BODY, t, 'b')}`
    expect((await verifyStripeSignature(BODY, header, secret, { now: t })).ok).toBe(false)
  })
  it.each([null, '', 'v1=abc', `t=abc,v1=${'0'.repeat(64)}`, `t=${t}`, `t=${t},v0=${'0'.repeat(64)}`])(
    'rejects missing/malformed header %s',
    async (header) => {
      expect((await verifyStripeSignature(BODY, header, secret, { now: t })).ok).toBe(false)
    },
  )
})

describe('verifyPaystackSignature', () => {
  const secret = 'sk_test_paystack'
  it('accepts a valid HMAC-SHA512 signature', async () => {
    const header = await hmacHex('SHA-512', secret, BODY)
    expect(await verifyPaystackSignature(BODY, header, secret)).toEqual({ ok: true })
  })
  it('rejects a tampered body', async () => {
    const header = await hmacHex('SHA-512', secret, BODY)
    expect((await verifyPaystackSignature(BODY + 'x', header, secret)).ok).toBe(false)
  })
  it('rejects the wrong secret', async () => {
    const header = await hmacHex('SHA-512', 'sk_other', BODY)
    expect((await verifyPaystackSignature(BODY, header, secret)).ok).toBe(false)
  })
  it('rejects a SHA-256-length signature, missing header and non-hex', async () => {
    expect((await verifyPaystackSignature(BODY, await hmacHex('SHA-256', secret, BODY), secret)).ok).toBe(false)
    expect((await verifyPaystackSignature(BODY, null, secret)).ok).toBe(false)
    expect((await verifyPaystackSignature(BODY, 'not-hex', secret)).ok).toBe(false)
  })
})

// ───────────────────────── Senders ─────────────────────────

function mockFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('message senders', () => {
  const sms = { to: '+254712345678', body: 'Your order #12 is ready' }

  it('return not_configured without calling fetch when config is missing', async () => {
    const f = mockFetch(200, {})
    const wa = await new WhatsAppCloudSender({ phoneNumberId: '', accessToken: null }, f).send(sms)
    const em = await new ResendEmailSender({ apiKey: 'k' }, f).send({ to: 'a@b.co', body: 'x', subject: 's' })
    const tw = await new TwilioSmsSender({ accountSid: 'AC1', authToken: '  ' }, f).send(sms)
    expect(wa).toEqual({ status: 'not_configured', missing: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] })
    expect(em).toEqual({ status: 'not_configured', missing: ['RESEND_FROM'] })
    expect(tw).toEqual({ status: 'not_configured', missing: ['TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] })
    expect(f).not.toHaveBeenCalled()
  })

  it('WhatsApp: sent only with a provider message id; builds a template request', async () => {
    const f = mockFetch(200, { messages: [{ id: 'wamid.ABC' }] })
    const sender = new WhatsAppCloudSender({ phoneNumberId: '1098', accessToken: 'tok' }, f)
    const r = await sender.send({ ...sms, template: { name: 'order_ready', languageCode: 'en_US', bodyParams: ['12'] } })
    expect(r).toEqual({ status: 'sent', providerMessageId: 'wamid.ABC' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/1098/messages')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(init?.body as string)
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '254712345678', type: 'template' })
    expect(body.template.components[0].parameters).toEqual([{ type: 'text', text: '12' }])
  })

  it('WhatsApp: free text body when no template', async () => {
    const f = mockFetch(200, { messages: [{ id: 'wamid.T' }] })
    await new WhatsAppCloudSender({ phoneNumberId: '1', accessToken: 't' }, f).send(sms)
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toMatchObject({ type: 'text', text: { body: sms.body } })
  })

  it('WhatsApp: failed on non-2xx and on 2xx without an id', async () => {
    const bad = await new WhatsAppCloudSender({ phoneNumberId: '1', accessToken: 'secret-token' }, mockFetch(401, { error: { message: 'Invalid OAuth access token' } })).send(sms)
    expect(bad.status).toBe('failed')
    if (bad.status === 'failed') {
      expect(bad.error).toContain('401')
      expect(bad.error).not.toContain('secret-token')
    }
    const noId = await new WhatsAppCloudSender({ phoneNumberId: '1', accessToken: 't' }, mockFetch(200, { messages: [] })).send(sms)
    expect(noId).toEqual({ status: 'failed', error: 'Provider response had no message id' })
  })

  it('WhatsApp: rejects non-E.164 recipients without calling fetch', async () => {
    const f = mockFetch(200, {})
    const r = await new WhatsAppCloudSender({ phoneNumberId: '1', accessToken: 't' }, f).send({ to: '0712345678', body: 'x' })
    expect(r.status).toBe('failed')
    expect(f).not.toHaveBeenCalled()
  })

  it('failed on a network error', async () => {
    const f = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed')
    })
    const r = await new ResendEmailSender({ apiKey: 'k', from: 'Shop <o@shop.co>' }, f).send({ to: 'a@b.co', body: 'x', subject: 's' })
    expect(r).toEqual({ status: 'failed', error: 'Network error: fetch failed' })
  })

  it('Resend: sent with id, failed on non-2xx or missing id', async () => {
    const ok = mockFetch(200, { id: 'email_123' })
    const cfg = { apiKey: 're_key', from: 'Shop <o@shop.co>' }
    expect(await new ResendEmailSender(cfg, ok).send({ to: 'a@b.co', body: 'Hi', subject: 'Order' })).toEqual({
      status: 'sent',
      providerMessageId: 'email_123',
    })
    const [url, init] = ok.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(JSON.parse(init?.body as string)).toEqual({ from: cfg.from, to: ['a@b.co'], subject: 'Order', text: 'Hi' })
    expect((await new ResendEmailSender(cfg, mockFetch(422, { message: 'bad' })).send({ to: 'a@b.co', body: 'Hi', subject: 'S' })).status).toBe('failed')
    expect((await new ResendEmailSender(cfg, mockFetch(200, {})).send({ to: 'a@b.co', body: 'Hi', subject: 'S' })).status).toBe('failed')
  })

  it('Twilio: form-encoded basic-auth request; sent with sid, failed on non-2xx', async () => {
    const ok = mockFetch(201, { sid: 'SM123' })
    const cfg = { accountSid: 'AC42', authToken: 'tok', from: '+15005550006' }
    expect(await new TwilioSmsSender(cfg, ok).send(sms)).toEqual({ status: 'sent', providerMessageId: 'SM123' })
    const [url, init] = ok.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC42/Messages.json')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('AC42:tok')}`)
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(init?.body as string)
    expect(form.get('To')).toBe(sms.to)
    expect(form.get('From')).toBe(cfg.from)
    expect(form.get('Body')).toBe(sms.body)
    expect((await new TwilioSmsSender(cfg, mockFetch(400, { message: 'invalid' })).send(sms)).status).toBe('failed')
    expect((await new TwilioSmsSender(cfg, mockFetch(201, { status: 'queued' })).send(sms)).status).toBe('failed')
  })

  it('Twilio: uses MessagingServiceSid for MG senders', async () => {
    const ok = mockFetch(201, { sid: 'SM1' })
    await new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: 'MGabc' }, ok).send(sms)
    const form = new URLSearchParams(ok.mock.calls[0][1]?.body as string)
    expect(form.get('MessagingServiceSid')).toBe('MGabc')
    expect(form.get('From')).toBeNull()
  })
})

// ───────────────────────── Payment events ─────────────────────────

const ORDER_ID = '0b7c6f2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'

describe('parseStripeEvent', () => {
  const event = (over: Record<string, unknown> = {}, type = 'payment_intent.succeeded') => ({
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'pi_1',
        status: 'succeeded',
        amount: 2000,
        amount_received: 1999,
        currency: 'usd',
        created: 1_700_000_000,
        payment_method_types: ['card'],
        metadata: { akunga_order_id: ORDER_ID },
        ...over,
      },
    },
  })

  it('normalises payment_intent.succeeded', () => {
    expect(parseStripeEvent(event())).toEqual({
      provider: 'stripe',
      eventId: 'evt_1',
      type: 'payment_intent.succeeded',
      orderId: ORDER_ID,
      amountMinor: 1999,
      currency: 'USD',
      externalRef: 'pi_1',
      method: 'card',
      receivedAt: new Date(1_700_000_000_000).toISOString(),
      succeeded: true,
    })
  })
  it('returns null orderId when metadata is missing or not a UUID', () => {
    expect(parseStripeEvent(event({ metadata: {} }))?.orderId).toBeNull()
    expect(parseStripeEvent(event({ metadata: { akunga_order_id: "1' or 1=1" } }))?.orderId).toBeNull()
  })
  it('returns null for unsupported or malformed events', () => {
    expect(parseStripeEvent(event({}, 'charge.refunded'))).toBeNull()
    expect(parseStripeEvent(event({ status: 'processing' }))).toBeNull()
    expect(parseStripeEvent(event({ amount_received: 10.5 }))).toBeNull()
    expect(parseStripeEvent(event({ amount_received: -5 }))).toBeNull()
    expect(parseStripeEvent(event({ currency: 'us' }))).toBeNull()
    expect(parseStripeEvent(event({ currency: 'isk' }))).toBeNull()
    expect(parseStripeEvent(null)).toBeNull()
    expect(parseStripeEvent('x')).toBeNull()
  })
})

describe('parsePaystackEvent', () => {
  const event = (data: Record<string, unknown> = {}, name = 'charge.success') => ({
    event: name,
    data: {
      id: 302961,
      status: 'success',
      reference: 'ref_abc',
      amount: 150000,
      currency: 'ngn',
      channel: 'card',
      paid_at: '2026-11-19T10:00:00.000Z',
      metadata: { akunga_order_id: ORDER_ID },
      ...data,
    },
  })

  it('normalises charge.success (amount already in minor units)', () => {
    expect(parsePaystackEvent(event())).toEqual({
      provider: 'paystack',
      eventId: 'charge.success:302961',
      type: 'charge.success',
      orderId: ORDER_ID,
      amountMinor: 150000,
      currency: 'NGN',
      externalRef: 'ref_abc',
      method: 'card',
      receivedAt: '2026-11-19T10:00:00.000Z',
      succeeded: true,
    })
  })
  it('accepts metadata delivered as a JSON string and maps channels', () => {
    const e = parsePaystackEvent(event({ metadata: JSON.stringify({ akunga_order_id: ORDER_ID }), channel: 'mobile_money' }))
    expect(e?.orderId).toBe(ORDER_ID)
    expect(e?.method).toBe('mobile_money')
    expect(parsePaystackEvent(event({ channel: 'bank_transfer' }))?.method).toBe('bank_transfer')
    expect(parsePaystackEvent(event({ channel: 'ussd' }))?.method).toBe('other')
  })
  it('returns null for unsupported or malformed events', () => {
    expect(parsePaystackEvent(event({}, 'transfer.success'))).toBeNull()
    expect(parsePaystackEvent(event({ status: 'failed' }))).toBeNull()
    expect(parsePaystackEvent(event({ amount: '1500' }))).toBeNull()
    expect(parsePaystackEvent(event({ reference: '' }))).toBeNull()
    expect(parsePaystackEvent({})).toBeNull()
  })
  it('paystackEventKey gives a stable dedupe key for any event', () => {
    expect(paystackEventKey(event({}, 'refund.processed'))).toBe('refund.processed:302961')
    expect(paystackEventKey({ event: 'x', data: {} })).toBeNull()
  })
})

// ───────────────────────── Consent / WhatsApp inbound ─────────────────────────

describe('consent', () => {
  it.each(['STOP', 'stop', '  Stop  ', 'UNSUBSCRIBE', 'stopall', 'Cancel', 'end', 'QUIT\n'])('%j is an opt-out', (t) => {
    expect(isOptOut(t)).toBe(true)
  })
  it.each(['please stop', 'STOP!', 'stopping', '', 'hello', null, undefined])('%j is not an opt-out', (t) => {
    expect(isOptOut(t)).toBe(false)
  })
  it('marketing requires explicit consent', () => {
    expect(canSendMarketing({ marketingConsent: true })).toBe(true)
    expect(canSendMarketing({ marketingConsent: false })).toBe(false)
  })
})

describe('extractWhatsAppEvents', () => {
  it('extracts inbound messages and statuses', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA1',
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PN1' },
                messages: [
                  { id: 'wamid.1', from: '254712345678', type: 'text', text: { body: 'STOP' } },
                  { id: 'wamid.bad', from: '+bad', type: 'text' },
                ],
                statuses: [{ id: 'wamid.0', status: 'delivered', timestamp: '1700000000' }],
              },
            },
          ],
        },
      ],
    }
    const r = extractWhatsAppEvents(payload)
    expect(r.entryIds).toEqual(['WABA1'])
    expect(r.messages).toEqual([{ id: 'wamid.1', fromE164: '+254712345678', phoneNumberId: 'PN1', type: 'text', text: 'STOP' }])
    expect(r.statuses).toEqual([{ id: 'wamid.0', status: 'delivered', timestamp: '1700000000' }])
  })
  it('tolerates junk', () => {
    expect(extractWhatsAppEvents(null)).toEqual({ messages: [], statuses: [], entryIds: [] })
    expect(extractWhatsAppEvents({ entry: [null, { changes: 'x' }] }).messages).toEqual([])
  })
})
