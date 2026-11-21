/** Saved items, kept only on this device, per shop slug. No account needed. */
import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from './cart'

interface WishlistState {
  lists: Record<string, string[]>
  toggle(slug: string, productId: string): void
}

const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      lists: {},
      toggle(slug, productId) {
        set((s) => {
          const ids = s.lists[slug] ?? []
          const next = ids.includes(productId) ? ids.filter((id) => id !== productId) : [...ids, productId]
          return { lists: { ...s.lists, [slug]: next } }
        })
      },
    }),
    { name: 'rafu-wishlist', version: 1, storage: createJSONStorage(() => safeLocalStorage) },
  ),
)

const EMPTY: string[] = []

export interface UseWishlistResult {
  ids: string[]
  count: number
  has(productId: string): boolean
  toggle(productId: string): void
}

export function useWishlist(slug: string): UseWishlistResult {
  const ids = useWishlistStore((s) => s.lists[slug] ?? EMPTY)
  return useMemo(
    () => ({
      ids,
      count: ids.length,
      has: (id) => ids.includes(id),
      toggle: (id) => useWishlistStore.getState().toggle(slug, id),
    }),
    [ids, slug],
  )
}
