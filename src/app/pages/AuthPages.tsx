import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { COUNTRY_PRESETS, isValidTimezone, listCurrencies, listTimezones } from '@/domain/locale'
import type { TaxMode } from '@/domain/orders'
import { useGateway } from '../context'
import { DemoBanner } from '../AppShell'
import { Button, Field, Input, Select } from '../ui/primitives'
import { ErrorNotice } from '../ui/layout'

function Frame({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="ak-root min-h-dvh">
      <DemoBanner />
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_420px] lg:items-center lg:py-16">
        <div className="max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-ink-3 uppercase">Akunga Commerce</p>
          <h1 className="mt-3 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[44px]">{title}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{lead}</p>
        </div>
        <div className="w-full">{children}</div>
      </div>
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
      title="Run every order from one calm place."
      lead="Catalogue, orders, stock, payments and delivery for merchants who sell through chat, social and in person — in any country and currency."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6 sm:p-8" noValidate>
        <h2 className="text-lg font-semibold">{mode === 'in' ? 'Sign in' : 'Create your account'}</h2>
        {demo && (
          <p className="text-sm text-ink-3">This is the demo workspace. Any email and password opens the fictional sample businesses.</p>
        )}
        {error != null && <ErrorNotice error={error} />}
        {info && <p className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">{info}</p>}
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
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!email || !password || (mode === 'up' && password.length < 8)}>
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
        <button type="button" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} className="text-sm text-ink-2 underline-offset-2 hover:underline">
          {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
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
  const [country, setCountry] = useState(COUNTRY_PRESETS[0].code as string)
  const [currency, setCurrency] = useState(COUNTRY_PRESETS[0].currency)
  const [timezone, setTimezone] = useState(isValidTimezone(browserTz) ? browserTz : COUNTRY_PRESETS[0].timezone)
  const [locale, setLocale] = useState(COUNTRY_PRESETS[0].locale)
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
      title="Set up your business."
      lead="Your country sets sensible defaults. Currency, time zone and number format can be anything — Akunga is not tied to one market. Base currency is fixed once you add products."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6 sm:p-8">
        {error != null && <ErrorNotice error={error} />}
        <Field label="Business name">
          {(p) => <Input {...p} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
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
        <div className="grid grid-cols-2 gap-3">
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
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!name.trim()}>
          Create business
        </Button>
      </form>
    </Frame>
  )
}
