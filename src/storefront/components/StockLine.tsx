import { cn } from '@/lib/utils'

/** "Only N left" strictly from real stock at or below the merchant's threshold. */
export function StockLine({
  available,
  lowStockThreshold,
  className,
}: {
  available: number | null
  lowStockThreshold: number
  className?: string
}) {
  if (available === null) return null
  if (available === 0) {
    return <p className={cn('text-sm font-medium text-ink-3', className)}>Sold out</p>
  }
  if (available > 0 && available <= lowStockThreshold) {
    return (
      <p className={cn('inline-flex items-center gap-1.5 text-sm font-medium text-warn', className)}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        Only <span className="tnum">{available}</span> left
      </p>
    )
  }
  return null
}

/** Overlay for a product image when nothing is available. */
export function SoldOutOverlay() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-canvas/50">
      <span className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-canvas">Sold out</span>
    </div>
  )
}
