import { cn } from '@/lib/utils'

export interface CategoryChip {
  name: string
  image: string | null
  count: number
}

const TAB =
  'relative -mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors'

/** Calm, horizontally scrolling text tabs for the shop's categories (underlined when active). */
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
      <ul className="no-scrollbar flex gap-6 overflow-x-auto border-b border-line">
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={active === null}
            className={cn(TAB, active === null ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink')}
          >
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
                className={cn(TAB, on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink')}
              >
                <span className="max-w-[12rem] truncate">{c.name}</span>
                <span className="text-xs font-normal text-ink-3 tnum">{c.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
