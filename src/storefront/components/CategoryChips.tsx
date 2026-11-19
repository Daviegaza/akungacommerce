import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProductImg } from './ProductImg'

export interface CategoryChip {
  name: string
  image: string | null
  count: number
}

/** Horizontally scrolling category chips with a real product photo each. */
export function CategoryChips({
  categories,
  active,
  onSelect,
  className,
}: {
  categories: CategoryChip[]
  active: string | null
  onSelect: (name: string | null) => void
  className?: string
}) {
  if (categories.length < 2) return null
  return (
    <nav aria-label="Categories" className={className}>
      <ul className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-1 sm:px-6">
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={active === null}
            className={cn(
              'flex h-12 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-semibold transition-colors',
              active === null ? 'border-brand bg-brand text-on-brand' : 'border-line bg-panel text-ink hover:border-line-strong',
            )}
          >
            <span className={cn('grid size-9 place-items-center rounded-full', active === null ? 'bg-white/20' : 'bg-sunken')}>
              <LayoutGrid className="size-4" aria-hidden />
            </span>
            All
          </button>
        </li>
        {categories.map((c) => {
          const on = active === c.name
          return (
            <li key={c.name} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(on ? null : c.name)}
                aria-pressed={on}
                className={cn(
                  'flex h-12 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-semibold transition-colors',
                  on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-panel text-ink hover:border-line-strong',
                )}
              >
                <span className="size-9 overflow-hidden rounded-full bg-sunken">
                  <ProductImg src={c.image} name={c.name} className="size-full" initialClassName="text-sm" />
                </span>
                <span className="max-w-[10rem] truncate">{c.name}</span>
                <span className={cn('text-xs font-medium tnum', on ? 'text-on-brand/80' : 'text-ink-3')}>{c.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
