import { create } from 'zustand'
import type { Category, SortOption } from '@/types'

interface FilterStore {
  search: string
  categories: Category[]
  priceRange: [number, number]
  sortBy: SortOption
  inStockOnly: boolean
  onSale: boolean

  setSearch: (search: string) => void
  toggleCategory: (category: Category) => void
  setPriceRange: (range: [number, number]) => void
  setSortBy: (sort: SortOption) => void
  toggleInStock: () => void
  toggleOnSale: () => void
  resetFilters: () => void
  activeFilterCount: () => number
}

export const useFilterStore = create<FilterStore>()((set, get) => ({
  search: '',
  categories: [],
  priceRange: [0, 2000],
  sortBy: 'featured',
  inStockOnly: false,
  onSale: false,

  setSearch: (search) => set({ search }),

  toggleCategory: (category) =>
    set((state) => ({
      categories: state.categories.includes(category)
        ? state.categories.filter((c) => c !== category)
        : [...state.categories, category],
    })),

  setPriceRange: (range) => set({ priceRange: range }),

  setSortBy: (sortBy) => set({ sortBy }),

  toggleInStock: () => set((state) => ({ inStockOnly: !state.inStockOnly })),

  toggleOnSale: () => set((state) => ({ onSale: !state.onSale })),

  resetFilters: () =>
    set({
      categories: [],
      priceRange: [0, 2000],
      sortBy: 'featured',
      inStockOnly: false,
      onSale: false,
    }),

  activeFilterCount: () => {
    const state = get()
    let count = state.categories.length
    if (state.priceRange[0] > 0 || state.priceRange[1] < 2000) count++
    if (state.inStockOnly) count++
    if (state.onSale) count++
    return count
  },
}))
