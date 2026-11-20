import { useState } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Truck, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Step = 'shipping' | 'payment' | 'confirmed'

export function CheckoutForm() {
  const [step, setStep] = useState<Step>('shipping')
  // Prototype reference, fixed for the life of this form (not recomputed on every render).
  const [orderRef] = useState(() => Date.now().toString(36).toUpperCase())

  const steps = [
    { key: 'shipping' as const, label: 'Shipping', icon: Truck },
    { key: 'payment' as const, label: 'Payment', icon: CreditCard },
    { key: 'confirmed' as const, label: 'Confirmed', icon: Check },
  ]

  return (
    <div>
      {/* Steps indicator */}
      <div className="flex items-center gap-4 mb-8">
        {steps.map(({ key, label, icon: Icon }, i) => (
          <div key={key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-300',
                step === key
                  ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                  : steps.findIndex((s) => s.key === step) > i
                    ? 'bg-green-500 text-white'
                    : 'bg-surface-100 text-surface-400 dark:bg-surface-800'
              )}
            >
              {steps.findIndex((s) => s.key === step) > i ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
            </div>
            <span
              className={cn(
                'text-sm font-semibold hidden sm:block',
                step === key ? 'text-surface-900 dark:text-white' : 'text-surface-400'
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-8 sm:w-12 rounded-full',
                  steps.findIndex((s) => s.key === step) > i ? 'bg-green-500' : 'bg-surface-200 dark:bg-surface-700'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Shipping Step */}
      {step === 'shipping' && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-4"
        >
          <h2 className="text-xl font-bold text-surface-900 dark:text-white">Shipping Information</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="First Name" placeholder="John" required />
            <Input label="Last Name" placeholder="Doe" required />
          </div>
          <Input label="Email" type="email" placeholder="john@example.com" required />
          <Input label="Address" placeholder="123 Main St" required />
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="City" placeholder="San Francisco" required />
            <Input label="State" placeholder="CA" required />
            <Input label="ZIP Code" placeholder="94102" required />
          </div>
          <Input label="Country" placeholder="United States" required />
          <Button size="xl" onClick={() => setStep('payment')} className="w-full mt-2">
            Continue to Payment
          </Button>
        </motion.div>
      )}

      {/* Payment Step */}
      {step === 'payment' && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-4"
        >
          <h2 className="text-xl font-bold text-surface-900 dark:text-white">Payment Details</h2>
          <Input label="Card Number" placeholder="4242 4242 4242 4242" required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Expiry Date" placeholder="MM/YY" required />
            <Input label="CVC" placeholder="123" required />
          </div>
          <Input label="Name on Card" placeholder="John Doe" required />
          <div className="flex gap-3 mt-2">
            <Button variant="outline" size="xl" onClick={() => setStep('shipping')} className="flex-1">
              Back
            </Button>
            <Button size="xl" onClick={() => setStep('confirmed')} className="flex-1">
              Place Order
            </Button>
          </div>
          <p className="text-xs text-surface-400 text-center">
            Your payment info is securely encrypted. We never store your card details.
          </p>
        </motion.div>
      )}

      {/* Confirmed */}
      {step === 'confirmed' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-12 space-y-4"
        >
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
            <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-semibold text-surface-900 dark:text-white">Order Confirmed!</h2>
          <p className="text-surface-500 dark:text-surface-400 max-w-sm mx-auto">
            Thank you for your order. You will receive a confirmation email shortly with your order details and tracking information.
          </p>
          <div className="rounded-2xl bg-surface-50 dark:bg-surface-800/50 p-5 max-w-xs mx-auto">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Order #AK-{orderRef}</p>
            <p className="text-xs text-surface-400 mt-1">Estimated delivery: 3-5 business days</p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
