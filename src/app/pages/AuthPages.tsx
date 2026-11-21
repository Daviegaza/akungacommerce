import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { COUNTRY_PRESETS, isValidTimezone, listCurrencies, listTimezones } from '@/domain/locale'
import { presetForBrowser } from '../onboarding-defaults'
import type { TaxMode } from '@/domain/orders'
import { useGateway } from '../context'
import { DemoBanner } from '../AppShell'
import { Button, Field, Input, Select } from '../ui/primitives'
import { ErrorNotice } from '../ui/layout'
import { BRAND } from '@/brand/brand'
import { FunguaLogo } from '@/brand/FunguaLogo'

/** Centred auth frame: stacked logo, one hairline panel, a quiet line underneath. */
function Frame({ title, lead, footer, wide, children }: { title: string; lead?: string; footer?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="ak-root min-h-dvh bg-canvas">
      <DemoBanner />
      <main className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full flex-col items-center justify-center px-4 py-10 sm:py-16">
        <FunguaLogo size={40} layout="stacked" />
        <div className={`mt-8 w-full ${wide ? 'max-w-[480px]' : 'max-w-[400px]'}`}>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel px-5 py-6 sm:px-8 sm:py-8">
            <h1 className="font-display text-[22px] leading-tight font-semibold tracking-[-0.03em] text-ink">{title}</h1>
            {lead && <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{lead}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-ink-2">{footer}</div>}
        </div>
      </main>
    </div>
  )
}

export function SignInPage() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'in') {
        await gateway.signIn(email.trim(), password)
      } else {
        const r = await gateway.signUp(email.trim(), password)
        if (r.needsEmailConfirmation) {
          setInfo('Check your inbox to confirm your email, then sign in.')
          setMode('in')
          return
        }
      }
      await qc.invalidateQueries({ queryKey: ['session'] })
      await qc.invalidateQueries({ queryKey: ['orgs'] })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const demo = gateway.mode === 'demo'
  return (
    <Frame
      title={mode === 'in' ? 'Sign in' : 'Create your account'}
      lead={
        mode === 'in'
          ? `Orders, stock, payments and delivery in one calm place — in any country and currency.`
          : `Start with your email. You set up your business, currency and time zone next.`
      }
      footer={
        <button type="button" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} className="inline-flex min-h-10 items-center font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {demo && (
          <p className="rounded-lg border border-line bg-sunken/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            This is the demo workspace. Any email and password opens the fictional sample businesses.
          </p>
        )}
        {error != null && <ErrorNotice error={error} />}
        {info && (
          <p role="status" className="rounded-lg border border-info/25 bg-info-soft px-3.5 py-2.5 text-sm text-ink">
            {info}
          </p>
        )}
        <Field label="Email">
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" hint={mode === 'up' ? 'At least 8 characters.' : undefined}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              minLength={mode === 'up' ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={busy} disabled={!email || !password || (mode === 'up' && password.length < 8)}>
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </Frame>
  )
}

export function OnboardingPage() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const currencies = useMemo(() => listCurrencies(), [])
  const timezones = useMemo(() => listTimezones(), [])
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [name, setName] = useState('')
  const [start] = useState(() => presetForBrowser(typeof navigator === 'undefined' ? undefined : navigator.language, browserTz))
  const [country, setCountry] = useState(start.code as string)
  const [currency, setCurrency] = useState(start.currency)
  const [timezone, setTimezone] = useState(isValidTimezone(browserTz) ? browserTz : start.timezone)
  const [locale, setLocale] = useState(start.locale)
  const [businessType, setBusinessType] = useState('')
  const [taxMode, setTaxMode] = useState<TaxMode>('exclusive')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function applyPreset(code: string) {
    setCountry(code)
    const p = COUNTRY_PRESETS.find((c) => c.code === code)
    if (p) {
      setCurrency(p.currency)
      setTimezone(p.timezone)
      setLocale(p.locale)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await gateway.createOrganisation({
        name: name.trim(),
        countryCode: country.toUpperCase(),
        timezone,
        locale,
        baseCurrency: currency,
        businessType: businessType.trim() || null,
        taxMode,
      })
      await qc.invalidateQueries({ queryKey: ['orgs'] })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      wide
      title="Set up your business"
      lead={`Your country sets sensible defaults. Currency, time zone and number format can be anything — ${BRAND.name} is not tied to one market. Base currency is fixed once you add products.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error != null && <ErrorNotice error={error} />}
        <Field label="Business name">
          {(p) => <Input {...p} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
          <legend className="float-left w-full text-[13px] text-ink-3">Where you trade</legend>
          <Field label="Country" hint="Pick yours, or any listed preset and adjust below.">
            {(p) => (
              <Select {...p} value={country} onChange={(e) => applyPreset(e.target.value)}>
                {COUNTRY_PRESETS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <Field label="Base currency">
              {(p) => (
                <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Number format">
              {(p) => <Input {...p} value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-GB" />}
            </Field>
          </div>
          <Field label="Time zone" hint="Reports and dates use this zone. Times are stored in UTC.">
            {(p) => (
              <Select {...p} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezones.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
          <legend className="float-left w-full text-[13px] text-ink-3">How you sell</legend>
          <Field label="Prices" hint="Tax rates are stored as metadata only. Confirm rules with a qualified adviser.">
            {(p) => (
              <Select {...p} value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)}>
                <option value="exclusive">Tax added on top of prices</option>
                <option value="inclusive">Prices already include tax</option>
              </Select>
            )}
          </Field>
          <Field label="What do you sell?" optional>
            {(p) => <Input {...p} value={businessType} maxLength={60} onChange={(e) => setBusinessType(e.target.value)} placeholder="Fashion, food, beauty…" />}
          </Field>
        </fieldset>
        <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={busy} disabled={!name.trim()}>
          Create business
        </Button>
      </form>
    </Frame>
  )
}
