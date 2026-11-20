import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, ShieldCheck } from 'lucide-react'
import {
  canMarketTo,
  cooldownDaysLeft,
  customerStats,
  DEFAULT_TEMPLATE,
  marketingMessage,
  segmentCustomers,
  SEGMENT_TEXT,
  SEGMENTS,
  type SegmentId,
} from '@/domain/marketing'
import type { Customer } from '@/gateway/types'
import { whatsappChatLink } from '@/integrations/whatsapp-link'
import { useAction, useCustomers, useOrders, useOrg, useOrgQuery } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Button, PillTabs, Skeleton, Textarea, buttonClass } from '../ui/primitives'
import { WhatsAppGlyph } from '@/storefront/components/WhatsAppGlyph'

function BackLink() {
  return (
    <Link to="/app/customers" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden />
      Customers
    </Link>
  )
}

type RowState = { kind: 'ready'; link: string } | { kind: 'opened' }

export default function ReengagePage() {
  const { org, can } = useOrg()
  const customers = useCustomers()
  const orders = useOrders()
  const contacts = useOrgQuery('marketing-contacts', (g, o) => g.listMarketingContacts(o))
  const [segment, setSegment] = useState<SegmentId>('recent')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [rowError, setRowError] = useState<{ id: string; error: unknown } | null>(null)
  const start = useAction((g, orgId, input: { customer: Customer; segment: SegmentId }) => g.startMarketingChat(orgId, input.customer.id, input.segment))
  // Render-time clock for cooldown labels; refreshed whenever data reloads.
  const [nowMs] = useState(() => Date.now())

  const stats = useMemo(() => customerStats(orders.data ?? []), [orders.data])
  const results = useMemo(() => {
    const list = customers.data ?? []
    return Object.fromEntries(SEGMENTS.map((id) => [id, segmentCustomers(id, list, stats, { nowMs, baseCurrency: org.baseCurrency })])) as Record<
      SegmentId,
      ReturnType<typeof segmentCustomers<Customer>>
    >
  }, [customers.data, stats, nowMs, org.baseCurrency])
  const consenting = (customers.data ?? []).filter(canMarketTo).length

  const lastContact = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contacts.data ?? []) if (!m.has(c.customerId) || c.contactedAt > (m.get(c.customerId) ?? '')) m.set(c.customerId, c.contactedAt)
    return m
  }, [contacts.data])

  const current = results[segment]
  const templateOk = template.trim().length >= 10
  const preview = marketingMessage(template, current?.members[0]?.customer.name ?? 'Amina', org.name)

  function prepare(customer: Customer) {
    setRowError(null)
    start.mutate(
      { customer, segment },
      {
        onSuccess: ({ phoneE164 }) => {
          try {
            const link = whatsappChatLink(phoneE164, marketingMessage(template, customer.name, org.name))
            setRows((r) => ({ ...r, [customer.id]: { kind: 'ready', link } }))
          } catch (e) {
            setRowError({ id: customer.id, error: e })
          }
        },
        onError: (e) => setRowError({ id: customer.id, error: e }),
      },
    )
  }

  const loading = customers.isPending || orders.isPending

  return (
    <>
      <PageHeader
        title="Reach out"
        back={<BackLink />}
        description="Send an offer to customers who agreed to hear from you, one chat at a time from your own WhatsApp. Nothing is sent in bulk."
      />

      {!can('customers.write') ? (
        <Notice tone="warn">Your role can’t send offers. Ask an owner, admin, manager or sales member.</Notice>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-28" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : customers.isError || orders.isError ? (
        <ErrorNotice
          error={customers.error ?? orders.error}
          onRetry={() => {
            void customers.refetch()
            void orders.refetch()
          }}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
          <div className="min-w-0">
            <div className="mb-6 flex items-start gap-2.5 text-sm leading-relaxed text-ink-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <p>
                <span className="tnum font-semibold text-ink">{consenting}</span> of <span className="tnum">{customers.data.length}</span> customers agreed to
                offers. Only they can be picked. Others can still get messages about their own orders.
              </p>
            </div>

            <PillTabs
              label="Customer groups"
              value={segment}
              onChange={(id) => {
                setSegment(id)
                setRowError(null)
              }}
              tabs={SEGMENTS.map((id) => ({ id, label: SEGMENT_TEXT[id].label, count: results[id].members.length }))}
            />
            <p className="mt-3 mb-4 text-[13px] text-ink-2">
              <span className="text-ink-3">Why they are here: </span>
              {SEGMENT_TEXT[segment].rule}.
            </p>

            {current.excludedNoConsent > 0 && (
              <p className="mb-4 text-xs text-ink-3">
                {current.excludedNoConsent} {current.excludedNoConsent === 1 ? 'customer fits' : 'customers fit'} this group but did not agree to offers, so they
                are not listed.
              </p>
            )}

            {current.members.length === 0 ? (
              <EmptyState
                title="Nobody to message in this group"
                body="Customers appear here once they have ordered and agreed to offers, for example by ticking the box at checkout."
              />
            ) : (
              <ul className="-mx-4 divide-y divide-line border-y border-line px-4 sm:mx-0 sm:px-0" aria-label={`${SEGMENT_TEXT[segment].label}: customers who agreed to offers`}>
                {current.members.map(({ customer, stats: st }) => {
                  const last = lastContact.get(customer.id) ?? null
                  const wait = cooldownDaysLeft(last, nowMs)
                  const state = rows[customer.id]
                  const spent = st.spent.find((x) => x.currency === org.baseCurrency) ?? st.spent[0]
                  return (
                    <li key={customer.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <Link to={`/app/customers/${customer.id}`} className="block truncate text-[15px] font-medium text-ink hover:underline">
                          {customer.name}
                        </Link>
                        <p className="tnum mt-0.5 text-xs text-ink-3">
                          {st.orderCount} {st.orderCount === 1 ? 'order' : 'orders'}
                          {spent && (
                            <>
                              {' · '}
                              <Money minor={spent.totalMinor} currency={spent.currency} />
                            </>
                          )}
                          {st.lastOrderAt && (
                            <>
                              {' · last '}
                              <When iso={st.lastOrderAt} dateOnly />
                            </>
                          )}
                        </p>
                        {rowError?.id === customer.id && (
                          <p role="alert" className="mt-1 text-xs font-medium text-neg">
                            {rowError.error instanceof Error ? rowError.error.message : 'Could not open this chat.'}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {state?.kind === 'opened' ? (
                          <span className="inline-flex h-10 items-center gap-1.5 text-[13px] font-medium text-pos">
                            <CheckCircle2 className="size-4" aria-hidden /> Chat opened
                          </span>
                        ) : state?.kind === 'ready' ? (
                          <a
                            href={state.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            autoFocus
                            onClick={() => setRows((r) => ({ ...r, [customer.id]: { kind: 'opened' } }))}
                            className={buttonClass('primary', 'sm', 'h-10 max-w-full')}
                          >
                            <WhatsAppGlyph className="size-4" />
                            Open chat with {customer.name.split(/\s+/)[0]}
                            <span className="sr-only"> (opens WhatsApp in a new tab)</span>
                          </a>
                        ) : wait > 0 ? (
                          <span className="inline-flex min-h-10 items-center text-[13px] text-ink-3">
                            Offer sent recently · wait {wait} {wait === 1 ? 'day' : 'days'}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="h-10"
                            disabled={!templateOk || (start.isPending && start.variables?.customer.id === customer.id)}
                            loading={start.isPending && start.variables?.customer.id === customer.id}
                            onClick={() => prepare(customer)}
                          >
                            Prepare WhatsApp message
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="mt-8 min-w-0 lg:mt-0">
            <Section
              title="Your message"
              description="{name} becomes the customer’s first name, {shop} your business name."
              className="border-t border-line pt-5"
            >
              <label htmlFor="reengage-template" className="sr-only">
                Message template
              </label>
              <Textarea id="reengage-template" rows={5} maxLength={600} value={template} onChange={(e) => setTemplate(e.target.value)} />
              {!templateOk && <p className="mt-1 text-xs font-medium text-neg">Write at least a short sentence.</p>}
              <p className="mt-5 mb-1.5 text-[13px] font-semibold text-ink">What they will see</p>
              <p className="rounded-lg rounded-tl-sm border border-line bg-sunken px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
                {preview}
              </p>
              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
                <p>
                  Each button opens your own WhatsApp with this message filled in. Nothing is sent automatically: you read it and press send yourself.
                </p>
                <p>
                  “Reply STOP to opt out” is always added. When someone replies STOP, open their page and choose Record opt-out. Each customer can get one
                  offer a week.
                </p>
              </div>
            </Section>
          </div>
        </div>
      )}
    </>
  )
}
