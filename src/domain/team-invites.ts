/**
 * Staff invitations and plain-language role descriptions (pure).
 *
 * The database enforces the same rules in create_team_invite / accept_team_invite
 * (supabase/migrations/20261120000050_parity_and_expansion.sql): only a hash of
 * the token is stored, invites expire after 7 days, are single-use, email
 * invites must be accepted by that email, and only an owner can invite an owner.
 */
import type { CountryCode } from 'libphonenumber-js/min'
import { toE164 } from './locale'
import { PERMISSION_MATRIX, ROLES, can, type Permission, type Role } from './permissions'

export const INVITE_TTL_DAYS = 7
export const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const
export type InviteStatus = (typeof INVITE_STATUSES)[number]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type InviteContact = { kind: 'email'; email: string } | { kind: 'phone'; phoneE164: string }

/** Read what the owner typed as either an email address or a phone number. */
export function parseInviteContact(input: string, defaultCountry?: CountryCode): { ok: true; contact: InviteContact } | { ok: false; error: string } {
  const v = input.trim()
  if (!v) return { ok: false, error: 'Enter an email address or a phone number' }
  if (v.includes('@')) {
    const email = v.toLowerCase()
    return EMAIL_RE.test(email) ? { ok: true, contact: { kind: 'email', email } } : { ok: false, error: 'Enter a valid email address' }
  }
  const phone = toE164(v, defaultCountry)
  return phone.ok ? { ok: true, contact: { kind: 'phone', phoneE164: phone.e164 } } : { ok: false, error: phone.error }
}

/** Roles a person may hand out. Owners only come from owners. */
export function assignableRoles(actor: Role): Role[] {
  if (!can(actor, 'team.manage')) return []
  return ROLES.filter((r) => r !== 'owner' || actor === 'owner')
}

export function effectiveInviteStatus(stored: 'pending' | 'accepted' | 'revoked', expiresAt: string, now: Date = new Date()): InviteStatus {
  if (stored === 'pending' && Date.parse(expiresAt) <= now.getTime()) return 'expired'
  return stored
}

export function inviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString()
}

/** 32 random bytes, URL-safe base64 (43 chars), same shape as the SQL token. */
export function generateInviteToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 hex of the token: the only form that is stored. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isPlausibleInviteToken(token: string | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{30,100}$/.test(token)
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/app/join/${encodeURIComponent(token)}`
}

/** "w***@example.com" / "***149". Shown on the join page before sign-in. */
export function maskContact(c: InviteContact): string {
  if (c.kind === 'email') {
    const [user, domain] = c.email.split('@')
    return `${user.slice(0, 1)}***@${domain}`
  }
  return `***${c.phoneE164.slice(-3)}`
}

/** Prepared message the owner sends themselves (WhatsApp / SMS / email). Nothing is sent automatically. */
export function inviteMessage(orgName: string, roleLabel: string, link: string): string {
  return `You're invited to join ${orgName} on Rafu as ${roleLabel}. Open this link to accept (valid for ${INVITE_TTL_DAYS} days): ${link}`
}

/* ───────────── Plain-language permissions ───────────── */

export const PERMISSION_PLAIN: Record<Permission, string> = {
  'orders.create': 'Take new orders and cancel them',
  'orders.transition': 'Move orders along (confirm, pack, dispatch)',
  'fulfilment.update': 'Update delivery details and proof of delivery',
  'payments.record': 'Record payments and issue tax invoices',
  'refunds.create': 'Record refunds and returns',
  'customers.write': 'Add and edit customers',
  'catalogue.write': 'Add products, change prices, import CSV',
  'inventory.adjust': 'Adjust stock counts',
  'cost.read': 'See cost prices and the audit log',
  'team.manage': 'Invite people and change roles',
  'integrations.manage': 'Choose payment providers',
  'org.manage': 'Change business and shop settings',
}

export const ROLE_PLAIN: Record<Role, { title: string; summary: string }> = {
  owner: { title: 'Owner', summary: 'Full control, including other owners.' },
  admin: { title: 'Admin', summary: 'Runs everything except owner access.' },
  manager: { title: 'Manager', summary: 'Runs the shop day to day: products, stock, orders and refunds.' },
  sales: { title: 'Sales / cashier', summary: 'Takes orders and payments at the counter or on WhatsApp.' },
  fulfilment: { title: 'Fulfilment / rider', summary: 'Packs and delivers orders. Cannot see money settings.' },
  analyst: { title: 'Analyst', summary: 'Can view orders, products and reports. Cannot change anything.' },
}

/** What a role can and cannot do, in the matrix order. */
export function roleCapabilities(role: Role): { can: string[]; cannot: string[] } {
  const out = { can: [] as string[], cannot: [] as string[] }
  for (const p of Object.keys(PERMISSION_MATRIX) as Permission[]) (can(role, p) ? out.can : out.cannot).push(PERMISSION_PLAIN[p])
  return out
}
