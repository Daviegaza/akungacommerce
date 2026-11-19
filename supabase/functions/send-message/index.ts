// Outbound message dispatch: POST /send-message
// Body: { orgId, channel: 'whatsapp'|'email'|'sms', purpose: 'transactional'|'marketing',
//         customerId?, to?, body, subject?, template? }
// Returns the SendResult as JSON. With no provider secrets set (the current
// state) it returns { status: 'not_configured', missing: [...] } — expected.
//
// Labels: WhatsApp / Resend / Twilio are all adapter_only.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  ResendEmailSender,
  TwilioSmsSender,
  WhatsAppCloudSender,
  type MessageSender,
  type OutboundMessage,
  type SendResult,
  type WhatsAppTemplate,
} from '../_shared/providers.ts'
import { canSendMarketing } from '../_shared/consent.ts'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Channel = 'whatsapp' | 'email' | 'sms'

interface SendRequest {
  orgId: string
  channel: Channel
  purpose: 'transactional' | 'marketing'
  customerId: string | null
  to: string | null
  body: string
  subject?: string
  template?: WhatsAppTemplate
}

function parseRequest(raw: unknown): SendRequest | string {
  if (typeof raw !== 'object' || raw === null) return 'Body must be a JSON object'
  const r = raw as Record<string, unknown>
  if (typeof r.orgId !== 'string' || !UUID_RE.test(r.orgId)) return 'orgId must be a UUID'
  if (r.channel !== 'whatsapp' && r.channel !== 'email' && r.channel !== 'sms') return 'channel must be whatsapp, email or sms'
  const purpose = r.purpose ?? 'transactional'
  if (purpose !== 'transactional' && purpose !== 'marketing') return 'purpose must be transactional or marketing'
  if (r.customerId != null && (typeof r.customerId !== 'string' || !UUID_RE.test(r.customerId))) return 'customerId must be a UUID'
  if (r.to != null && (typeof r.to !== 'string' || r.to.length > 320)) return 'to must be a string'
  if (typeof r.body !== 'string' || r.body.length > 4096) return 'body must be a string up to 4096 characters'
  if (r.subject != null && (typeof r.subject !== 'string' || r.subject.length > 300)) return 'subject must be a string'
  let template: WhatsAppTemplate | undefined
  if (r.template != null) {
    const t = r.template as Record<string, unknown>
    if (typeof t.name !== 'string' || typeof t.languageCode !== 'string') return 'template needs name and languageCode'
    const params = Array.isArray(t.bodyParams) ? t.bodyParams : []
    if (!params.every((p) => typeof p === 'string')) return 'template.bodyParams must be strings'
    template = { name: t.name, languageCode: t.languageCode, bodyParams: params as string[] }
  }
  return {
    orgId: r.orgId,
    channel: r.channel,
    purpose,
    customerId: (r.customerId as string | undefined) ?? null,
    to: (r.to as string | undefined) ?? null,
    body: r.body,
    subject: r.subject as string | undefined,
    template,
  }
}

function senderFor(channel: Channel): MessageSender | SendResult {
  const env = (k: string) => Deno.env.get(k) ?? null
  switch (channel) {
    case 'whatsapp':
      // Feature flag from the product brief: official WhatsApp sending stays off until verified.
      if (env('WHATSAPP_SEND_ENABLED') !== 'true') return { status: 'not_configured', missing: ['WHATSAPP_SEND_ENABLED'] }
      return new WhatsAppCloudSender({ phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'), accessToken: env('WHATSAPP_ACCESS_TOKEN') }, fetch)
    case 'email':
      return new ResendEmailSender({ apiKey: env('RESEND_API_KEY'), from: env('RESEND_FROM') }, fetch)
    case 'sms':
      return new TwilioSmsSender(
        { accountSid: env('TWILIO_ACCOUNT_SID'), authToken: env('TWILIO_AUTH_TOKEN'), from: env('TWILIO_FROM') },
        fetch,
      )
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Sign in required' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return json({ error: 'Server not configured' }, 503)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const parsed = parseRequest(raw)
  if (typeof parsed === 'string') return json({ error: parsed }, 400)

  // Caller-scoped client: every query runs as the signed-in user under RLS.
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Sign in required' }, 401)

  const { data: allowed, error: permError } = await db.rpc('has_permission', { p_org: parsed.orgId, p_permission: 'orders.create' })
  if (permError) return json({ error: 'Permission check failed' }, 500)
  if (allowed !== true) return json({ error: 'You do not have permission to send messages for this organisation' }, 403)

  // Recipient and consent come from the database, never from the request, when a customer is named.
  let to = parsed.to
  if (parsed.customerId) {
    const { data: customer, error } = await db
      .from('customers')
      .select('phone_e164, email, marketing_consent')
      .eq('id', parsed.customerId)
      .eq('org_id', parsed.orgId)
      .maybeSingle()
    if (error) return json({ error: 'Customer lookup failed' }, 500)
    if (!customer) return json({ error: 'Customer not found' }, 404)
    if (parsed.purpose === 'marketing' && !canSendMarketing({ marketingConsent: customer.marketing_consent === true })) {
      return json({ error: 'Customer has not consented to marketing messages' }, 403)
    }
    to = parsed.channel === 'email' ? customer.email : customer.phone_e164
    if (!to) return json({ error: `Customer has no ${parsed.channel === 'email' ? 'email address' : 'phone number'}` }, 422)
  } else if (parsed.purpose === 'marketing') {
    return json({ error: 'Marketing messages need a customerId so consent can be checked' }, 400)
  }
  if (!to) return json({ error: 'Recipient (to or customerId) is required' }, 400)

  // TODO: per-org rate limiting and an outbound message log before any provider is enabled.
  const sender = senderFor(parsed.channel)
  if (!('send' in sender)) return json(sender)

  const msg: OutboundMessage = { to, body: parsed.body, subject: parsed.subject, template: parsed.template }
  const result = await sender.send(msg)
  return json(result, result.status === 'failed' ? 502 : 200)
})
