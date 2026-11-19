import { useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProductImage } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { ProductImg } from './ProductImg'

/** Swipeable scroll-snap gallery with dots (phone) and thumbnails. */
export function Gallery({ images, name, overlay }: { images: ProductImage[]; name: string; overlay?: ReactNode }) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const count = Math.max(1, images.length)

  function goTo(i: number) {
    const el = track.current
    if (!el) return
    const next = Math.max(0, Math.min(count - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    setIndex(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden bg-sunken sm:rounded-[var(--radius-card)]">
        <div
          ref={track}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${name} photos`}
          tabIndex={images.length > 1 ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') goTo(index + 1)
            if (e.key === 'ArrowLeft') goTo(index - 1)
          }}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.clientWidth === 0) return
            const i = Math.round(el.scrollLeft / el.clientWidth)
            if (i !== index) setIndex(i)
          }}
          className="no-scrollbar flex aspect-square snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        >
          {images.length === 0 ? (
            <ProductImg src={null} name={name} className="aspect-square w-full shrink-0" initialClassName="text-7xl" />
          ) : (
            images.map((img, i) => (
              <div
                key={`${img.url}-${i}`}
                className="relative aspect-square w-full shrink-0 snap-center"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${images.length}`}
              >
                <ProductImg src={img.url} name={img.alt || name} eager={i === 0} className="size-full" initialClassName="text-7xl" />
              </div>
            ))
          )}
        </div>

        {overlay}

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Previous photo"
              className="absolute top-1/2 left-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-panel/90 text-ink shadow-md transition-opacity disabled:opacity-0 sm:grid"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index >= images.length - 1}
              aria-label="Next photo"
              className="absolute top-1/2 right-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-panel/90 text-ink shadow-md transition-opacity disabled:opacity-0 sm:grid"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5 sm:hidden" aria-hidden>
              {images.map((img, i) => (
                <span
                  key={`${img.url}-dot-${i}`}
                  className={cn(
                    'h-1.5 rounded-full bg-white shadow transition-all duration-300',
                    i === index ? 'w-5 opacity-100' : 'w-1.5 opacity-60',
                  )}
                />
              ))}
            </div>
            <span className="absolute top-3 right-3 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white tnum sm:hidden">
              {index + 1}/{images.length}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 sm:px-0">
          {images.map((img, i) => (
            <button
              key={`${img.url}-thumb-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'size-16 shrink-0 overflow-hidden rounded-xl border-2 transition-colors sm:size-20',
                i === index ? 'border-brand' : 'border-transparent opacity-75 hover:opacity-100',
              )}
            >
              <ProductImg src={img.url} name={img.alt || name} className="size-full" initialClassName="text-lg" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
