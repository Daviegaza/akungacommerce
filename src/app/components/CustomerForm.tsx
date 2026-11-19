import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CountryCode } from 'libphonenumber-js/min'
import type { Customer, CustomerInput } from '@/gateway/types'
import { COUNTRY_PRESETS, formatPhone, toE164 } from '@/domain/locale'
import { useAction, useCustomers, useOrg } from '../context'
import { ErrorNotice, Sheet } from '../ui/layout'
import { Badge, Button, Field, Input, Select, Switch, Textarea } from '../ui/primitives'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OTHER = 'other'

function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const tag = part.trim()
    if (!tag) continue
    const k = tag.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(tag)
  }
  return out
}

function initialCountry(code: string | null): { choice: string; other: string } {
  if (!code) return { choice: '', other: '' }
  const upper = code.toUpperCase()
  if (COUNTRY_PRESETS.some((c) => c.code === upper)) return { choice: upper, other: '' }
  return { choice: OTHER, other: upper }
}

interface Errors {
  name?: string
  phone?: string
  email?: string
  country?: string
}

/**
 * Create / edit a customer in a sheet. Mount it only while open (the parent
 * renders it conditionally) so every opening starts from fresh state.
 */
export function CustomerFormSheet({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const { org } = useOrg()
  const customers = useCustomers()
  const formId = useId()
  const save = useAction((g, o, input: CustomerInput) => g.saveCustomer(o, input))

  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phoneE164 ? formatPhone(customer.phoneE164) : '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [country, setCountry] = useState(() => initialCountry(customer ? customer.countryCode : org.countryCode))
  const [consent, setConsent] = useState(customer?.marketingConsent ?? false)
  const [tags, setTags] = useState(customer?.tags.join(', ') ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [attempted, setAttempted] = useState(false)
  const [dupShownFor, setDupShownFor] = useState<string | null>(null)

  const region = org.countryCode.toUpperCase() as CountryCode
  const regionName = COUNTRY_PRESETS.find((c) => c.code === region)?.name ?? region
  const phoneResult = phone.trim() ? toE164(phone, region) : null
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : null
  const emailClean = email.trim()
  const emailValid = !emailClean || EMAIL_RE.test(emailClean)
  const countryCode = country.choice === OTHER ? country.other.trim().toUpperCase() : country.choice
  const parsedTags = parseTags(tags)

  const errors: Errors = {}
  if (attempted) {
    if (!name.trim()) errors.name = 'Enter the customer’s name'
    if (phoneResult && !phoneResult.ok) errors.phone = phoneResult.error
    if (!emailValid) errors.email = 'Enter a valid email address, e.g. name@example.com'
    if (country.choice === OTHER && !/^[A-Z]{2}$/.test(countryCode)) errors.country = 'Use the two-letter ISO code, e.g. TZ'
  }

  const mail = emailValid && emailClean ? emailClean.toLowerCase() : null
  const matches = (customers.data ?? []).filter(
    (c) =>
      c.id !== customer?.id &&
      ((phoneE164 != null && c.phoneE164 === phoneE164) || (mail != null && (c.email ?? '').toLowerCase() === mail)),
  )
  const matchKey = matches.map((m) => m.id).join(',')
  const showDuplicates = matches.length > 0 && dupShownFor === matchKey

  function submit(e: FormEvent) {
    e.preventDefault()
    setAttempted(true)
    const invalid =
      !name.trim() ||
      (phoneResult != null && !phoneResult.ok) ||
      !emailValid ||
      (country.choice === OTHER && !/^[A-Z]{2}$/.test(countryCode))
    if (invalid) return
    if (matches.length > 0 && dupShownFor !== matchKey) {
      setDupShownFor(matchKey)
      return
    }
    const input: CustomerInput = {
      id: customer?.id,
      name: name.trim(),
      phoneE164,
      email: emailClean || null,
      countryCode: countryCode || null,
      marketingConsent: consent,
      tags: parsedTags,
      notes: notes.trim() || null,
    }
    save.mutate(input, {
      onSuccess: (id) => {
        onSaved?.(id)
        onClose()
      },
    })
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={customer ? 'Edit customer' : 'Add customer'}
      description={customer ? customer.name : 'Phone numbers are stored in international format.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {showDuplicates ? 'Save anyway' : customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {save.isError && <ErrorNotice error={save.error} />}

        {showDuplicates && (
          <div role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            <p className="font-medium">
              {matches.length === 1 ? 'A customer with this phone or email already exists.' : `${matches.length} customers already use this phone or email.`}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link to={`/app/customers/${m.id}`} onClick={onClose} className="font-medium underline underline-offset-2">
                    {m.name}
                  </Link>
                  <span className="text-warn/80">
                    {' '}
                    · {[m.phoneE164 ? formatPhone(m.phoneE164) : null, m.email].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2">Open the existing record instead, or choose “Save anyway” to create a separate customer.</p>
          </div>
        )}

        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field
          label="Phone"
          optional
          error={errors.phone}
          hint={
            phoneE164 ? (
              <>
                Saved as <span className="tnum font-medium text-ink-2">{formatPhone(phoneE164)}</span>
              </>
            ) : (
              `Numbers without a country code are read as ${regionName}.`
            )
          }
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254 712 345 678"
              className="tnum"
            />
          )}
        </Field>

        <Field label="Email" optional error={errors.email}>
          {(p) => (
            <Input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Country" optional>
            {(p) => (
              <Select {...p} value={country.choice} onChange={(e) => setCountry((c) => ({ ...c, choice: e.target.value }))}>
                <option value="">Not set</option>
                {COUNTRY_PRESETS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
                <option value={OTHER}>Other…</option>
              </Select>
            )}
          </Field>
          {country.choice === OTHER && (
            <Field label="Country code" error={errors.country} hint="Two letters, e.g. TZ">
              {(p) => (
                <Input
                  {...p}
                  value={country.other}
                  maxLength={2}
                  autoCapitalize="characters"
                  onChange={(e) => setCountry((c) => ({ ...c, other: e.target.value.toUpperCase() }))}
                  className="uppercase"
                />
              )}
            </Field>
          )}
        </div>

        <div className="border-y border-line py-4">
          <Switch
            checked={consent}
            onChange={setConsent}
            label="Agreed to receive marketing"
            description="Only customers who agreed get promotions. Order confirmations and delivery updates are separate and don’t need this."
          />
        </div>

        <Field label="Tags" optional hint="Separate with commas, e.g. wholesale, VIP">
          {(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Field>
        {parsedTags.length > 0 && (
          <div className="-mt-3 flex flex-wrap gap-1.5" aria-label="Tags to save">
            {parsedTags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        )}

        <Field label="Notes" optional hint="Only your team sees notes.">
          {(p) => <Textarea {...p} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </Sheet>
  )
}
