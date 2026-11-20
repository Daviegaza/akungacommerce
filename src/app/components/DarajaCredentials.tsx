import { useState, type FormEvent } from 'react'
import type { MpesaCredentialsInput, MpesaCredentialsSummary } from '@/gateway/collections'
import { useAction, useGateway, useOrg, useOrgQuery } from '../context'
import { ErrorNotice } from '../ui/layout'
import { When } from '../ui/format'
import { Button, Field, Input, Select, Skeleton } from '../ui/primitives'

type Configured = Extract<MpesaCredentialsSummary, { configured: true }>

const TYPE_TEXT = {
  CustomerPayBillOnline: 'Paybill',
  CustomerBuyGoodsOnline: 'Buy Goods (Till)',
} as const

function blankFrom(c: Configured | null): MpesaCredentialsInput {
  return {
    environment: c?.environment ?? 'sandbox',
    shortcode: c?.shortcode ?? '',
    transactionType: c?.transactionType ?? 'CustomerBuyGoodsOnline',
    partyB: c?.partyB ?? '',
    consumerKey: '',
    consumerSecret: '',
    passkey: '',
  }
}

function CredentialsForm({ current, onDone }: { current: Configured | null; onDone: () => void }) {
  const [draft, setDraft] = useState<MpesaCredentialsInput>(() => blankFrom(current))
  const save = useAction((g, orgId, input: MpesaCredentialsInput) => g.saveMpesaCredentials(orgId, input))
  const set = <K extends keyof MpesaCredentialsInput>(k: K, v: MpesaCredentialsInput[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const keep = current ? 'Leave blank to keep the saved value' : undefined
  const till = draft.transactionType === 'CustomerBuyGoodsOnline'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ ...draft, partyB: till ? draft.partyB?.trim() || null : null }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account type">
          {(p) => (
            <Select {...p} value={draft.transactionType} onChange={(e) => set('transactionType', e.target.value as MpesaCredentialsInput['transactionType'])}>
              <option value="CustomerBuyGoodsOnline">{TYPE_TEXT.CustomerBuyGoodsOnline}</option>
              <option value="CustomerPayBillOnline">{TYPE_TEXT.CustomerPayBillOnline}</option>
            </Select>
          )}
        </Field>
        <Field label="Environment" hint="Use sandbox until Safaricom approves your app for production.">
          {(p) => (
            <Select {...p} value={draft.environment} onChange={(e) => set('environment', e.target.value as MpesaCredentialsInput['environment'])}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (real money)</option>
            </Select>
          )}
        </Field>
        <Field label={till ? 'Store number (shortcode)' : 'Paybill number'} hint={till ? 'The head office / store number from Daraja, not always the till.' : undefined}>
          {(p) => <Input {...p} inputMode="numeric" value={draft.shortcode} onChange={(e) => set('shortcode', e.target.value)} required />}
        </Field>
        {till && (
          <Field label="Till number" optional hint="Only if it differs from the store number.">
            {(p) => <Input {...p} inputMode="numeric" value={draft.partyB ?? ''} onChange={(e) => set('partyB', e.target.value)} />}
          </Field>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Consumer key" hint={keep ?? (current ? undefined : 'From your app on developer.safaricom.co.ke')}>
          {(p) => <Input {...p} value={draft.consumerKey} onChange={(e) => set('consumerKey', e.target.value)} placeholder={current ? `Saved ${current.keyHint}` : ''} spellCheck={false} />}
        </Field>
        <Field label="Consumer secret" hint={keep}>
          {(p) => <Input {...p} type="password" value={draft.consumerSecret} onChange={(e) => set('consumerSecret', e.target.value)} placeholder={current ? 'Saved' : ''} autoComplete="new-password" />}
        </Field>
        <Field label="Passkey" hint={keep ?? 'Safaricom emails this when your shortcode goes live.'} className="sm:col-span-2">
          {(p) => <Input {...p} type="password" value={draft.passkey} onChange={(e) => set('passkey', e.target.value)} placeholder={current ? 'Saved' : ''} autoComplete="new-password" />}
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">
        Stored encrypted on the server. Nobody on your team, including you, can read them back. Saving marks the connection
        unverified until a real test payment arrives.
      </p>
      {save.isError && <ErrorNotice error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" loading={save.isPending}>
          Save M-Pesa keys
        </Button>
        {current && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

/** The shop's own Daraja credentials, shown under "How you get paid" when Daraja is chosen. */
export function DarajaCredentials({ verified }: { verified: boolean }) {
  const { can } = useOrg()
  const gateway = useGateway()
  const creds = useOrgQuery('mpesa-credentials', (g, o) => g.getMpesaCredentials(o))
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const clear = useAction((g, orgId) => g.clearMpesaCredentials(orgId))
  const verify = useAction((g, orgId) => g.markMpesaVerified(orgId))
  const allowed = can('integrations.manage')

  if (creds.isPending) return <Skeleton className="h-16 w-full max-w-xl" />
  if (creds.isError) return <ErrorNotice error={creds.error} onRetry={() => void creds.refetch()} />
  const c = creds.data.configured ? creds.data : null

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Your M-Pesa keys</h3>
        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-3">
          Customers pay straight into your own Till or Paybill. Rafu never holds the money.
          {gateway.mode === 'demo' && ' Demo: only the summary is kept in this browser; nothing is sent anywhere.'}
        </p>
      </div>

      {!allowed ? (
        <p className="text-sm text-ink-2">
          {c ? `${TYPE_TEXT[c.transactionType]} ${c.shortcode} (${c.environment}) is saved.` : 'No keys saved yet.'} Only an owner or admin can change this.
        </p>
      ) : editing || !c ? (
        <CredentialsForm current={c} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-3">Account</dt>
            <dd className="text-ink">
              {TYPE_TEXT[c.transactionType]} {c.shortcode}
              {c.partyB && <span className="text-ink-2"> · till {c.partyB}</span>}
            </dd>
            <dt className="text-ink-3">Environment</dt>
            <dd className="text-ink">{c.environment === 'production' ? 'Production' : 'Sandbox'}</dd>
            <dt className="text-ink-3">Consumer key</dt>
            <dd className="font-mono text-ink">{c.keyHint}</dd>
            <dt className="text-ink-3">Saved</dt>
            <dd className="text-ink-2">
              <When iso={c.updatedAt} />
            </dd>
          </dl>
          {!verified && (
            <p className="max-w-xl text-sm text-ink-2">
              Next: send a small test payment to this account from a Rafu order. Once it shows up under M-Pesa reconciliation,
              confirm below and payment prompts switch on.
            </p>
          )}
          {(verify.isError || clear.isError) && <ErrorNotice error={verify.error ?? clear.error} />}
          <div className="flex flex-wrap gap-2">
            {!verified && (
              <Button size="sm" variant="primary" loading={verify.isPending} onClick={() => verify.mutate(undefined)}>
                Test payment arrived, switch on prompts
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Change keys
            </Button>
            {confirmRemove ? (
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                Remove the keys? Prompts stop at once.
                <Button size="sm" variant="danger" loading={clear.isPending} onClick={() => clear.mutate(undefined, { onSettled: () => setConfirmRemove(false) })}>
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                Remove keys
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
