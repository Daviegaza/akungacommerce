import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { DOCUMENT_KIND_LABEL, REPORT_REASON_LABEL } from '@/domain/trust'
import type { VerificationQueueItem } from '@/gateway/trust'
import { useGateway } from '../context'
import { EmptyState, ErrorNotice, Notice, PageHeader, Section } from '../ui/layout'
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
          <Link to="/app/trust" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> Trust and verification
          </Link>
        }
        description="For Fungua staff only. Approve business documents and handle reports from buyers."
      />
      {admin.isPending ? (
        <Skeleton className="h-32" />
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

function DocumentQueue() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const queue = useQuery({ queryKey: ['platform', 'verification-queue'], queryFn: () => gateway.listVerificationQueue() })
  return (
    <Section title="Business documents" description="Oldest first.">
      {queue.isPending ? (
        <Skeleton className="h-24" />
      ) : queue.isError ? (
        <ErrorNotice error={queue.error} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing is waiting for review.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {queue.data.map((item) => (
            <QueueRow key={item.orgId} item={item} onDone={() => void qc.invalidateQueries()} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function QueueRow({ item, onDone }: { item: VerificationQueueItem; onDone: () => void }) {
  const gateway = useGateway()
  const [reason, setReason] = useState('')
  const [openError, setOpenError] = useState<unknown>(null)
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => gateway.reviewVerificationDocuments(item.orgId, decision, decision === 'rejected' ? reason : null),
    onSuccess: onDone,
  })

  async function view(path: string) {
    setOpenError(null)
    try {
      const url = await gateway.verificationFileUrl(path)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setOpenError(e)
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink">
          {item.businessName}
          {item.slug && <span className="ml-2 text-xs text-ink-3">/s/{item.slug}</span>}
        </p>
        <p className="text-xs text-ink-3">{item.submittedAt && <When iso={item.submittedAt} />}</p>
      </div>
      <p className="text-sm text-ink-2">{item.kind ? DOCUMENT_KIND_LABEL[item.kind] : 'Document'}</p>
      <ul className="flex flex-wrap gap-2">
        {item.files.map((f) => (
          <li key={f.path}>
            {gateway.mode === 'demo' ? (
              <Badge>{f.name}</Badge>
            ) : (
              <Button size="sm" icon={<ExternalLink className="size-3.5" aria-hidden />} onClick={() => void view(f.path)}>
                {f.name}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {openError != null && <ErrorNotice error={openError} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={review.isPending && review.variables === 'approved'} onClick={() => review.mutate('approved')}>
          Approve
        </Button>
        <label className="sr-only" htmlFor={`reason-${item.orgId}`}>
          Reason for rejecting
        </label>
        <Input
          id={`reason-${item.orgId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Reason, if rejecting"
          className="h-9 w-56 max-w-full text-[13px]"
        />
        <Button size="sm" disabled={reason.trim().length === 0} loading={review.isPending && review.variables === 'rejected'} onClick={() => review.mutate('rejected')}>
          Reject
        </Button>
      </div>
      {review.isError && <ErrorNotice error={review.error} />}
    </li>
  )
}

function Reports() {
  const gateway = useGateway()
  const qc = useQueryClient()
  const reports = useQuery({ queryKey: ['platform', 'reports'], queryFn: () => gateway.listShopReports() })
  const resolve = useMutation({
    mutationFn: (input: { id: string; status: 'reviewed' | 'dismissed' }) => gateway.resolveShopReport(input.id, input.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'reports'] }),
  })
  return (
    <Section title="Reports from buyers" description="Anonymous. The shop is not told about a report.">
      {reports.isPending ? (
        <Skeleton className="h-24" />
      ) : reports.isError ? (
        <ErrorNotice error={reports.error} onRetry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <p className="text-sm text-ink-3">No reports.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {reports.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">{r.businessName}</p>
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  <When iso={r.createdAt} />
                  <Badge tone={r.status === 'open' ? 'warn' : 'neutral'}>{r.status === 'open' ? 'Open' : r.status === 'reviewed' ? 'Reviewed' : 'Dismissed'}</Badge>
                </span>
              </div>
              <p className="text-sm text-ink-2">{REPORT_REASON_LABEL[r.reason]}</p>
              {r.details && <p className="text-sm whitespace-pre-wrap text-ink-3">{r.details}</p>}
              {r.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'reviewed' })}>
                    Mark reviewed
                  </Button>
                  <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {resolve.isError && <ErrorNotice error={resolve.error} />}
    </Section>
  )
}
