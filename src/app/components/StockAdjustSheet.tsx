import { useId, useState, type FormEvent } from 'react'
import type { StockAdjustmentInput } from '@/gateway/types'
import { newIdempotencyKey } from '@/gateway/gateway'
import { ADJUSTMENT_REASONS, ADJUSTMENT_REASON_LABEL, type AdjustmentReason } from '@/domain/inventory'
import { useAction } from '../context'
import { ErrorNotice, Sheet } from '../ui/layout'
import { Button, Field, Input, Select, Textarea } from '../ui/primitives'
import { cn } from '@/lib/utils'

export interface StockTarget {
  variantId: string
  productName: string
  variantName: string
  sku: string | null
  onHand: number
  reserved: number
}

type Direction = 'add' | 'remove'

const ADD_FIRST: AdjustmentReason[] = ['received_from_supplier', 'stock_count', 'correction']
const REMOVE_FIRST: AdjustmentReason[] = ['damaged', 'lost_or_stolen', 'expired', 'returned_to_supplier', 'stock_count', 'correction']

function reasonsFor(direction: Direction): AdjustmentReason[] {
  const first = direction === 'add' ? ADD_FIRST : REMOVE_FIRST
  return [...first, ...ADJUSTMENT_REASONS.filter((r) => !first.includes(r))]
}

/**
 * Manual stock adjustment. Mount only while open: the idempotency key is
 * created once per opening, so a double-submit or retry cannot apply twice.
 */
export function StockAdjustSheet({ target, onClose }: { target: StockTarget; onClose: () => void }) {
  const formId = useId()
  const directionLabelId = useId()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [direction, setDirection] = useState<Direction>('add')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<AdjustmentReason | ''>('')
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)

  const adjust = useAction((g, o, input: { adjustment: StockAdjustmentInput; key: string }) => g.adjustStock(o, input.adjustment, input.key))

  const qtyText = quantity.trim()
  const qty = /^\d+$/.test(qtyText) ? Number(qtyText) : NaN
  const qtyValid = Number.isSafeInteger(qty) && qty > 0
  const delta = qtyValid ? (direction === 'add' ? qty : -qty) : 0
  const resulting = target.onHand + delta
  const maxRemovable = Math.max(target.onHand - target.reserved, 0)
  const belowReserved = direction === 'remove' && qtyValid && resulting < target.reserved

  let qtyError: string | undefined
  if (!qtyValid) qtyError = 'Enter a whole number greater than 0'
  else if (belowReserved)
    qtyError =
      maxRemovable === 0
        ? `Nothing can be removed: all ${target.onHand} units on hand are reserved for open orders.`
        : `You can remove at most ${maxRemovable}. ${target.reserved} ${target.reserved === 1 ? 'unit is' : 'units are'} reserved for open orders.`
  const reasonError = reason ? undefined : 'Choose why stock is changing'

  function submit(e: FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (qtyError || !reason) return
    adjust.mutate(
      { adjustment: { variantId: target.variantId, delta, reason, note: note.trim() || null }, key: idempotencyKey },
      { onSuccess: onClose },
    )
  }

  const seg = (active: boolean) =>
    cn(
      'h-10 flex-1 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--ak-line-strong)]' : 'text-ink-2 hover:text-ink',
    )

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adjust stock"
      description={`${target.productName} · ${target.variantName}${target.sku ? ` · ${target.sku}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={adjust.isPending}>
            Save adjustment
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {adjust.isError && <ErrorNotice error={adjust.error} />}

        <dl className="grid grid-cols-3 gap-3 border-b border-line pb-4 text-sm">
          <div>
            <dt className="text-xs text-ink-3">On hand</dt>
            <dd className="tnum mt-0.5 text-lg font-semibold">{target.onHand}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Reserved</dt>
            <dd className="tnum mt-0.5 text-lg font-semibold">{target.reserved}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Available</dt>
            <dd className="tnum mt-0.5 text-lg font-semibold">{target.onHand - target.reserved}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-1.5">
          <span id={directionLabelId} className="text-[13px] font-medium text-ink">
            Change
          </span>
          <div role="group" aria-labelledby={directionLabelId} className="flex gap-1 rounded-lg bg-sunken p-1">
            <button type="button" aria-pressed={direction === 'add'} className={seg(direction === 'add')} onClick={() => setDirection('add')}>
              Add stock
            </button>
            <button type="button" aria-pressed={direction === 'remove'} className={seg(direction === 'remove')} onClick={() => setDirection('remove')}>
              Remove stock
            </button>
          </div>
        </div>

        <Field
          label="Quantity"
          error={attempted || belowReserved ? qtyError : undefined}
          hint={direction === 'remove' && target.reserved > 0 ? `Up to ${maxRemovable}. Reserved units can’t be removed here.` : undefined}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoComplete="off"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="tnum"
            />
          )}
        </Field>

        <Field label="Reason" error={attempted ? reasonError : undefined}>
          {(p) => (
            <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason | '')}>
              <option value="" disabled>
                Choose a reason
              </option>
              {reasonsFor(direction).map((r) => (
                <option key={r} value={r}>
                  {ADJUSTMENT_REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Note" optional hint="Visible in stock movements, e.g. delivery note number.">
          {(p) => <Textarea {...p} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        <div aria-live="polite" className="border-t border-line pt-4 text-sm">
          {qtyValid && !belowReserved ? (
            <p className="text-ink-2">
              On hand goes from <span className="tnum font-medium text-ink">{target.onHand}</span> to{' '}
              <span className={cn('tnum font-semibold', direction === 'add' ? 'text-pos' : 'text-neg')}>{resulting}</span>
              <span className="text-ink-3">
                {' '}
                · <span className="tnum">{resulting - target.reserved}</span> available
              </span>
            </p>
          ) : (
            <p className="text-ink-3">Enter a quantity to preview the new stock level.</p>
          )}
        </div>
      </form>
    </Sheet>
  )
}
