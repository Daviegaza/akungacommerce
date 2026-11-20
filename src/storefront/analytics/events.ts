/**
 * Tiny in-page event bus for shopper events. Storefront code emits facts
 * (add to cart, purchase); the consent-gated tracker subscribes only after the
 * shopper accepts. With no subscriber, events are simply dropped.
 * Has no dependencies so emitting never loads tracking code.
 */
import type { StorefrontEvent } from '@/domain/tracking'

type Listener = (ev: StorefrontEvent) => void
const listeners = new Set<Listener>()

export function emitStorefrontEvent(ev: StorefrontEvent): void {
  for (const l of listeners) {
    try {
      l(ev)
    } catch {
      /* a broken third-party script must never break the shop */
    }
  }
}

export function onStorefrontEvent(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
