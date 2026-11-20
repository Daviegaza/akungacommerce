/**
 * Parity and expansion contract: CSV product import, marketing IDs, staff
 * invitations, custom domains, the NGN bank-transfer rail and eTIMS invoices.
 * Mirrors supabase/migrations/20261120000050_parity_and_expansion.sql.
 * Implemented by expansion-supabase.ts and expansion-demo.ts (simulated, labelled).
 */
import type { Role } from '@/domain/permissions'
import type { DuplicateMode, ServerImportRow } from '@/domain/catalogue-import'
import type { InviteStatus } from '@/domain/team-invites'
import type { DomainStatus } from '@/domain/custom-domain'
import type { BankTransferProviderId } from '@/domain/bank-transfer'
import type { TaxInvoiceRecord } from '@/domain/etims'

export type { TaxInvoiceRecord }

/** One validated CSV row as sent to the server (minor units). */
export type ImportRowInput = ServerImportRow

export interface ImportResult {
  ok: boolean
  dryRun: boolean
  createdProducts: number
  createdVariants: number
  updatedVariants: number
  skipped: number
  errors: { line: number; message: string }[]
}

export interface ShopExtras {
  metaPixelId: string | null
  ga4Id: string | null
  kraPin: string | null
  bankTransferProvider: BankTransferProviderId
  /** Invoices issued so far + 1. */
  nextInvoiceNumber: number
}

export interface CustomDomain {
  hostname: string
  status: DomainStatus
  verificationToken: string
  failureReason: string | null
  lastCheckedAt: string | null
  verifiedAt: string | null
  createdAt: string
}

export interface TeamInvite {
  id: string
  email: string | null
  phoneE164: string | null
  role: Role
  status: InviteStatus
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
}

export interface CreatedInvite {
  invite: TeamInvite
  /** Raw link token. Returned once; only its hash is stored. */
  token: string
}

export interface InvitePreview {
  orgName: string
  role: Role
  status: InviteStatus
  expiresAt: string
  contactKind: 'email' | 'phone'
  contactHint: string
}

export interface NewInviteInput {
  email: string | null
  phoneE164: string | null
  role: Role
}

export interface ExpansionAdminGateway {
  importProducts(orgId: string, rows: ImportRowInput[], opts: { onDuplicate: DuplicateMode; dryRun: boolean }): Promise<ImportResult>

  getShopExtras(orgId: string): Promise<ShopExtras>
  saveTrackingIds(orgId: string, ids: { metaPixelId: string | null; ga4Id: string | null }): Promise<void>
  saveKraPin(orgId: string, pin: string | null): Promise<void>
  setBankTransferProvider(orgId: string, provider: BankTransferProviderId): Promise<void>

  getCustomDomain(orgId: string): Promise<CustomDomain | null>
  setCustomDomain(orgId: string, hostname: string): Promise<CustomDomain>
  removeCustomDomain(orgId: string): Promise<void>
  /** Demo workspace only: pretend a DNS check ran. Absent in Supabase mode. */
  simulateDomainCheck?(orgId: string, outcome: 'verified' | 'failed'): Promise<void>

  listInvites(orgId: string): Promise<TeamInvite[]>
  createInvite(orgId: string, input: NewInviteInput): Promise<CreatedInvite>
  revokeInvite(orgId: string, inviteId: string): Promise<void>
  previewInvite(token: string): Promise<InvitePreview>
  /** Returns the organisation joined. */
  acceptInvite(token: string): Promise<string>
  /** Demo workspace only: pretend the invited person accepted. Absent in Supabase mode. */
  simulateInviteAcceptance?(orgId: string, inviteId: string): Promise<void>

  issueTaxInvoice(orgId: string, orderId: string, buyer: { pin: string | null; name: string | null }): Promise<TaxInvoiceRecord>
  getTaxInvoice(orgId: string, orderId: string): Promise<TaxInvoiceRecord | null>
  listTaxInvoices(orgId: string): Promise<TaxInvoiceRecord[]>
}

/** Public storefront additions. */
export interface StorefrontExtras {
  metaPixelId: string | null
  ga4Id: string | null
  bankTransfer: { available: boolean; provider: BankTransferProviderId; simulated: boolean }
}

export interface StorefrontExtrasGateway {
  getStorefrontExtras(slug: string): Promise<StorefrontExtras>
  /** Verified custom domain -> shop slug, or null. */
  resolveShopHost(hostname: string): Promise<string | null>
}
