import { cn } from '@/lib/utils'

/** Delivered units from the gateway (already null below 5; guarded again here). */
export function SoldCount({ soldCount, className }: { soldCount: number | null; className?: string }) {
  if (soldCount === null || soldCount < 5) return null
  return <span className={cn('text-xs text-ink-3 tnum', className)}>{soldCount.toLocaleString()} sold</span>
}
