import { MapPin } from 'lucide-react'

/** Skeleton shown while the code-split map bundle loads (use as the Suspense fallback). */
export function MapFallback({ height = 240 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading map"
      style={{ height }}
      className="relative flex w-full animate-pulse items-center justify-center overflow-hidden rounded-2xl bg-sunken"
    >
      <MapPin className="size-7 text-ink-3" aria-hidden />
      <span className="sr-only">Loading map</span>
    </div>
  )
}
