import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WishlistStore {
  items: string[]
  addItem: (productId: string) => void
  removeItem: (productId: string) => void
  toggleItem: (productId: string) => void
  hasItem: (productId: string) => boolean
  count: () => number
}

export const useWishlistStore = create<WishlistStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (productId) => {
        set((state) => ({
          items: state.items.includes(productId) ? state.items : [...state.items, productId],
        }))
      },

      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((id) => id !== productId),
        }))
      },

      toggleItem: (productId) => {
        set((state) => ({
          items: state.items.includes(productId)
            ? state.items.filter((id) => id !== productId)
            : [...state.items, productId],
        }))
      },

      hasItem: (productId) => {
        return get().items.includes(productId)
      },

      count: () => {
        return get().items.length
      },
    }),
    { name: 'akunga-wishlist' }
  )
)
