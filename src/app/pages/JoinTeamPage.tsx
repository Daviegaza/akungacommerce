import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { ROLE_PLAIN, isPlausibleInviteToken, roleCapabilities } from '@/domain/team-invites'
import { RafuLogo } from '@/brand/RafuLogo'
import { useGateway, useSessionUser } from '../context'
import { DemoBanner } from '../AppShell'
import { SignInPage } from './AuthPages'
import { ErrorNotice, Notice } from '../ui/layout'
import { When } from '../ui/format'
import { Button, Skeleton, buttonClass } from '../ui/primitives'

const ORG_KEY = 'akunga.currentOrg'

/** /app/join/:token — accept a staff invitation. Works before the person belongs to any business. */
export default function JoinTeamPage() {
  const { token = '' } = useParams()
  const gateway = useGateway()
  const session = useSessionUser()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [signingIn, setSigningIn] = useState(false)
  const valid = isPlausibleInviteToken(token)

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => gateway.previewInvite(token),
    enabled: valid,
    retry: false,
  })
  const accept = useMutation({
    mutationFn: () => gateway.acceptInvite(token),
    onSuccess: async (orgId) => {
      try {
        localStorage.setItem(ORG_KEY, orgId)
      } catch {
        /* storage unavailable: the first business is shown */
      }
      await qc.invalidateQueries({ queryKey: ['orgs'] })
      navigate('/app', { replace: true })
    },
  })

  if (signingIn && !session.data) return <SignInPage />

  const p = preview.data
  const caps = p ? roleCapabilities(p.role) : null

  return (
    <div className="ak-root min-h-dvh">
      <DemoBanner />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-10">
        <RafuLogo />
        {!valid ? (
          <Notice tone="warn">This invitation link is incomplete. Ask for a new one.</Notice>
        ) : preview.isPending ? (
          <Skeleton className="h-48" />
        ) : preview.isError ? (
          <ErrorNotice error={preview.error} />
        ) : p && caps ? (
          <section className="rounded-[var(--radius-card)] bg-panel p-5 shadow-[var(--shadow-card)] ring-1 ring-line/60" aria-labelledby="join-title">
            <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Users className="size-5" aria-hidden />
            </span>
            <h1 id="join-title" className="font-display text-2xl font-extrabold tracking-tight text-ink">
              Join {p.orgName}
            </h1>
            <p className="mt-1 text-sm text-ink-2">
              As <strong>{ROLE_PLAIN[p.role].title}</strong>: {ROLE_PLAIN[p.role].summary}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              Sent to {p.contactHint} · {p.status === 'pending' ? <>valid until <When iso={p.expiresAt} dateOnly /></> : null}
            </p>
            {caps.can.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {caps.can.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-col gap-3">
              {p.status !== 'pending' ? (
                <Notice tone="warn">
                  {p.status === 'expired' ? 'This invitation has expired.' : p.status === 'accepted' ? 'This invitation was already used.' : 'This invitation was revoked.'}{' '}
                  Ask {p.orgName} for a new one.
                </Notice>
              ) : !session.data ? (
                <>
                  <Button variant="brand" size="lg" onClick={() => setSigningIn(true)}>
                    Sign in or create an account
                  </Button>
                  {p.contactKind === 'email' && <p className="text-xs text-ink-3">Use the email address the invitation was sent to ({p.contactHint}).</p>}
                </>
              ) : (
                <>
                  {accept.isError && <ErrorNotice error={accept.error} />}
                  <Button variant="brand" size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>
                    Accept and join
                  </Button>
                  <p className="text-xs text-ink-3">
                    Signed in as {session.data.email}.
                    {gateway.mode === 'demo' && ' Demo: accepting adds the invited person as a fictional teammate.'}
                  </p>
                </>
              )}
            </div>
          </section>
        ) : null}
        <Link to="/" className={buttonClass('ghost', 'sm', 'self-start')}>
          Not now
        </Link>
      </main>
    </div>
  )
}
