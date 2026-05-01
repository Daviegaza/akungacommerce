import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useToastStore, type Toast } from '@/store/toastStore'
import { cn } from '@/lib/utils'

const iconMap = {
  success: { icon: CheckCircle, bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-200 dark:border-green-800', text: 'text-green-800 dark:text-green-200', iconColor: 'text-green-500 dark:text-green-400' },
  error: { icon: XCircle, bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-800', text: 'text-red-800 dark:text-red-200', iconColor: 'text-red-500 dark:text-red-400' },
  info: { icon: Info, bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-800 dark:text-blue-200', iconColor: 'text-blue-500 dark:text-blue-400' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-800 dark:text-amber-200', iconColor: 'text-amber-500 dark:text-amber-400' },
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const { icon: Icon, bg, border, text, iconColor } = iconMap[toast.type]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.95, x: 40 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.95, x: 40 }}
      transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      className={cn(
        'pointer-events-auto w-full max-w-sm rounded-2xl border p-4 shadow-2xl backdrop-blur-sm',
        bg, border
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconColor)} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-semibold', text)}>{toast.title}</p>
          {toast.message && (
            <p className={cn('text-xs mt-0.5 opacity-80', text)}>{toast.message}</p>
          )}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className={cn('text-xs font-semibold mt-2 underline underline-offset-2 hover:opacity-80', iconColor)}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => removeToast(toast.id)}
          className={cn('shrink-0 rounded-lg p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10', text)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: (toast.duration ?? 4000) / 1000, ease: 'linear' }}
        className={cn('absolute bottom-0 left-0 right-0 h-0.5 rounded-full origin-left', iconColor, 'bg-current opacity-30')}
      />
    </motion.div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  // Keyboard shortcut to dismiss all
  const dismissAll = useCallback(() => {
    toasts.forEach((t) => useToastStore.getState().removeToast(t.id))
  }, [toasts])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && toasts.length > 0) {
        dismissAll()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toasts.length, dismissAll])

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
