import { useFilterStore } from '@/store/filterStore'
import { Select } from '@/components/ui/select'
import { SORT_OPTIONS } from '@/lib/constants'
import type { SortOption } from '@/types'

export function ProductSort() {
  const sortBy = useFilterStore((s) => s.sortBy)
  const setSortBy = useFilterStore((s) => s.setSortBy)

  return (
    <div className="w-full sm:w-52">
      <Select
        value={sortBy}
        onValueChange={(value) => setSortBy(value as SortOption)}
        options={[...SORT_OPTIONS]}
        placeholder="Sort by..."
      />
    </div>
  )
}
