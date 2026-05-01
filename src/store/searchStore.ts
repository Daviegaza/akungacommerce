import { create } from 'zustand'
import type { Product } from '@/types'
import { products } from '@/lib/products'

interface SearchStore {
  query: string
  results: Product[]
  suggestions: string[]
  isSearching: boolean
  isOpen: boolean

  setQuery: (query: string) => void
  search: (query: string) => void
  clearSearch: () => void
  openSearch: () => void
  closeSearch: () => void
}

export const useSearchStore = create<SearchStore>()((set) => ({
  query: '',
  results: [],
  suggestions: [],
  isSearching: false,
  isOpen: false,

  setQuery: (query) => set({ query }),

  search: (query) => {
    if (!query.trim()) {
      set({ results: [], suggestions: [], isSearching: false })
      return
    }

    set({ isSearching: true })

    const q = query.toLowerCase()
    const results = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q))
    )

    const suggestions = products
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => p.name)

    set({ results, suggestions, isSearching: false })
  },

  clearSearch: () => set({ query: '', results: [], suggestions: [], isSearching: false, isOpen: false }),

  openSearch: () => set({ isOpen: true }),
  closeSearch: () => set({ isOpen: false }),
}))
