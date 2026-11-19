/**
 * Shopper cart, stored on the device per shop slug. One cart per shop and one
 * currency per cart: a line in another currency is refused, never merged.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export interface CartLine {
  variantId: string
  productId: string
  name: string
  variantName: string
  image: string | null
  unitPriceMinor: number
  currency: string
  quantity: number
  maxQuantity: number | null
}

export interface UseCartResult {
  lines: CartLine[]
  count: number
  subtotalMinor: number
  currency: string | null
  /** Returns false when the line was refused (different currency or nothing available). */
  add(line: Omit<CartLine, 'quantity'>, qty?: number): boolean
  setQuantity(variantId: string, qty: number): void
  remove(variantId: string): void
  clear(): void
  isOpen: boolean
  open(): void
  close(): void
}

/** localStorage that never throws (private mode, blocked storage, quota). */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      /* storage unavailable: cart lives in memory for this visit */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

function clampQty(qty: number, max: number | null): number {
  let q = Math.floor(Number.isFinite(qty) ? qty : 0)
  if (max !== null) q = Math.min(q, Math.max(0, max))
  return Math.max(0, q)
}

interface CartState {
  carts: Record<string, CartLine[]>
  openSlug: string | null
  add(slug: string, line: Omit<CartLine, 'quantity'>, qty: number): boolean
  setQuantity(slug: string, variantId: string, qty: number): void
  remove(slug: string, variantId: string): void
  clear(slug: string): void
  setOpen(slug: string | null): void
}

const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      carts: {},
      openSlug: null,
      add(slug, line, qty) {
        const lines = get().carts[slug] ?? []
        if (lines.length > 0 && lines[0].currency !== line.currency) return false
        const existing = lines.find((l) => l.variantId === line.variantId)
        const wanted = (existing?.quantity ?? 0) + Math.max(1, Math.floor(qty))
        const quantity = clampQty(wanted, line.maxQuantity)
        if (quantity <= 0) return false
        const next: CartLine = { ...line, quantity }
        set((s) => ({
          carts: {
            ...s.carts,
            [slug]: existing ? lines.map((l) => (l.variantId === line.variantId ? next : l)) : [...lines, next],
          },
        }))
        return true
      },
      setQuantity(slug, variantId, qty) {
        const lines = get().carts[slug] ?? []
        const next = lines
          .map((l) => (l.variantId === variantId ? { ...l, quantity: clampQty(qty, l.maxQuantity) } : l))
          .filter((l) => l.quantity > 0)
        set((s) => ({ carts: { ...s.carts, [slug]: next } }))
      },
      remove(slug, variantId) {
        set((s) => ({ carts: { ...s.carts, [slug]: (s.carts[slug] ?? []).filter((l) => l.variantId !== variantId) } }))
      },
      clear(slug) {
        set((s) => {
          const carts = { ...s.carts }
          delete carts[slug]
          return { carts }
        })
      },
      setOpen(slug) {
        set({ openSlug: slug })
      },
    }),
    {
      name: 'rafu-carts',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ carts: s.carts }),
    },
  ),
)

const EMPTY: CartLine[] = []

export function useCart(slug: string): UseCartResult {
  const lines = useCartStore((s) => s.carts[slug] ?? EMPTY)
  const isOpen = useCartStore((s) => s.openSlug === slug)
  return useMemo(() => {
    const st = useCartStore.getState()
    let count = 0
    let subtotalMinor = 0
    for (const l of lines) {
      count += l.quantity
      subtotalMinor += l.unitPriceMinor * l.quantity
    }
    return {
      lines,
      count,
      subtotalMinor,
      currency: lines[0]?.currency ?? null,
      add: (line, qty = 1) => st.add(slug, line, qty),
      setQuantity: (variantId, qty) => st.setQuantity(slug, variantId, qty),
      remove: (variantId) => st.remove(slug, variantId),
      clear: () => st.clear(slug),
      isOpen,
      open: () => st.setOpen(slug),
      close: () => st.setOpen(null),
    }
  }, [lines, isOpen, slug])
}
