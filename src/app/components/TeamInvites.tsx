import { useState, type FormEvent } from 'react'
import type { CountryCode } from 'libphonenumber-js/min'
import { Copy, Mail, MessageCircle, UserPlus } from 'lucide-react'
import { ROLE_LABEL, type Role } from '@/domain/permissions'
import { ROLE_PLAIN, assignableRoles, inviteLink, inviteMessage, parseInviteContact, roleCapabilities } from '@/domain/team-invites'
import { formatPhone } from '@/domain/locale'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import type { CreatedInvite, TeamInvite } from '@/gateway/expansion'
import { useAction, useGateway, useOrg, useOrgQuery } from '../context'
import { ErrorNotice, Sheet } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Field, Input, Skeleton, buttonClass, type Tone } from '../ui/primitives'

const STATUS_TONE: Record<TeamInvite['status'], Tone> = { pending: 'warn', accepted: 'pos', revoked: 'neutral', expired: 'neutral' }
const STATUS_LABEL: Record<TeamInvite['status'], string> = { pending: 'Waiting', accepted: 'Joined', revoked: 'Revoked', expired: 'Expired' }

export function RolePicker({ value, onChange, roles }: { value: Role; onChange: (r: Role) => void; roles: Role[] }) {
  const caps = roleCapabilities(value)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-semibold text-ink">Role</legend>
      {roles.map((r) => (
        <label key={r} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${value === r ? 'border-brand bg-brand-soft/50' : 'border-line hover:bg-sunken'}`}>
          <input type="radio" name="invite-role" checked={value === r} onChange={() => onChange(r)} className="mt-1 size-4 shrink-0 accent-[var(--ak-brand)]" />
          <span className="text-sm">
            <span className="font-semibold text-ink">{ROLE_PLAIN[r].title}</span>
            <span className="block text-ink-3">{ROLE_PLAIN[r].summary}</span>
          </span>
        </label>
      ))}
      <div className="mt-1 grid gap-3 rounded-xl bg-sunken p-3 text-xs sm:grid-cols-2">
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
        Invitation ready for <strong>{created.invite.email ?? (created.invite.phoneE164 ? formatPhone(created.invite.phoneE164) : '')}</strong>. Fungua does not send it
        for you: share the link below. It works once and expires in 7 days.
      </p>
      <div className="rounded-xl bg-sunken p-3 text-xs break-all text-ink-2">{link}</div>
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
            {(p) => <Input {...p} autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="wanjiru@shop.co.ke or 0712 345 678" />}
          </Field>
          <RolePicker value={role} onChange={setRole} roles={roles} />
        </form>
      )}
    </Sheet>
  )
}

function InviteRow({ invite }: { invite: TeamInvite }) {
  const gateway = useGateway()
  const { org } = useOrg()
  const revoke = useAction((g, o) => g.revokeInvite(o, invite.id))
  const simulate = useAction((g, o) => (g.simulateInviteAcceptance ? g.simulateInviteAcceptance(o, invite.id) : Promise.resolve()))
  const canTouch = invite.role !== 'owner' || org.role === 'owner'
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{invite.email ?? (invite.phoneE164 ? formatPhone(invite.phoneE164) : '')}</p>
        <p className="text-xs text-ink-3">
          {ROLE_LABEL[invite.role]} · {invite.status === 'pending' ? <>expires <When iso={invite.expiresAt} dateOnly /></> : <>sent <When iso={invite.createdAt} dateOnly /></>}
        </p>
        {(revoke.error ?? simulate.error) && <ErrorNotice error={revoke.error ?? simulate.error} />}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Badge>
        {invite.status === 'pending' && canTouch && (
          <>
            {gateway.simulateInviteAcceptance && (
              <Button size="sm" variant="ghost" loading={simulate.isPending} onClick={() => simulate.mutate(undefined)}>
                Simulate joining (demo)
              </Button>
            )}
            <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(undefined)} aria-label={`Revoke invitation for ${invite.email ?? invite.phoneE164}`}>
              Revoke
            </Button>
          </>
        )}
      </div>
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
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">Invitations</h3>
        <Button size="sm" variant="primary" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
          Invite staff
        </Button>
      </div>
      {invites.isPending ? (
        <Skeleton className="h-12" />
      ) : invites.isError ? (
        <ErrorNotice error={invites.error} onRetry={() => void invites.refetch()} />
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-3">No invitations yet. Invite a cashier, a rider or a manager by email or phone.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((i) => (
            <InviteRow key={i.id} invite={i} />
          ))}
        </ul>
      )}
      {open && <InviteSheet open={open} onOpenChange={setOpen} />}
    </div>
  )
}
