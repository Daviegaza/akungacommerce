/**
 * Bank-transfer collections for Nigeria (NGN): the buyer pays into a dedicated
 * virtual account and the provider's webhook tells us the money arrived.
 *
 * This extends the collections-provider model used for M-Pesa
 * (reconciliation.ts / supabase/functions/_shared/collections.ts): the shop picks
 * a provider, and it only reaches buyers once an integration for it is
 * `connected_verified`. Server-side adapter: supabase/functions/_shared/bank-transfer.ts.
 * Nothing here calls a provider. Both providers are adapter only.
 */
import type { IntegrationLabel } from '@/gateway/types'

export const BANK_TRANSFER_PROVIDERS = ['none', 'paystack_dva', 'flutterwave_va'] as const
export type BankTransferProviderId = (typeof BANK_TRANSFER_PROVIDERS)[number]

export interface BankTransferDescriptor {
  id: Exclude<BankTransferProviderId, 'none'>
  name: string
  /** integration_connections.provider that must be connected_verified. */
  integration: string
  currencies: readonly string[]
  readiness: IntegrationLabel
  docs: string
  note: string
}

export const BANK_TRANSFER_DESCRIPTORS: readonly BankTransferDescriptor[] = [
  {
    id: 'paystack_dva',
    name: 'Paystack Dedicated Virtual Accounts',
    integration: 'paystack',
    currencies: ['NGN'],
    readiness: 'adapter_only',
    docs: 'https://paystack.com/docs/payments/dedicated-virtual-accounts/',
    note: 'Webhook signature check (HMAC SHA512, x-paystack-signature) and the charge.success / dedicated_nuban parser are built. Account creation is not called. Needs a Paystack secret key, DVA enabled on the account, the webhook URL registered and an end-to-end test.',
  },
  {
    id: 'flutterwave_va',
    name: 'Flutterwave virtual accounts',
    integration: 'flutterwave',
    currencies: ['NGN'],
    readiness: 'adapter_only',
    docs: 'https://developer.flutterwave.com/docs/webhooks',
    note: 'Webhook check (verif-hash secret, compared in constant time) is built. The virtual-account payment event format could not be confirmed from the official docs, so no payment is ever recorded from it yet.',
  },
]

export function bankTransferDescriptor(id: BankTransferProviderId): BankTransferDescriptor | null {
  return BANK_TRANSFER_DESCRIPTORS.find((d) => d.id === id) ?? null
}

/** Can a shop with this currency choose a provider at all? */
export function bankTransferEligible(currency: string): boolean {
  return BANK_TRANSFER_DESCRIPTORS.some((d) => d.currencies.includes(currency))
}

/** Shown at checkout only when NGN, a provider is chosen, and it is connected and verified. */
export function bankTransferAvailable(input: { currency: string; provider: BankTransferProviderId; connected: boolean }): boolean {
  const d = bankTransferDescriptor(input.provider)
  return Boolean(d && d.currencies.includes(input.currency) && input.connected)
}

/** A typed virtual account, as a provider would return it after assignment. */
export interface VirtualAccount {
  provider: Exclude<BankTransferProviderId, 'none'>
  bankName: string
  accountNumber: string
  accountName: string
  currency: 'NGN'
  /** Provider reference (e.g. Paystack customer code). */
  providerRef: string
}

/** NUBAN account numbers are 10 digits. */
export function isNuban(accountNumber: string): boolean {
  return /^[0-9]{10}$/.test(accountNumber)
}
