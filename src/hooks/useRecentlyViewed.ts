import { useEffect, useCallback } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '@/types'
import { getProductById } from '@/lib/products'

const MAX_ITEMS = 12

interface RecentlyViewedStore {
  ids: string[]
  addProduct: (productId: string) => void
  getProducts: () => Product[]
  clearAll: () => void
}

export const useRecentlyViewedStore = create<RecentlyViewedStore>()(
  persist(
    (set, get) => ({
      ids: [],

      addProduct: (productId) => {
        set((state) => {
          const filtered = state.ids.filter((id) => id !== productId)
          return { ids: [productId, ...filtered].slice(0, MAX_ITEMS) }
        })
      },

      getProducts: () => {
        return get()
          .ids.map((id) => getProductById(id))
          .filter((p): p is Product => p !== undefined)
      },

      clearAll: () => set({ ids: [] }),
    }),
    { name: 'akunga-recently-viewed' }
  )
)

export function useRecentlyViewed(productId?: string) {
  const addProduct = useRecentlyViewedStore((s) => s.addProduct)

  useEffect(() => {
    if (productId) {
      // Delay to avoid tracking during SSR or fast navigations
      const timer = setTimeout(() => addProduct(productId), 500)
      return () => clearTimeout(timer)
    }
  }, [productId, addProduct])

  const getProducts = useCallback(() => {
    return useRecentlyViewedStore.getState().getProducts()
  }, [])

  return { getProducts }
}
