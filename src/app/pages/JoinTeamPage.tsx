import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { ROLE_PLAIN, isPlausibleInviteToken, roleCapabilities } from '@/domain/team-invites'
import { FunguaLogo } from '@/brand/FunguaLogo'
import { useGateway, useSessionUser } from '../context'
import { DemoBanner } from '../AppShell'
import { SignInPage } from './AuthPages'
import { ErrorNotice, Notice } from '../ui/layout'
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
    <div className="ak-root min-h-dvh bg-canvas">
      <DemoBanner />
      <main className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col items-center justify-center px-4 py-10 sm:py-16">
        <FunguaLogo size={40} layout="stacked" />
        <div className="mt-8 w-full">
        {!valid ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-panel px-5 py-6 sm:px-8" aria-labelledby="join-title">
            <h1 id="join-title" className="font-display text-[22px] leading-tight font-semibold tracking-[-0.03em] text-ink">
              Invitation link incomplete
            </h1>
            <div className="mt-4">
              <Notice tone="warn">This invitation link is incomplete. Ask for a new one.</Notice>
            </div>
          </section>
        ) : preview.isPending ? (
          <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-panel px-5 py-6 sm:px-8" aria-busy>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-12 w-full" />
          </div>
        ) : preview.isError ? (
          <ErrorNotice error={preview.error} />
        ) : p && caps ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-panel px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="join-title">
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              <Users className="size-4" aria-hidden /> Staff invitation
            </p>
            <h1 id="join-title" className="mt-2 font-display text-[22px] leading-tight font-semibold tracking-[-0.03em] break-words text-ink">
              Join {p.orgName}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              As <strong className="font-semibold text-ink">{ROLE_PLAIN[p.role].title}</strong>: {ROLE_PLAIN[p.role].summary}
            </p>
            <p className="mt-1 text-xs break-words text-ink-3">
              Sent to {p.contactHint} · {p.status === 'pending' ? <>valid until {new Date(p.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</> : null}
            </p>
            {caps.can.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-1.5 text-xs text-ink-3">You will be able to</p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                  {caps.can.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
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
        </div>
        <Link to="/" className={buttonClass('ghost', 'sm', 'mt-4 h-10')}>
          Not now
        </Link>
      </main>
    </div>
  )
}
