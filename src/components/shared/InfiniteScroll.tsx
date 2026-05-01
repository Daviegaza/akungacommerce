import { useEffect, useRef, useCallback, type ReactNode } from 'react'

interface InfiniteScrollProps {
  children: ReactNode
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  loader?: ReactNode
  endMessage?: ReactNode
  threshold?: number
}

export function InfiniteScroll({
  children,
  hasMore,
  isLoading,
  onLoadMore,
  loader,
  endMessage,
  threshold = 0.3,
}: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry.isIntersecting && hasMore && !isLoading) {
        onLoadMore()
      }
    },
    [hasMore, isLoading, onLoadMore]
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(handleIntersection, {
      root: null,
      rootMargin: '200px 0px',
      threshold,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersection, threshold])

  return (
    <div>
      {children}

      {/* Sentinel element for intersection detection */}
      <div ref={sentinelRef} className="h-1" />

      {/* Loader */}
      {isLoading && (
        loader ?? (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-brand-600 [animation-delay:-0.3s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-brand-600 [animation-delay:-0.15s]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-brand-600" />
            </div>
          </div>
        )
      )}

      {/* End message */}
      {!hasMore && !isLoading && (
        endMessage ?? (
          <div className="text-center py-12">
            <p className="text-sm text-surface-400 dark:text-surface-500">
              You have viewed all products
            </p>
          </div>
        )
      )}
    </div>
  )
}
