import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastStore {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
}

let toastCounter = 0

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++toastCounter}-${Date.now()}`
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }))

    if (toast.duration !== 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }))
      }, toast.duration ?? 4000)
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  success: (title, message) => {
    set((state) => {
      const id = `toast-${++toastCounter}-${Date.now()}`
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 4000)
      return { toasts: [...state.toasts, { id, type: 'success', title, message }] }
    })
  },

  error: (title, message) => {
    set((state) => {
      const id = `toast-${++toastCounter}-${Date.now()}`
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 5000)
      return { toasts: [...state.toasts, { id, type: 'error', title, message }] }
    })
  },

  info: (title, message) => {
    set((state) => {
      const id = `toast-${++toastCounter}-${Date.now()}`
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 3500)
      return { toasts: [...state.toasts, { id, type: 'info', title, message }] }
    })
  },

  warning: (title, message) => {
    set((state) => {
      const id = `toast-${++toastCounter}-${Date.now()}`
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 4500)
      return { toasts: [...state.toasts, { id, type: 'warning', title, message }] }
    })
  },
}))
