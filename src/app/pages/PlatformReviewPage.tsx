import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { DOCUMENT_KIND_LABEL, REPORT_REASON_LABEL } from '@/domain/trust'
import type { VerificationQueueItem } from '@/gateway/trust'
import { useGateway } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Table, Td, Th } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button, Input, Skeleton } from '../ui/primitives'

/**
 * Minimal Fungua reviewer page: business documents waiting for review and
 * buyer reports. Every action is checked again on the server (platform_admins).
 */
export default function PlatformReviewPage() {
  const gateway = useGateway()
  const admin = useQuery({ queryKey: ['platform-admin'], queryFn: () => gateway.isPlatformAdmin(), staleTime: 300_000 })

  return (
    <>
      <PageHeader
        title="Reviewer queue"
        back={
          <Link to="/app/trust" className="inline-flex min-h-8 items-center gap-1 text-sm text-ink-3 hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> Trust and verification
          </Link>
        }
        description="For Fungua staff only. Approve business documents and handle reports from buyers."
      />
      {admin.isPending ? (
        <QueueSkeleton />
      ) : !admin.data ? (
        <EmptyState title="Reviewers only" body="This page is for Fungua staff who review businesses." />
      ) : (
        <>
          {gateway.mode === 'demo' && (
            <div className="mb-6">
              <Notice>Demo workspace: you act as the Fungua reviewer, and document files are not stored (only their names).</Notice>
            </div>
          )}
          <DocumentQueue />
          <Reports />
        </>
      )}
    </>
  )
}

function QueueSection({ id, title, description, count, children }: { id: string; title: string; description: string; count?: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 id={id} className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h2>
        {count != null && <span className="tnum text-[13px] text-ink-3">{count}</span>}
      </div>
      <p className="-mt-3 mb-4 text-[13px] text-ink-3">{description}</p>
      {children}
    </section>
  )
}

function QueueSkeleton() {
  return (
    <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-9 w-40" />
        </div>
      ))}
    </div>
  )
}

/* ───────────── Business documents ───────────── */

function DocumentQueue() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const queue = useQuery({ queryKey: ['platform', 'verification-queue'], queryFn: () => gateway.listVerificationQueue() })
  // Shared by the table (md+) and the stacked list (phones) so a typed reason survives a resize.
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const setReason = (orgId: string, v: string) => setReasons((r) => ({ ...r, [orgId]: v }))
  const onDone = () => void qc.invalidateQueries()

  return (
    <QueueSection id="docs-h" title="Business documents" description="Oldest first." count={queue.data?.length}>
      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <ErrorNotice error={queue.error} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <p className="border-y border-line py-4 text-sm text-ink-3">Nothing is waiting for review.</p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">Business documents waiting for review</caption>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th>Document</Th>
                  <Th>Submitted</Th>
                  <Th align="right">Decision</Th>
                </tr>
              </thead>
              <tbody>
                {queue.data.map((item) => (
                  <QueueRow key={item.orgId} item={item} layout="row" reason={reasons[item.orgId] ?? ''} onReason={(v) => setReason(item.orgId, v)} onDone={onDone} />
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line md:hidden">
            {queue.data.map((item) => (
              <QueueRow key={item.orgId} item={item} layout="item" reason={reasons[item.orgId] ?? ''} onReason={(v) => setReason(item.orgId, v)} onDone={onDone} />
            ))}
          </ul>
        </>
      )}
    </QueueSection>
  )
}

