import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CountryCode } from 'libphonenumber-js/min'
import { COUNTRY_PRESETS, formatPhone, listTimezones, toE164 } from '@/domain/locale'
import type { TaxMode } from '@/domain/orders'
import { ROLES, ROLE_LABEL, can as roleCan, type Permission, type Role } from '@/domain/permissions'
import type { AuditEntry, IntegrationKind, IntegrationLabel, IntegrationStatus, Member, OrganisationPatch } from '@/gateway/types'
import { INTEGRATION_LABEL_TEXT } from '@/integrations/registry'
import { useAction, useAudit, useGateway, useIntegrations, useMembers, useOrg, useSessionUser } from '../context'
import { Check, Minus } from 'lucide-react'
import { DefinitionList, EmptyState, ErrorNotice, PageHeader, Sheet, Table, Td, Th } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Field, Input, Select, Skeleton, type Tone } from '../ui/primitives'
import { TeamInvites } from '../components/TeamInvites'
import { SettingsBlock } from '../components/DeliveryRules'
import { BRAND } from '@/brand/brand'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TAX_MODE_LABEL: Record<TaxMode, string> = {
  exclusive: 'Tax added on top of prices',
  inclusive: 'Prices already include tax',
}

function countryName(code: string): string {
  const preset = COUNTRY_PRESETS.find((c) => c.code === code)
  if (preset) return preset.name
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

function isValidLocale(tag: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0
  } catch {
    return false
  }
}

/* ───────────── Business profile ───────────── */

interface ProfileForm {
  name: string
  legalName: string
  contactEmail: string
  contactPhone: string
  timezone: string
  locale: string
  taxMode: TaxMode
}

type ProfileErrors = Partial<Record<keyof ProfileForm, string>>

function ProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { org } = useOrg()
  const qc = useQueryClient()
  const timezones = useMemo(() => {
    const list = listTimezones()
    return list.includes(org.timezone) ? list : [org.timezone, ...list]
  }, [org.timezone])
  const [form, setForm] = useState<ProfileForm>(() => ({
    name: org.name,
    legalName: org.legalName ?? '',
    contactEmail: org.contactEmail ?? '',
    contactPhone: org.contactPhone ? formatPhone(org.contactPhone) : '',
    timezone: org.timezone,
    locale: org.locale,
    taxMode: org.taxMode,
  }))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const save = useAction((g, o, patch: OrganisationPatch) => g.updateOrganisation(o, patch))

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: ProfileErrors = {}
    const name = form.name.trim()
    if (!name) errs.name = 'Enter the business name'
    const email = form.contactEmail.trim()
    if (email && !EMAIL_RE.test(email)) errs.contactEmail = 'Enter a valid email address, e.g. hello@yourshop.com'
    let phone: string | null = null
    if (form.contactPhone.trim()) {
      const r = toE164(form.contactPhone, org.countryCode as CountryCode)
      if (r.ok) phone = r.e164
      else errs.contactPhone = r.error
    }
    const locale = form.locale.trim()
    if (!isValidLocale(locale)) errs.locale = 'Use a language tag such as en-KE, de-DE or ja-JP'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    try {
      await save.mutateAsync({
        name,
        legalName: form.legalName.trim() || null,
        contactEmail: email || null,
        contactPhone: phone,
        timezone: form.timezone,
        locale,
        taxMode: form.taxMode,
      })
      await qc.invalidateQueries({ queryKey: ['orgs'] })
      onOpenChange(false)
    } catch {
      /* shown via save.error */
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit business profile"
      description="Shown on receipts and used for dates and number formats."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="profile-form" variant="primary" loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="profile-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {save.isError && <ErrorNotice error={save.error} />}
        <Field label="Business name" error={errors.name}>
          {(p) => <Input {...p} required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Legal name" optional hint="If different from the trading name.">
          {(p) => <Input {...p} maxLength={160} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />}
        </Field>
        <Field label="Contact email" optional error={errors.contactEmail}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />}
        </Field>
        <Field
          label="Contact phone"
          optional
          error={errors.contactPhone}
          hint={`Numbers without a country code are read as ${countryName(org.countryCode)}.`}
        >
          {(p) => <Input {...p} type="tel" autoComplete="tel" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />}
        </Field>
        <Field label="Time zone" hint="Reports and dates use this zone. Times are stored in UTC.">
          {(p) => (
            <Select {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {timezones.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Number and date format" error={errors.locale} hint="A language tag, e.g. en-KE, de-DE, ja-JP.">
          {(p) => <Input {...p} value={form.locale} onChange={(e) => set('locale', e.target.value)} placeholder="en-GB" />}
        </Field>
        <Field label="Prices" hint="Applies to new orders. Tax rates are metadata; confirm rules with a qualified adviser.">
          {(p) => (
            <Select {...p} value={form.taxMode} onChange={(e) => set('taxMode', e.target.value as TaxMode)}>
              <option value="exclusive">{TAX_MODE_LABEL.exclusive}</option>
              <option value="inclusive">{TAX_MODE_LABEL.inclusive}</option>
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  )
}

function ProfileSection() {
  const { org, can } = useOrg()
  const [open, setOpen] = useState(false)
  const editable = can('org.manage')
  return (
    <SettingsBlock
      first
      title="Business profile"
      description={editable ? 'Shown on receipts and used for dates and number formats.' : 'Only owners and admins can change these details.'}
      actions={
        editable && (
          <Button size="sm" className="h-10" onClick={() => setOpen(true)}>
            Edit profile
          </Button>
        )
      }
    >
      <DefinitionList
        items={[
          { label: 'Business name', value: org.name },
          { label: 'Legal name', value: org.legalName ?? <span className="text-ink-3">Not set</span> },
          { label: 'Contact email', value: org.contactEmail ?? <span className="text-ink-3">Not set</span> },
          {
            label: 'Contact phone',
            value: org.contactPhone ? <span className="tnum">{formatPhone(org.contactPhone)}</span> : <span className="text-ink-3">Not set</span>,
          },
          { label: 'Time zone', value: org.timezone.replace(/_/g, ' ') },
          { label: 'Number format', value: org.locale },
          { label: 'Prices', value: TAX_MODE_LABEL[org.taxMode] },
          { label: 'Base currency', value: org.baseCurrency },
          { label: 'Country', value: countryName(org.countryCode) },
        ]}
      />
      <p className="mt-3 max-w-2xl text-xs text-ink-3">
        Base currency and country are fixed after setup: prices, orders and payments are stored in them, and changing them would misstate past
        figures. Amounts are never converted between currencies.
      </p>
      {open && <ProfileSheet open={open} onOpenChange={setOpen} />}
    </SettingsBlock>
  )
}

/* ───────────── Team ───────────── */

const MATRIX_ROWS: { permission: Permission; label: string }[] = [
  { permission: 'orders.create', label: 'Take orders' },
  { permission: 'orders.transition', label: 'Move orders along' },
  { permission: 'fulfilment.update', label: 'Update delivery details' },
  { permission: 'payments.record', label: 'Record payments' },
  { permission: 'refunds.create', label: 'Record refunds' },
  { permission: 'customers.write', label: 'Edit customers' },
  { permission: 'catalogue.write', label: 'Edit products and prices' },
  { permission: 'inventory.adjust', label: 'Adjust stock' },
  { permission: 'cost.read', label: 'See cost prices and audit log' },
  { permission: 'team.manage', label: 'Manage team' },
  { permission: 'org.manage', label: 'Edit business settings' },
]

const ROLE_SHORT: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  fulfilment: 'Fulfilment',
  analyst: 'Analyst',
}

function RoleMatrix() {
  return (
    <details className="mt-8 border-t border-line pt-4">
      <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink-2 hover:text-ink">What each role can do</summary>
      <p className="mt-1 text-xs text-ink-3">Everyone can view orders, products and reports. Analysts can only view.</p>
      <div className="mt-3">
        <Table>
          <caption className="sr-only">Permissions by role</caption>
          <thead>
            <tr>
              <Th>
                <span className="sr-only">Permission</span>
              </Th>
              {ROLES.map((r) => (
                <Th key={r} align="right">
                  {ROLE_SHORT[r]}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.permission}>
                <th scope="row" className="border-b border-line py-2 pr-4 text-left text-[13px] font-normal whitespace-nowrap text-ink-2">
                  {row.label}
                </th>
                {ROLES.map((r) => (
                  <Td key={r} align="right" className="py-2">
                    {roleCan(r, row.permission) ? (
                      <span className="inline-flex text-ink">
                        <Check className="size-4" aria-hidden />
                        <span className="sr-only">Yes</span>
                      </span>
                    ) : (
                      <span className="inline-flex text-ink-3">
                        <Minus className="size-4" aria-hidden />
                        <span className="sr-only">No</span>
                      </span>
                    )}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </details>
  )
}

function AddMemberSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { org } = useOrg()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('sales')
  const [emailError, setEmailError] = useState<string | null>(null)
  const add = useAction((g, o, input: { email: string; role: Role }) => g.addMember(o, input.email, input.role))
  const assignable = ROLES.filter((r) => r !== 'owner' || org.role === 'owner')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const v = email.trim().toLowerCase()
    if (!EMAIL_RE.test(v)) {
      setEmailError('Enter the email address they signed up with')
      return
    }
    try {
      await add.mutateAsync({ email: v, role })
      setEmail('')
      onOpenChange(false)
    } catch {
      /* shown via add.error */
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a team member"
      description={`They must already have a ${BRAND.name} account. No invitation email is sent, so let them know yourself.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-member-form" variant="primary" loading={add.isPending}>
            Add member
          </Button>
        </>
      }
    >
      <form id="add-member-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {add.isError && <ErrorNotice error={add.error} />}
        <Field label="Email" error={emailError}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setEmailError(null)
              }}
            />
          )}
        </Field>
        <Field label="Role" hint="You can change this later.">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  )
}

function memberName(m: Member): string {
  return m.displayName || m.email || `User ${m.userId.slice(0, 8)}`
}

function MemberActions({ m, isSelf, manage }: { m: Member; isSelf: boolean; manage: boolean }) {
  const { org } = useOrg()
  const [confirming, setConfirming] = useState(false)
  const setRole = useAction((g, o, role: Role) => g.setMemberRole(o, m.userId, role))
  const remove = useAction((g, o) => g.removeMember(o, m.userId))
  const canTouch = manage && !isSelf && (m.role !== 'owner' || org.role === 'owner')
  const options = ROLES.filter((r) => r !== 'owner' || org.role === 'owner' || m.role === 'owner')
  const error = setRole.error ?? remove.error

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {canTouch ? (
          <>
            <label className="sr-only" htmlFor={`role-${m.userId}`}>
              Role for {memberName(m)}
            </label>
            <Select
              id={`role-${m.userId}`}
              value={m.role}
              disabled={setRole.isPending}
              onChange={(e) => setRole.mutate(e.target.value as Role)}
              className="h-10 w-auto min-w-[150px]"
            >
              {options.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <span title={isSelf ? 'You cannot change your own role' : 'You cannot change this role'}>
            <Badge>
              <span className="sr-only">Role: </span>
              {ROLE_LABEL[m.role]}
            </Badge>
          </span>
        )}
        {canTouch &&
          (confirming ? (
            <span className="flex items-center gap-1" role="group" aria-label={`Confirm removing ${memberName(m)}`}>
              <Button size="sm" variant="danger" className="h-10" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
                Remove
              </Button>
              <Button size="sm" variant="ghost" className="h-10" onClick={() => setConfirming(false)} disabled={remove.isPending}>
                Keep
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="h-10 text-ink-3 hover:text-neg" onClick={() => setConfirming(true)} aria-label={`Remove ${memberName(m)}`}>
              Remove
            </Button>
          ))}
        {isSelf && <span className="text-xs text-ink-3">You</span>}
      </div>
      {error && <ErrorNotice error={error} />}
    </div>
  )
}

function TeamSection() {
  const { can } = useOrg()
  const members = useMembers()
  const session = useSessionUser()
  const [adding, setAdding] = useState(false)
  const manage = can('team.manage')
  const selfId = session.data?.id

  return (
    <SettingsBlock
      wide
      title="Team and permissions"
      description={manage ? 'Who can work in this business and what they can do.' : 'Only owners and admins can add people or change roles.'}
      actions={
        manage && (
          <Button size="sm" variant="secondary" className="h-10" onClick={() => setAdding(true)}>
            Add existing account
          </Button>
        )
      }
    >
      <h3 className="mb-2 text-[13px] font-semibold text-ink">Members</h3>
      {members.isPending ? (
        <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-9 w-36" />
            </div>
          ))}
        </div>
      ) : members.isError ? (
        <ErrorNotice error={members.error} onRetry={() => void members.refetch()} />
      ) : members.data.length === 0 ? (
        <EmptyState title="No team members" body={`Add the people who take orders or pack them. They need a ${BRAND.name} account first.`} />
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th className="hidden lg:table-cell">Joined</Th>
                  <Th align="right">Role</Th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.userId}>
                    <Td className="max-w-[320px]">
                      <p className="truncate font-medium text-ink">{memberName(m)}</p>
                      {m.displayName && m.email && <p className="truncate text-xs text-ink-3">{m.email}</p>}
                    </Td>
                    <Td className="hidden text-ink-2 lg:table-cell">
                      <When iso={m.createdAt} dateOnly />
                    </Td>
                    <Td className="text-right">
                      <MemberActions m={m} isSelf={m.userId === selfId} manage={manage} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {members.data.map((m) => (
              <li key={m.userId} className="py-3">
                <p className="truncate text-[15px] font-medium text-ink">{memberName(m)}</p>
                <p className="mb-2 text-xs break-words text-ink-3">
                  {m.displayName && m.email && <>{m.email} · </>}
                  Joined <When iso={m.createdAt} dateOnly />
                </p>
                <MemberActions m={m} isSelf={m.userId === selfId} manage={manage} />
              </li>
            ))}
          </ul>
        </>
      )}
      <TeamInvites />
      <RoleMatrix />
      {adding && <AddMemberSheet open={adding} onOpenChange={setAdding} />}
    </SettingsBlock>
  )
}

/* ───────────── Integrations ───────────── */

const KIND_ORDER: IntegrationKind[] = ['payment', 'whatsapp', 'email', 'sms', 'delivery', 'accounting']
const KIND_LABEL: Record<IntegrationKind, string> = {
  payment: 'Payments',
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  delivery: 'Delivery',
  accounting: 'Accounting',
}
const LABEL_TONE: Record<IntegrationLabel, Tone> = {
  connected_verified: 'pos',
  configured_unverified: 'warn',
  adapter_only: 'info',
  not_implemented: 'neutral',
}

function IntegrationsSection() {
  const integrations = useIntegrations()
  const groups = useMemo(() => {
    const list = integrations.data ?? []
    return KIND_ORDER.map((kind) => ({ kind, items: list.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0)
  }, [integrations.data])

  return (
    <SettingsBlock title="Integrations" description="Honest status: nothing is shown as connected until a live end-to-end test has passed.">
      {integrations.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : integrations.isError ? (
        <ErrorNotice error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-3">No integrations are available.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <div key={g.kind}>
              <h3 className="mb-1 text-xs font-medium text-ink-3">{KIND_LABEL[g.kind]}</h3>
              <ul className="divide-y divide-line border-t border-line">
                {g.items.map((i: IntegrationStatus) => (
                  <li key={i.provider} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{i.name}</p>
                      <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-3">{i.detail}</p>
                      {i.lastTestedAt && (
                        <p className="mt-0.5 text-xs text-ink-3">
                          Last tested <When iso={i.lastTestedAt} />
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <Badge tone={LABEL_TONE[i.label]}>{INTEGRATION_LABEL_TEXT[i.label]}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-ink-3">
            Setting up a provider needs server credentials, not a button here. See <code className="text-ink-2">README.md</code> and{' '}
            <code className="text-ink-2">supabase/functions/README.md</code>.
          </p>
        </div>
      )}
    </SettingsBlock>
  )
}

/* ───────────── Audit log ───────────── */

const SKIP_KEYS = new Set(['updated_at', 'updatedAt'])

function showValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

function humanKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/** Compact "field: before → after" lines for what changed. */
function auditSummary(entry: Pick<AuditEntry, 'before' | 'after'>, max = 3): string {
  const { before, after } = entry
  if (!before && !after) return '—'
  if (!before) {
    const keys = Object.keys(after ?? {}).filter((k) => !SKIP_KEYS.has(k))
    return `Created${keys.length ? ` with ${keys.length} ${keys.length === 1 ? 'field' : 'fields'}` : ''}`
  }
  if (!after) return 'Removed'
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !SKIP_KEYS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
  if (keys.length === 0) return 'No field changes'
  const parts = keys.slice(0, max).map((k) => `${humanKey(k)}: ${showValue(before[k])} → ${showValue(after[k])}`)
  if (keys.length > max) parts.push(`+${keys.length - max} more`)
  return parts.join('; ')
}

function AuditSection() {
  const audit = useAudit()
  const rows = useMemo(
    () => [...(audit.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
    [audit.data],
  )
  return (
    <SettingsBlock wide title="Audit log" description="Newest 100 changes to orders, stock, payments and settings.">
      {audit.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : audit.isError ? (
        <ErrorNotice error={audit.error} onRetry={() => void audit.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-3">No changes recorded yet. Edits to orders, stock, payments and settings appear here.</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Entity</Th>
                  <Th>Action</Th>
                  <Th>Changes</Th>
                  <Th>Actor</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td className="text-ink-2">
                      <When iso={a.createdAt} />
                    </Td>
                    <Td className="whitespace-nowrap">{humanKey(a.entity)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{humanKey(a.action)}</Td>
                    <Td className="max-w-[360px] text-xs break-words text-ink-2">{auditSummary(a)}</Td>
                    <Td className="tnum text-xs text-ink-3">{a.actorId ? a.actorId.slice(0, 8) : 'system'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {rows.map((a) => (
              <li key={a.id} className="py-3">
                <p className="text-sm text-ink">
                  <span className="font-medium">{humanKey(a.entity)}</span> <span className="text-ink-2">{humanKey(a.action)}</span>
                </p>
                <p className="mt-0.5 text-xs break-words text-ink-2">{auditSummary(a)}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  <When iso={a.createdAt} /> · <span className="tnum">{a.actorId ? a.actorId.slice(0, 8) : 'system'}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingsBlock>
  )
}

/* ───────────── Demo ───────────── */

function DemoSection() {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      const { resetDemoWorkspace } = await import('@/gateway/demo')
      resetDemoWorkspace()
      // Drop every cached organisation query, then refetch whatever is on screen (session, orgs, this page).
      await qc.resetQueries()
      setDone(true)
      setConfirming(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsBlock title="Demo data" description="This workspace runs on fictional data stored only in this browser.">
      <div className="flex flex-col gap-3">
        {error != null && <ErrorNotice error={error} />}
        {done && !confirming && (
          <p role="status" className="text-sm text-pos">
            Demo data restored to its original state.
          </p>
        )}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm demo reset">
            <span className="text-sm text-ink-2">Every order, product and payment you changed will be replaced.</span>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void reset()}>
              Reset now
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              onClick={() => {
                setDone(false)
                setConfirming(true)
              }}
            >
              Reset demo data
            </Button>
          </div>
        )}
      </div>
    </SettingsBlock>
  )
}

/* ───────────── Page ───────────── */

export default function SettingsPage() {
  const { can } = useOrg()
  const gateway = useGateway()
  return (
    <>
      <PageHeader title="Settings" description="Business details, team access, integrations and the change history." />
      <ProfileSection />
      <TeamSection />
      <IntegrationsSection />
      {can('cost.read') && <AuditSection />}
      {gateway.mode === 'demo' && <DemoSection />}
    </>
  )
}
