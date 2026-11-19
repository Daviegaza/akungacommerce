import { BRAND } from './brand'

/** Rafu mark: two shelves forming an "r" with a mango product dot. */
export function RafuMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#FF3D6E" />
      <rect x="14" y="20" width="36" height="6" rx="3" fill="#fff" />
      <rect x="14" y="38" width="36" height="6" rx="3" fill="#fff" />
      <rect x="18" y="20" width="6" height="28" rx="3" fill="#fff" />
      <circle cx="42" cy="31" r="5" fill="#FFB020" />
    </svg>
  )
}

export function RafuLogo({ size = 28, className, wordmark = true }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`} aria-label={BRAND.name}>
      <RafuMark size={size} />
      {wordmark && (
        <span className="font-display font-extrabold tracking-tight text-ink" style={{ fontSize: size * 0.78 }}>
          {BRAND.name.toLowerCase()}
        </span>
      )}
    </span>
  )
}
