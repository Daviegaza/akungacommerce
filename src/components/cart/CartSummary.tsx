import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { STANDARD_SHIPPING, SHIPPING_THRESHOLD, TAX_RATE, ROUTES } from '@/lib/constants'

export function CartSummary() {
  const subtotal = useCartStore((s) => s.subtotal())
  const shipping = subtotal >= SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING
  const tax = subtotal * TAX_RATE
  const total = subtotal + shipping + tax

  return (
    <div className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-6 space-y-5">
      <h3 className="text-lg font-bold text-surface-900 dark:text-white">Order Summary</h3>

      {/* Promo code */}
      <div className="flex gap-2">
        <Input placeholder="Promo code" className="flex-1" />
        <Button variant="outline" size="md">
          Apply
        </Button>
      </div>

      <Separator />

      <div className="space-y-3 text-sm">
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Subtotal</span>
          <span className="font-medium">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Shipping</span>
          <span className={shipping === 0 ? 'text-green-600 dark:text-green-400 font-medium' : 'font-medium'}>
            {shipping === 0 ? 'Free' : formatPrice(shipping)}
          </span>
        </div>
        <div className="flex justify-between text-surface-600 dark:text-surface-400">
          <span>Tax (est.)</span>
          <span className="font-medium">{formatPrice(tax)}</span>
        </div>

        <Separator />

        <div className="flex justify-between text-base font-bold text-surface-900 dark:text-white">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      {shipping > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Add {formatPrice(SHIPPING_THRESHOLD - subtotal)} more for free shipping!
        </div>
      )}

      <Link to={ROUTES.checkout} className="block">
        <Button size="xl" className="w-full">
          Proceed to Checkout
          <ArrowRight className="h-5 w-5" />
        </Button>
      </Link>

      <div className="flex items-center justify-center gap-6 text-xs text-surface-400 dark:text-surface-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secure Checkout
        </span>
        <span className="flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" />
          Fast Delivery
        </span>
      </div>
    </div>
  )
}
