import { useState } from 'react'
import { BellOff } from 'lucide-react'
import { CONSENT_SOURCE_LABEL } from '@/domain/marketing'
import type { Customer } from '@/gateway/types'
import type { OptOutHow } from '@/gateway/trust'
import { useAction, useOrg } from '../context'
import { ErrorNotice } from '../ui/layout'
import { When } from '../ui/format'
import { Badge, Button } from '../ui/primitives'

/**
 * Consent status with when and how it was recorded, and a way to record an
 * opt-out (e.g. the customer replied STOP). Turning consent back on needs the
 * customer's agreement and is done in Edit.
 */
export function MarketingConsentPanel({ customer }: { customer: Customer }) {
  const { can } = useOrg()
  const [confirming, setConfirming] = useState(false)
  const optOut = useAction((g, orgId, how: OptOutHow) => g.optOutCustomer(orgId, customer.id, how))
  const canWrite = can('customers.write')

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {customer.marketingConsent ? <Badge tone="pos">Agreed to offers</Badge> : <Badge>No offers</Badge>}
        {customer.consentUpdatedAt && (
          <span className="text-xs text-ink-3">
            since <When iso={customer.consentUpdatedAt} />
          </span>
        )}
      </div>
      <p className="text-ink-2">
        {customer.consentSource ? CONSENT_SOURCE_LABEL[customer.consentSource] : customer.marketingConsent ? 'How they agreed was not recorded.' : 'They have not agreed to offers.'}
      </p>
      <p className="text-xs leading-relaxed text-ink-3">
        {customer.marketingConsent
          ? 'You may send offers. Every offer must say “Reply STOP to opt out”, and you must stop when they ask.'
          : 'Don’t send offers to this customer. Messages about their own orders are fine.'}
      </p>

      {customer.marketingConsent && canWrite && !confirming && (
        <Button size="sm" icon={<BellOff className="size-4" aria-hidden />} onClick={() => setConfirming(true)} className="self-start">
          Record opt-out
        </Button>
      )}
      {customer.marketingConsent && canWrite && confirming && (
        <div className="flex flex-col gap-2 rounded-xl bg-sunken p-3" role="group" aria-label="Record opt-out">
          <p className="text-[13px] font-semibold text-ink">How did {customer.name.split(/\s+/)[0]} opt out?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={optOut.isPending} onClick={() => optOut.mutate('stop_reply', { onSuccess: () => setConfirming(false) })}>
              Replied STOP
            </Button>
            <Button size="sm" disabled={optOut.isPending} onClick={() => optOut.mutate('staff', { onSuccess: () => setConfirming(false) })}>
              Asked us another way
            </Button>
            <Button size="sm" variant="ghost" disabled={optOut.isPending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {optOut.isError && <ErrorNotice error={optOut.error} />}
    </div>
  )
}