function QueueRow({
  item,
  layout,
  reason,
  onReason,
  onDone,
}: {
  item: VerificationQueueItem
  layout: 'row' | 'item'
  reason: string
  onReason: (v: string) => void
  onDone: () => void
}) {
  const gateway = useGateway()
  const [openError, setOpenError] = useState<unknown>(null)
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => gateway.reviewVerificationDocuments(item.orgId, decision, decision === 'rejected' ? reason : null),
    onSuccess: onDone,
  })
  const reasonId = `reason-${layout}-${item.orgId}`

  async function view(path: string) {
    setOpenError(null)
    try {
      const url = await gateway.verificationFileUrl(path)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setOpenError(e)
    }
  }

  const business = (
    <>
      <p className="truncate font-medium text-ink">{item.businessName}</p>
      {item.slug && <p className="truncate font-mono text-xs text-ink-3">/s/{item.slug}</p>}
    </>
  )

  const docCell = (
    <>
      <p className="text-sm text-ink-2">{item.kind ? DOCUMENT_KIND_LABEL[item.kind] : 'Document'}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {item.files.map((f) => (
          <li key={f.path} className="max-w-full">
            {gateway.mode === 'demo' ? (
              <Badge className="max-w-full truncate">{f.name}</Badge>
            ) : (
              <Button size="sm" variant="secondary" className="h-8 max-w-full px-2.5 text-xs" icon={<ExternalLink className="size-3.5" aria-hidden />} onClick={() => void view(f.path)}>
                <span className="truncate">{f.name}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  )

  const decision = (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      <label className="sr-only" htmlFor={reasonId}>
        Reason for rejecting
      </label>
      <Input
        id={reasonId}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        maxLength={500}
        placeholder="Reason, if rejecting"
        className="h-10 w-full text-[13px] md:w-52"
      />
      <Button size="sm" variant="secondary" className="h-10" disabled={reason.trim().length === 0} loading={review.isPending && review.variables === 'rejected'} onClick={() => review.mutate('rejected')}>
        Reject
      </Button>
      <Button variant="primary" size="sm" className="h-10" loading={review.isPending && review.variables === 'approved'} onClick={() => review.mutate('approved')}>
        Approve
      </Button>
    </div>
  )

  const errors = (openError != null || review.isError) && (
    <div className="mt-2 flex flex-col gap-2 text-left whitespace-normal">
      {openError != null && <ErrorNotice error={openError} />}
      {review.isError && <ErrorNotice error={review.error} />}
    </div>
  )

  if (layout === 'row') {
    return (
      <tr className="align-top">
        <Td className="max-w-[220px] align-top">{business}</Td>
        <Td className="max-w-[280px] align-top">{docCell}</Td>
        <Td className="tnum align-top text-[13px] whitespace-nowrap text-ink-2">{item.submittedAt ? <When iso={item.submittedAt} /> : '—'}</Td>
        <Td className="align-top">
          {decision}
          {errors}
        </Td>
      </tr>
    )
  }

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{business}</div>
        <p className="tnum shrink-0 text-xs text-ink-3">{item.submittedAt && <When iso={item.submittedAt} />}</p>
      </div>
      <div>{docCell}</div>
      {decision}
      {errors}
    </li>
  )
}

/* ───────────── Buyer reports ───────────── */

const REPORT_STATUS: Record<'open' | 'reviewed' | 'dismissed', { label: string; tone: 'warn' | 'neutral' }> = {
  open: { label: 'Open', tone: 'warn' },
  reviewed: { label: 'Reviewed', tone: 'neutral' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
}

function Reports() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const reports = useQuery({ queryKey: ['platform', 'reports'], queryFn: () => gateway.listShopReports() })
  const resolve = useMutation({
    mutationFn: (input: { id: string; status: 'reviewed' | 'dismissed' }) => gateway.resolveShopReport(input.id, input.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'reports'] }),
  })
  const openCount = reports.data?.filter((r) => r.status === 'open').length

  return (
    <QueueSection id="reports-h" title="Reports from buyers" description="Anonymous. The shop is not told about a report." count={openCount}>
      {reports.isPending ? (
        <QueueSkeleton />
      ) : reports.isError ? (
        <ErrorNotice error={reports.error} onRetry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <p className="border-y border-line py-4 text-sm text-ink-3">No reports.</p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">Reports from buyers</caption>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th>Reason</Th>
                  <Th>Received</Th>
                  <Th>Status</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {reports.data.map((r) => {
                  const s = REPORT_STATUS[r.status]
                  return (
                    <tr key={r.id} className="align-top">
                      <Td className="max-w-[200px] align-top">
                        <p className="truncate font-medium text-ink">{r.businessName}</p>
                      </Td>
                      <Td className="max-w-[360px] align-top">
                        <p className="text-ink-2">{REPORT_REASON_LABEL[r.reason]}</p>
                        {r.details && <p className="mt-0.5 text-[13px] break-words whitespace-pre-wrap text-ink-3">{r.details}</p>}
                      </Td>
                      <Td className="tnum align-top text-[13px] whitespace-nowrap text-ink-2">
                        <When iso={r.createdAt} />
                      </Td>
                      <Td className="align-top">
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </Td>
                      <Td className="align-top whitespace-nowrap">
                        {r.status === 'open' && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" className="h-10" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'reviewed' })}>
                              Mark reviewed
                            </Button>
                            <Button size="sm" variant="ghost" className="h-10" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-line border-y border-line md:hidden">
            {reports.data.map((r) => {
              const s = REPORT_STATUS[r.status]
              return (
                <li key={r.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-medium text-ink">{r.businessName}</p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <p className="text-sm text-ink-2">{REPORT_REASON_LABEL[r.reason]}</p>
                  {r.details && <p className="text-sm break-words whitespace-pre-wrap text-ink-3">{r.details}</p>}
                  <p className="tnum text-xs text-ink-3">
                    <When iso={r.createdAt} />
                  </p>
                  {r.status === 'open' && (
                    <div className="mt-1 flex gap-2">
                      <Button size="sm" variant="secondary" className="h-10" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'reviewed' })}>
                        Mark reviewed
                      </Button>
                      <Button size="sm" variant="ghost" className="h-10" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {resolve.isError && (
        <div className="mt-3">
          <ErrorNotice error={resolve.error} />
        </div>
      )}
    </QueueSection>
  )
}
