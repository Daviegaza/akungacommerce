import type { IntegrationLabel, IntegrationStatus } from '@/gateway/types'

/**
 * Honest integration status. Nothing in this repository is connected and
 * verified: a label only moves to `connected_verified` after a real
 * end-to-end test with live credentials.
 */

export const INTEGRATION_LABEL_TEXT: Record<IntegrationLabel, string> = {
  connected_verified: 'Connected and verified',
  configured_unverified: 'Configured, not verified',
  adapter_only: 'Adapter only',
  not_implemented: 'Not implemented',
}

const STATUSES: readonly IntegrationStatus[] = [
  {
    provider: 'whatsapp_cloud',
    kind: 'whatsapp',
    name: 'WhatsApp Business Platform (Cloud API)',
    label: 'adapter_only',
    detail:
      'Webhook signature verification and a send adapter exist. Needs a Meta app, phone number ID, access token, approved templates and the webhook URL registered, then an end-to-end test. WhatsApp chat links work today without any of this.',
    lastTestedAt: null,
  },
  {
    provider: 'resend',
    kind: 'email',
    name: 'Email via Resend',
    label: 'adapter_only',
    detail: 'Send adapter exists. Needs an API key, a verified sending domain and an end-to-end test.',
    lastTestedAt: null,
  },
  {
    provider: 'twilio',
    kind: 'sms',
    name: 'SMS via Twilio',
    label: 'adapter_only',
    detail: 'Send adapter exists. Needs an account SID, auth token, sender number and an end-to-end test.',
    lastTestedAt: null,
  },
  {
    provider: 'stripe',
    kind: 'payment',
    name: 'Stripe',
    label: 'adapter_only',
    detail:
      'Webhook signature verification and verified-payment recording exist. No charges are created by Akunga. Needs a webhook secret, the endpoint registered and an end-to-end test.',
    lastTestedAt: null,
  },
  {
    provider: 'paystack',
    kind: 'payment',
    name: 'Paystack',
    label: 'adapter_only',
    detail:
      'Webhook signature verification and verified-payment recording exist. Needs a secret key, the webhook URL registered and an end-to-end test.',
    lastTestedAt: null,
  },
  {
    provider: 'mpesa',
    kind: 'payment',
    name: 'M-Pesa Daraja (STK push)',
    label: 'adapter_only',
    detail:
      'STK push, STK callback and C2B confirmation adapters exist (mpesa-stk, mpesa-callback, mpesa-c2b) with automatic reconciliation. Needs a registered Till or Paybill, Daraja consumer key and secret, shortcode, passkey, a callback URL with its shared secret, then an end-to-end test. Until then M-Pesa payments are recorded manually and marked unverified.',
    lastTestedAt: null,
  },
  {
    provider: 'intasend',
    kind: 'payment',
    name: 'IntaSend (M-Pesa for Pochi / personal numbers)',
    label: 'adapter_only',
    detail:
      'Aggregator interface only. Its API has not been verified against official documentation in this build, so no endpoint is called and no prompt can be sent.',
    lastTestedAt: null,
  },
  {
    provider: 'pesapal',
    kind: 'payment',
    name: 'Pesapal (M-Pesa for Pochi / personal numbers)',
    label: 'adapter_only',
    detail:
      'Aggregator interface only. Its API has not been verified against official documentation in this build, so no endpoint is called and no prompt can be sent.',
    lastTestedAt: null,
  },
  {
    provider: 'flutterwave',
    kind: 'payment',
    name: 'Flutterwave',
    label: 'not_implemented',
    detail: 'Not built.',
    lastTestedAt: null,
  },
  {
    provider: 'courier',
    kind: 'delivery',
    name: 'Courier / delivery APIs',
    label: 'not_implemented',
    detail:
      'No courier API is connected. Built in without any API: a shareable rider link for your own rider, your own list of pick-up points, and a manual carrier name and tracking number.',
    lastTestedAt: null,
  },
  {
    provider: 'pickup_mtaani',
    kind: 'delivery',
    name: 'Pick Up Mtaani',
    label: 'not_implemented',
    detail:
      'No connection to Pick Up Mtaani exists. Agents can be added by hand as your own pick-up points (name, area, hours, fee); parcels, labels and status are not synced.',
    lastTestedAt: null,
  },
  {
    provider: 'bolt_send',
    kind: 'delivery',
    name: 'Bolt Send',
    label: 'not_implemented',
    detail: 'No connection to Bolt exists and no delivery is booked automatically. Book the trip yourself and record the carrier and reference on the order.',
    lastTestedAt: null,
  },
  {
    provider: 'xero',
    kind: 'accounting',
    name: 'Xero',
    label: 'not_implemented',
    detail: 'Not built. Use the CSV exports for orders, payments and refunds.',
    lastTestedAt: null,
  },
  {
    provider: 'quickbooks_online',
    kind: 'accounting',
    name: 'QuickBooks Online',
    label: 'not_implemented',
    detail: 'Not built. Use the CSV exports for orders, payments and refunds.',
    lastTestedAt: null,
  },
]

export function integrationStatuses(): IntegrationStatus[] {
  return STATUSES.map((s) => ({ ...s }))
}
