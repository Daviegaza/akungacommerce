import { useState, type FormEvent } from 'react'
import type { CountryCode } from 'libphonenumber-js/min'
import { Copy, Mail, MessageCircle, UserPlus } from 'lucide-react'
import { ROLE_LABEL, type Role } from '@/domain/permissions'
import { ROLE_PLAIN, assignableRoles, inviteLink, inviteMessage, parseInviteContact, roleCapabilities } from '@/domain/team-invites'
import { formatPhone } from '@/domain/locale'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import type { CreatedInvite, TeamInvite } from '@/gateway/expansion'
import { useAction, useGateway, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Sheet, Table, Td, Th } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Field, Input, Skeleton, buttonClass, type Tone } from '../ui/primitives'

const STATUS_TONE: Record<TeamInvite['status'], Tone> = { pending: 'warn', accepted: 'pos', revoked: 'neutral', expired: 'neutral' }
const STATUS_LABEL: Record<TeamInvite['status'], string> = { pending: 'Waiting', accepted: 'Joined', revoked: 'Revoked', expired: 'Expired' }

export function RolePicker({ value, onChange, roles }: { value: Role; onChange: (r: Role) => void; roles: Role[] }) {
  const caps = roleCapabilities(value)
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-[13px] font-semibold text-ink">Role</legend>
      <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
        {roles.map((r) => (
          <label key={r} className={`flex min-h-11 cursor-pointer items-start gap-3 px-3.5 py-3 transition-colors ${value === r ? 'bg-sunken/70' : 'hover:bg-sunken/40'}`}>
            <input type="radio" name="invite-role" checked={value === r} onChange={() => onChange(r)} className="mt-0.5 size-4 shrink-0 accent-[var(--ak-brand)]" />
            <span className="min-w-0 text-sm">
              <span className="font-medium text-ink">{ROLE_PLAIN[r].title}</span>
              <span className="block text-xs leading-relaxed text-ink-3">{ROLE_PLAIN[r].summary}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1 grid gap-3 rounded-lg border border-line bg-sunken/50 p-3 text-xs sm:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold text-ink">{ROLE_PLAIN[value].title} can</p>
          {caps.can.length === 0 ? <p className="text-ink-3">Only view</p> : <ul className="list-disc space-y-0.5 pl-4 text-ink-2">{caps.can.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
        <div>
          <p className="mb-1 font-semibold text-ink">Cannot</p>
          {caps.cannot.length === 0 ? <p className="text-ink-3">Nothing is off limits</p> : <ul className="list-disc space-y-0.5 pl-4 text-ink-3">{caps.cannot.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
      </div>
    </fieldset>
  )
}

function ShareInvite({ created }: { created: CreatedInvite }) {
  const { org } = useOrg()
  const [copied, setCopied] = useState(false)
  const link = inviteLink(window.location.origin, created.token)
  const message = inviteMessage(org.name, ROLE_PLAIN[created.invite.role].title, link)
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="text-sm text-ink">
        Invitation ready for <strong className="font-semibold">{created.invite.email ?? (created.invite.phoneE164 ? formatPhone(created.invite.phoneE164) : '')}</strong>. Fungua does not send it
        for you: share the link below. It works once and expires in 7 days.
      </p>
      <div className="rounded-lg border border-line bg-sunken/50 px-3 py-2.5 font-mono text-xs break-all text-ink-2 select-all">{link}</div>
      <p className="text-xs text-ink-3">This link is shown only now. If you lose it, send a new invitation.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Copy className="size-4" aria-hidden />}
          onClick={() => void navigator.clipboard?.writeText(message).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy message'}
        </Button>
        {created.invite.phoneE164 && (
          <a href={whatsappChatLink(created.invite.phoneE164, message)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
          </a>
        )}
        {created.invite.email && (
          <a
            href={`mailto:${encodeURIComponent(created.invite.email)}?subject=${encodeURIComponent(`Join ${org.name} on Fungua`)}&body=${encodeURIComponent(message)}`}
            className={buttonClass('secondary', 'sm')}
          >
            <Mail className="size-4" aria-hidden /> Email
          </a>
        )}
      </div>
    </div>
  )
}

function InviteSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { org } = useOrg()
  const roles = assignableRoles(org.role)
  const [contact, setContact] = useState('')
  const [role, setRole] = useState<Role>('sales')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const create = useAction((g, o, input: { email: string | null; phoneE164: string | null; role: Role }) => g.createInvite(o, input))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = parseInviteContact(contact, org.countryCode as CountryCode)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    try {
      setCreated(
        await create.mutateAsync({
          email: r.contact.kind === 'email' ? r.contact.email : null,
          phoneE164: r.contact.kind === 'phone' ? r.contact.phoneE164 : null,
          role,
        }),
      )
    } catch {
      /* shown below */
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={created ? 'Share the invitation' : 'Invite staff'}
      description={created ? undefined : 'They join with their own login. You can change their role or remove them any time.'}
      footer={
        created ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" variant="primary" loading={create.isPending}>
              Create invitation
            </Button>
          </>
        )
      }
    >
      {created ? (
        <ShareInvite created={created} />
      ) : (
        <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          {create.isError && <ErrorNotice error={create.error} />}
          <Field label="Email or phone number" error={error} hint="Email invites must be accepted by that email address. Phone invites work for whoever opens the link, so send it only to them.">
            {(p) => <Input {...p} autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="name@yourshop.com or a phone number" />}
          </Field>
          <RolePicker value={role} onChange={setRole} roles={roles} />
        </form>
      )}
    </Sheet>
  )
}

function inviteContact(invite: TeamInvite): string {
  return invite.email ?? (invite.phoneE164 ? formatPhone(invite.phoneE164) : '')
}

/** One invitation: a table row on sm+, a compact divided item on phones. */
function InviteRow({ invite, layout }: { invite: TeamInvite; layout: 'row' | 'item' }) {
  const gateway = useGateway()
  const { org } = useOrg()
  const revoke = useAction((g, o) => g.revokeInvite(o, invite.id))
  const simulate = useAction((g, o) => (g.simulateInviteAcceptance ? g.simulateInviteAcceptance(o, invite.id) : Promise.resolve()))
  const canTouch = invite.role !== 'owner' || org.role === 'owner'
  const error = revoke.error ?? simulate.error

  const when =
    invite.status === 'pending' ? (
      <>
        Expires <When iso={invite.expiresAt} dateOnly />
      </>
    ) : (
      <>
        Sent <When iso={invite.createdAt} dateOnly />
      </>
    )

  const actions =
    invite.status === 'pending' && canTouch ? (
      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        {gateway.simulateInviteAcceptance && (
          <Button size="sm" variant="ghost" className="h-10" loading={simulate.isPending} onClick={() => simulate.mutate(undefined)}>
            Simulate joining (demo)
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-10 text-ink-3 hover:text-neg"
          loading={revoke.isPending}
          onClick={() => revoke.mutate(undefined)}
          aria-label={`Revoke invitation for ${invite.email ?? invite.phoneE164}`}
        >
          Revoke
        </Button>
      </div>
    ) : null

  if (layout === 'row') {
    return (
      <tr>
        <Td className="max-w-[280px]">
          <p className="truncate font-medium text-ink">{inviteContact(invite)}</p>
          {error && (
            <div className="mt-2 whitespace-normal">
              <ErrorNotice error={error} />
            </div>
          )}
        </Td>
        <Td>
          <Badge>
            <span className="sr-only">Role: </span>
            {ROLE_LABEL[invite.role]}
          </Badge>
        </Td>
        <Td>
          <Badge tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Badge>
        </Td>
        <Td className="text-[13px] whitespace-nowrap text-ink-2">{when}</Td>
        <Td align="right" className="whitespace-nowrap">
          {actions}
        </Td>
      </tr>
    )
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-ink">{inviteContact(invite)}</p>
        <Badge tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Badge>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        {ROLE_LABEL[invite.role]} · {when}
      </p>
      {actions && <div className="mt-1.5 -ml-3">{actions}</div>}
      {error && (
        <div className="mt-2">
          <ErrorNotice error={error} />
        </div>
      )}
    </li>
  )
}

/** Pending and recent invitations, plus the "Invite staff" flow. Shown to team managers only. */
export function TeamInvites() {
  const { can } = useOrg()
  const manage = can('team.manage')
  const invites = useOrgQuery('team-invites', (g, o) => (manage ? g.listInvites(o) : Promise.resolve([])))
  const [open, setOpen] = useState(false)
  if (!manage) return null
  const list = invites.data ?? []
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink">Invitations</h3>
          <p className="mt-0.5 text-xs text-ink-3">Links you created. Nothing is sent automatically.</p>
        </div>
        <Button size="sm" variant="primary" className="h-10 shrink-0" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
          Invite staff
        </Button>
      </div>
      {invites.isPending ? (
        <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      ) : invites.isError ? (
        <ErrorNotice error={invites.error} onRetry={() => void invites.refetch()} />
      ) : list.length === 0 ? (
        <p className="border-y border-line py-4 text-sm text-ink-3">No invitations yet. Invite a cashier, a rider or a manager by email or phone.</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <caption className="sr-only">Team invitations</caption>
              <thead>
                <tr>
                  <Th>Invited</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <InviteRow key={i.id} invite={i} layout="row" />
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {list.map((i) => (
              <InviteRow key={i.id} invite={i} layout="item" />
            ))}
          </ul>
        </>
      )}
      {open && <InviteSheet open={open} onOpenChange={setOpen} />}
    </div>
  )
}
