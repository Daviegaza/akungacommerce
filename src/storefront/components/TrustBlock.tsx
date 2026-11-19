import type { ReactNode } from 'react'
import { BadgeCheck, Banknote, ChevronDown, MapPin, RotateCcw, Smartphone, Truck } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { isE164, whatsappChatLink } from '@/integrations/whatsapp-link'
import { cn } from '@/lib/utils'
import { WhatsAppGlyph } from './WhatsAppGlyph'

function Row({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-sm text-ink-2">{children}</div>}
      </div>
    </li>
  )
}

/** Seller trust signals, each shown only when the merchant has set it. */
export function TrustBlock({ shop, className, contextText }: { shop: PublicShop; className?: string; contextText?: string }) {
  const wa = shop.whatsappE164 && isE164(shop.whatsappE164) ? shop.whatsappE164 : null
  const hasAny =
    shop.registeredName || shop.mpesaTill || shop.mpesaPaybill || (shop.pickupEnabled && shop.locationLabel) || shop.deliveryPromise || shop.codEnabled || shop.returnPolicy || wa
  if (!hasAny) return null

  return (
    <section aria-label="About this seller" className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:p-5', className)}>
      <h2 className="text-lg font-extrabold tracking-tight text-ink">Buying from {shop.name}</h2>
      <ul className="mt-1 divide-y divide-line">
        {shop.registeredName && (
          <Row icon={<BadgeCheck className="size-4 text-pos" aria-hidden />} title={`M-Pesa shows: ${shop.registeredName}`}>
            Check this name on your M-Pesa prompt before you enter your PIN.
          </Row>
        )}
        {(shop.mpesaTill || shop.mpesaPaybill) && (
          <Row icon={<Smartphone className="size-4" aria-hidden />} title="Pay with M-Pesa">
            {shop.mpesaTill && (
              <span className="block">
                Till <span className="font-semibold text-ink tnum">{shop.mpesaTill}</span>
              </span>
            )}
            {shop.mpesaPaybill && (
              <span className="block">
                Paybill <span className="font-semibold text-ink tnum">{shop.mpesaPaybill}</span>
              </span>
            )}
          </Row>
        )}
        {shop.codEnabled && <Row icon={<Banknote className="size-4" aria-hidden />} title="Pay on delivery available" />}
        {shop.deliveryEnabled && shop.deliveryPromise && (
          <Row icon={<Truck className="size-4" aria-hidden />} title="Delivery">
            {shop.deliveryPromise}
          </Row>
        )}
        {shop.pickupEnabled && shop.locationLabel && (
          <Row icon={<MapPin className="size-4" aria-hidden />} title="Pickup">
            {shop.locationLabel}
          </Row>
        )}
        {shop.returnPolicy && (
          <li className="py-3">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">
                  <RotateCcw className="size-4" aria-hidden />
                </span>
                <span className="flex-1 text-sm font-semibold text-ink">Returns</span>
                <ChevronDown className="size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 pl-11 text-sm leading-relaxed whitespace-pre-line text-ink-2">{shop.returnPolicy}</p>
            </details>
          </li>
        )}
      </ul>
      {wa && (
        <a
          href={whatsappChatLink(wa, contextText ?? `Hi ${shop.name}, I have a question.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-panel text-sm font-semibold text-ink transition-colors hover:bg-sunken"
        >
          <WhatsAppGlyph className="size-[18px] text-[#25D366]" />
          Chat with the seller
        </a>
      )}
    </section>
  )
}
