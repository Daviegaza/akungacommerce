import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { STANDARD_SHIPPING, SHIPPING_THRESHOLD, TAX_RATE } from '@/lib/constants'
import { Separator } from '@/components/ui/separator'
import { Check } from 'lucide-react'

export function OrderSummary() {
  const items = useCartStore((s) => s.items)
  const subtotal = useCartStore((s) => s.subtotal())
  const shipping = subtotal >= SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING
  const tax = subtotal * TAX_RATE
  const total = subtotal + shipping + tax

  return (
    <div className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-6 space-y-5">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">Order Summary</h3>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            <div className="relative shrink-0">
              <img
                src={item.image}
                alt={item.name}
                className="h-16 w-16 rounded-xl object-cover"
              />
              <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface-900 dark:bg-white text-[10px] font-bold text-white dark:text-surface-900">
                {item.quantity}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                {item.name}
              </p>
              <p className="text-xs text-surface-400 dark:text-surface-500">
                {item.color} {item.size && `/ ${item.size}`}
              </p>
            </div>
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 shrink-0">
              {formatPrice(item.price * item.quantity)}
            </p>
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Shipping</span>
          <span>{shipping === 0 ? 'Free' : formatPrice(shipping)}</span>
        </div>
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Tax</span>
          <span>{formatPrice(tax)}</span>
        </div>
        <Separator />
        <div className="flex justify-between text-base font-bold text-surface-900 dark:text-white">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <div className="rounded-xl bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
        {[
          'Free shipping on orders over $75',
          '30-day hassle-free returns',
          '2-year manufacturer warranty',
        ].map((text) => (
          <div key={text} className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
            <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}
