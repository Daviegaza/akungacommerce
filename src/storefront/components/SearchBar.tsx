import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, Search, Tag, X } from 'lucide-react'
import type { PublicProduct, PublicShop } from '@/gateway/storefront'
import { cn } from '@/lib/utils'
import { useRecentSearches } from './hooks'
import { ProductImg } from './ProductImg'
import { categoriesOf, displayVariant, fmtMoney, productPath, shopPath } from './storefront-utils'

type Option =
  | { kind: 'product'; id: string; label: string; product: PublicProduct }
  | { kind: 'category'; id: string; label: string }
  | { kind: 'recent'; id: string; label: string }

/** Instant in-browser search over the shop's catalogue, with device-only recent searches. */
export function SearchBar({
  slug,
  shop,
  products,
  autoFocus,
  onDone,
  className,
}: {
  slug: string
  shop: PublicShop
  products: PublicProduct[]
  autoFocus?: boolean
  onDone?: () => void
  className?: string
}) {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const recent = useRecentSearches(slug)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(() => params.get('q') ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const onHome = location.pathname.replace(/\/+$/, '') === shopPath(slug)
  const categories = useMemo(() => categoriesOf(products), [products])
  const term = value.trim().toLowerCase()

  const options: Option[] = useMemo(() => {
    if (!term) {
      return [
        ...recent.items.map((r) => ({ kind: 'recent' as const, id: `r:${r}`, label: r })),
        ...categories.slice(0, 6).map((c) => ({ kind: 'category' as const, id: `c:${c.name}`, label: c.name })),
      ]
    }
    const cats = categories
      .filter((c) => c.name.toLowerCase().includes(term))
      .slice(0, 3)
      .map((c) => ({ kind: 'category' as const, id: `c:${c.name}`, label: c.name }))
    const prods = products
      .filter((p) => p.name.toLowerCase().includes(term) || (p.category ?? '').toLowerCase().includes(term))
      .slice(0, 6)
      .map((p) => ({ kind: 'product' as const, id: `p:${p.id}`, label: p.name, product: p }))
    return [...cats, ...prods]
  }, [term, recent.items, categories, products])

  function go(next: URLSearchParams) {
    const search = next.toString()
    navigate({ pathname: shopPath(slug), search: search ? `?${search}` : '' })
    setOpen(false)
    setActive(-1)
    inputRef.current?.blur()
    onDone?.()
  }

  function submit(q: string) {
    const next = new URLSearchParams(onHome ? params : undefined)
    const t = q.trim()
    if (t) {
      next.set('q', t)
      recent.push(t)
    } else next.delete('q')
    setValue(t)
    go(next)
  }

  function choose(o: Option) {
    if (o.kind === 'product') {
      recent.push(value.trim() || o.label)
      setOpen(false)
      onDone?.()
      navigate(productPath(slug, o.product.id))
      return
    }
    if (o.kind === 'recent') {
      submit(o.label)
      return
    }
    const next = new URLSearchParams()
    next.set('cat', o.label)
    setValue('')
    go(next)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0 && options[active]) choose(options[active])
      else submit(value)
    } else if (e.key === 'Escape') {
      if (open) setOpen(false)
      else onDone?.()
    }
  }

  const showPanel = open && (options.length > 0 || term.length > 0)
  const activeId = active >= 0 && options[active] ? `${listId}-${active}` : undefined

  return (
    <div className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          submit(value)
        }}
      >
        <label className="sr-only" htmlFor={`${listId}-input`}>
          Search {shop.name}
        </label>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 transition-colors focus-within:border-ink-2 hover:border-ink-3">
          <Search className="size-[18px] shrink-0 text-ink-3" aria-hidden />
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={autoFocus}
            placeholder={`Search ${shop.name}`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
            style={{ outline: 'none' }}
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue('')
                setActive(-1)
                if (onHome && params.get('q')) {
                  const next = new URLSearchParams(params)
                  next.delete('q')
                  go(next)
                } else inputRef.current?.focus()
              }}
              className="-mr-1.5 grid size-8 place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </form>

      {showPanel && (
        <div
          className="ak-rise absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-lift)]"
          onMouseDown={(e) => e.preventDefault()}
        >
          {!term && recent.items.length > 0 && (
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="text-xs font-medium text-ink-3">Recent</span>
              <button type="button" onClick={recent.clear} className="text-xs font-medium text-ink-3 hover:text-ink">
                Clear
              </button>
            </div>
          )}
          <ul id={listId} role="listbox" aria-label="Suggestions" className="max-h-[60vh] overflow-y-auto py-1">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink', i === active && 'bg-sunken')}
              >
                {o.kind === 'product' ? (
                  <>
                    <span className="size-10 shrink-0 overflow-hidden rounded-md bg-sunken">
                      <ProductImg src={o.product.images[0]?.url} name={o.product.name} className="size-full" initialClassName="text-base" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {(() => {
                      const v = displayVariant(o.product)
                      return v ? <span className="shrink-0 font-medium tnum">{fmtMoney(v.priceMinor, v.currency, shop.locale)}</span> : null
                    })()}
                  </>
                ) : (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center text-ink-3">
                      {o.kind === 'recent' ? <Clock className="size-4" aria-hidden /> : <Tag className="size-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.kind === 'category' && <span className="text-xs text-ink-3">Category</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
          {term && options.length === 0 && (
            <p className="px-4 py-4 text-sm text-ink-3">
              No matches for “{value.trim()}”. Press Enter to search anyway{shop.whatsappE164 ? ', or ask the shop on WhatsApp.' : '.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
