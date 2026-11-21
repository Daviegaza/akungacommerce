/**
 * Which server-side integrations have their secrets set. Booleans only: never a value,
 * a length or a prefix. Used by the `health` Edge Function for uptime monitors and
 * for operators checking a deployment before go-live.
 */

/** Secret names each integration needs (matches supabase/functions/README.md). */
export const INTEGRATION_SECRETS: Readonly<Record<string, readonly string[]>> = {
  mpesa_callbacks: ['DARAJA_CALLBACK_URL', 'MPESA_CALLBACK_SECRET'],
  mpesa_platform_account: [
    'DARAJA_ENV',
    'DARAJA_CONSUMER_KEY',
    'DARAJA_CONSUMER_SECRET',
    'DARAJA_SHORTCODE',
    'DARAJA_PASSKEY',
    'DARAJA_ALLOW_PLATFORM_SHORTCODE',
  ],
  mpesa_ip_allowlist: ['MPESA_ALLOWED_IPS', 'MPESA_CLIENT_IP_HEADER'],
  whatsapp_inbound: ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'],
  whatsapp_outbound: ['WHATSAPP_SEND_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  paystack: ['PAYSTACK_SECRET_KEY'],
  stripe: ['STRIPE_WEBHOOK_SECRET'],
  email_resend: ['RESEND_API_KEY', 'RESEND_FROM'],
  sms_twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
  cors_origin: ['ALLOWED_ORIGIN'],
}

export type Readiness = Record<string, { ready: boolean; missing: string[] }>

export function integrationReadiness(get: (name: string) => string | undefined): Readiness {
  const out: Readiness = {}
  for (const [name, keys] of Object.entries(INTEGRATION_SECRETS)) {
    const missing = keys.filter((k) => !(get(k) ?? '').trim())
    out[name] = { ready: missing.length === 0, missing }
  }
  // The platform account only counts when the operator explicitly opted in.
  if ((get('DARAJA_ALLOW_PLATFORM_SHORTCODE') ?? '').trim() !== 'true') {
    out.mpesa_platform_account = { ready: false, missing: out.mpesa_platform_account.missing }
  }
  if ((get('WHATSAPP_SEND_ENABLED') ?? '').trim() !== 'true') {
    out.whatsapp_outbound = { ready: false, missing: out.whatsapp_outbound.missing }
  }
  return out
}
