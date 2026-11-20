import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import type { AssignVirtualAccountResult, VirtualAccountRecord } from '@/gateway/collections'
import type { OrderSummary } from '@/gateway/types'
import { useAction, useGateway, useOrders, useOrg, useOrgQuery } from '../context'
import { EmptyState, ErrorNotice, Section } from '../ui/layout'
import { Money, When } from '../ui/format'
import { Badge, Button, Input, Select, Skeleton } from '../ui/primitives'

const CLOSED = new Set(['draft', 'cancelled', 'refunded'])
const balanceOf = (o: OrderSummary) => o.totalMinor - o.netPaidMinor

/**
 * Nigeria bank transfer: dedicated account per order (Paystack DVA, adapter only).
 * Real mode never calls a provider, so "Get account number" answers honestly that it is
 * not connected. The demo simulates the account and a transfer into it.
 */
export function BankTransferAccounts() {
  const gateway = useGateway()
  const { can } = useOrg()
  const demo = gateway.mode === 'demo'
  const accounts = useOrgQuery('virtual-accounts', (g, o) => g.listVirtualAccounts(o))
  const orders = useOrders()
  const [orderId, setOrderId] = useState('')
  const [result, setResult] = useState<AssignVirtualAccountResult | null>(null)
  const assign = useAction((g, org, id: string) => g.assignVirtualAccount(org, id))
  const selectId = useId()
  const allowed = can('payments.record')

  const active = useMemo(() => (accounts.data ?? []).filter((a) => a.status === 'active'), [accounts.data])
  const open = useMemo(
    () =>
      (orders.data ?? [])
        .filter((o) => o.currency === 'NGN' && !CLOSED.has(o.status) && balanceOf(o) > 0 && !active.some((a) => a.orderId === o.id))
        .sort((a, b) => b.number - a.number)
        .slice(0, 50),
    [orders.data, active],
  )
  const chosen = open.some((o) => o.id === orderId) ? orderId : (open[0]?.id ?? '')

  return (
    <Section
      title="Bank transfers (Nigeria)"
      description="Buyers who pick bank transfer pay into an account number made for their order. A transfer is matched automatically only when it is exactly the amount due."
      icon={<Landmark className="size-[18px]" aria-hidden />}
      className="border-t border-line pt-6"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-2">Paystack dedicated accounts:</span>
          {demo ? <Badge tone="info">Simulated in the demo</Badge> : <Badge tone="neutral">Adapter only</Badge>}
        </div>
        {!demo && (
          <p className="max-w-2xl text-sm text-ink-3">
            Transfer matching is built and tested, but no account numbers can be issued until Paystack dedicated accounts are connected and pass a
            real test. Until then buyers are told you will share your bank details.
          </p>
        )}

        {allowed && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1 sm:max-w-sm">
              <label htmlFor={selectId} className="text-[13px] font-medium text-ink-2">
                Order that needs an account number
              </label>
              <Select id={selectId} value={chosen} onChange={(e) => setOrderId(e.target.value)} disabled={open.length === 0}>
                {open.length === 0 && <option value="">No unpaid NGN order without an account</option>}
                {open.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.number} · {o.customerName ?? 'Walk-in'} · due {(balanceOf(o) / 100).toLocaleString()} NGN
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="md"
              variant="primary"
              disabled={!chosen}
              loading={assign.isPending}
              onClick={() => assign.mutate(chosen, { onSuccess: (r) => setResult(r) })}
            >
              Get account number
            </Button>
          </div>
        )}
        {assign.isError && <ErrorNotice error={assign.error} />}
        {result?.status === 'not_configured' && (
          <p className="max-w-2xl rounded-lg border border-warn/25 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-ink-2" role="status">
            {result.reason}
          </p>
        )}
        {result?.status === 'assigned' && (
          <p className="max-w-2xl rounded-lg border border-pos/25 bg-pos-soft px-4 py-3 text-sm leading-relaxed text-ink" role="status">
            Order #{result.account.orderNumber} now shows {result.account.bankName}, account{' '}
            <span className="font-mono">{result.account.accountNumber}</span> on its tracking page.
          </p>
        )}

        {accounts.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : accounts.isError ? (
          <ErrorNotice error={accounts.error} onRetry={() => void accounts.refetch()} />
        ) : active.length === 0 ? (
          <EmptyState title="No account numbers yet" body="Accounts issued for orders appear here, with the order they belong to." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {active.map((a) => (
              <AccountRow key={a.id} a={a} />
            ))}
          </ul>
        )}

        {demo && gateway.simulateBankTransfer && active.length > 0 && <SimulateTransfer accounts={active} orders={orders.data ?? []} />}
      </div>
    </Section>
  )
}

function AccountRow({ a }: { a: VirtualAccountRecord }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {a.orderId ? (
            <Link to={`/app/orders/${a.orderId}`} className="tnum font-medium text-ink hover:underline">
              {a.orderNumber != null ? `#${a.orderNumber}` : 'Order'}
            </Link>
          ) : (
            <span className="text-ink-2">Customer account</span>
          )}
          <span className="font-mono text-ink">{a.accountNumber}</span>
          <span className="text-ink-2">{a.bankName}</span>
          {a.simulated && <Badge tone="info">Simulated</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          Issued <When iso={a.createdAt} />
          {a.accountName && <> · {a.accountName}</>}
        </p>
      </div>
    </li>
  )
}

function SimulateTransfer({ accounts, orders }: { accounts: VirtualAccountRecord[]; orders: OrderSummary[] }) {
  const [accountNumber, setAccountNumber] = useState(accounts[0].accountNumber)
  const account = accounts.find((a) => a.accountNumber === accountNumber) ?? accounts[0]
  const order = orders.find((o) => o.id === account.orderId)
  const [amount, setAmount] = useState('')
  const sim = useAction((g, org, input: { accountNumber: string; amountMinor: number }) => g.simulateBankTransfer!(org, input))
  const fallback = order ? String(balanceOf(order) / 100) : ''
  const amountMinor = Math.round(Number(amount || fallback) * 100)
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line-strong p-3"
      onSubmit={(e) => {
        e.preventDefault()
        sim.mutate({ accountNumber: account.accountNumber, amountMinor })
      }}
    >
      <p className="w-full text-xs leading-relaxed text-ink-2">
        <Badge tone="info" className="mr-1.5">
          Demo
        </Badge>
        Pretend the buyer transferred money into this account (simulated, no money moves). Real Paystack amounts arrive in kobo, which is not yet
        confirmed in a sandbox test.
      </p>
      <Select aria-label="Dedicated account" value={account.accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-56 max-w-full">
        {accounts.map((a) => (
          <option key={a.id} value={a.accountNumber}>
            {a.accountNumber}
            {a.orderNumber != null ? ` · #${a.orderNumber}` : ''}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Amount in NGN"
        inputMode="decimal"
        value={amount}
        placeholder={fallback || 'Amount'}
        onChange={(e) => setAmount(e.target.value)}
        className="w-32 tnum"
      />
      <Button type="submit" size="md" loading={sim.isPending} disabled={!(amountMinor > 0)}>
        Simulate transfer
      </Button>
      {order && (
        <p className="w-full text-xs text-ink-2">
          Order #{order.number} is due <Money minor={balanceOf(order)} currency="NGN" />. A different amount goes to the queue below.
        </p>
      )}
      {sim.isError && <ErrorNotice error={sim.error} />}
    </form>
  )
}
