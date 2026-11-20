import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { getStorefrontGateway } from '../gateway'

/**
 * Bank transfer at checkout (NGN shops). Shown only when the server says the
 * shop's virtual-account provider is connected and verified (or, in the demo,
 * simulated). Keeps CheckoutPage changes to a few lines.
 */
export function useBankTransferOption(slug: string, shop: PublicShop) {
  const extras = useQuery({
    queryKey: ['storefront', slug, 'extras'],
    queryFn: async () => (await getStorefrontGateway()).getStorefrontExtras(slug),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const bt = extras.data?.bankTransfer
  const available = shop.currency === 'NGN' && bt?.available === true
  return {
    available,
    option: {
      value: 'bank_transfer' as const,
      label: 'Bank transfer',
      icon: <Landmark className="size-4" aria-hidden />,
      note: `Transfer from any Nigerian bank. The shop sends you the account details after you order, and confirms the order when the money arrives${bt?.simulated ? ' (simulated in the demo)' : ''}.`,
    },
  }
}
