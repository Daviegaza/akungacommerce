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
    provider: 'mpesa_daraja',
    kind: 'payment',
    name: 'M-Pesa Daraja',
    label: 'not_implemented',
    detail: 'Not built. M-Pesa payments can be recorded manually and are marked unverified.',
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
    detail: 'No courier API is connected. Manual assignee and tracking reference are built in.',
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
