import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WhatsAppGlyph } from './WhatsAppGlyph'

/** Native share sheet when available; otherwise copy link + WhatsApp share. */
export function ShareButton({
  url,
  title,
  text,
  className,
  label = 'Share',
}: {
  url: string
  title: string
  text?: string
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function onShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // fall through to the manual options
      }
    }
    setOpen((o) => !o)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const waText = [text || title, url].filter(Boolean).join('\n')

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={onShare}
        aria-label={label}
        aria-expanded={open}
        className={cn(
          'grid size-11 place-items-center rounded-full border border-line bg-panel text-ink transition-colors hover:bg-sunken',
          className,
        )}
      >
        <Share2 className="size-[18px]" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="ak-rise absolute top-[calc(100%+6px)] right-0 z-40 w-56 overflow-hidden rounded-2xl border border-line bg-panel p-1.5 shadow-[var(--shadow-lift)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={copy}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink hover:bg-sunken"
          >
            {copied ? <Check className="size-4 text-pos" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a
            role="menuitem"
            href={`https://wa.me/?text=${encodeURIComponent(waText)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink hover:bg-sunken"
          >
            <WhatsAppGlyph className="size-4 text-[#25D366]" />
            Share on WhatsApp
          </a>
        </div>
      )}
    </div>
  )
}
