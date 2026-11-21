import { useMemo } from 'react'
import { available, stockHealth } from '@/domain/inventory'
import { formatMoney, money } from '@/domain/money'
import { ORDER_STATUS_LABEL } from '@/domain/orders'
import { useMovements, useOrders, useOrg, usePayments, useProducts } from '../context'
import { CHANNEL_LABEL, type OrderSummary, type Payment, type Product, type StockMovement } from '@/gateway/types'

export type FeedKind = 'order' | 'status' | 'payment' | 'reversal' | 'stock'

export interface FeedItem {
  id: string
  kind: FeedKind
  /** ISO time the event happened (or was recorded). */
  at: string
  title: string
  detail: string
  href: string
  /** Person to show as an avatar, when there is one. */
  person: string | null
}

export interface FeedInput {
  orders?: OrderSummary[]
  payments?: Payment[]
  products?: Product[]
  movements?: StockMovement[]
  locale: string
}

/**
 * A truthful activity feed derived from data the workspace already has:
 * orders placed, an order's current status (at its last update), payments
 * recorded or reversed, and variants currently at or below their low-stock level.
 * Nothing is invented; items without a real timestamp are left out.
 */
export function buildFeed({ orders = [], payments = [], products = [], movements = [], locale }: FeedInput): FeedItem[] {
  const items: FeedItem[] = []
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale)

  for (const o of orders) {
    if (o.status === 'draft') continue
    const who = o.customerName ?? 'Walk-in customer'
    items.push({
      id: `o-${o.id}`,
      kind: 'order',
      at: o.createdAt,
      title: `New order #${o.number}`,
      detail: `${who} · ${fmt(o.totalMinor, o.currency)} · ${CHANNEL_LABEL[o.channel]}`,
      href: `/app/orders/${o.id}`,
      person: o.customerName,
    })
    const moved = Date.parse(o.updatedAt) - Date.parse(o.createdAt) > 1000
    if (moved && o.status !== 'pending_confirmation') {
      items.push({
        id: `s-${o.id}-${o.status}`,
        kind: 'status',
        at: o.updatedAt,
        title: `#${o.number} is ${ORDER_STATUS_LABEL[o.status].toLowerCase()}`,
        detail: who,
        href: `/app/orders/${o.id}`,
        person: o.customerName,
      })
    }
  }

  for (const p of payments) {
    const ref = p.orderNumber != null ? `#${p.orderNumber}` : 'an order'
    if (p.status === 'succeeded') {
      items.push({
        id: `p-${p.id}`,
        kind: 'payment',
        at: p.createdAt,
        title: `${fmt(p.amountMinor, p.currency)} received`,
        detail: `For ${ref} · ${p.verification === 'provider_verified' ? 'provider verified' : 'recorded manually, unverified'}`,
        href: `/app/orders/${p.orderId}`,
        person: null,
      })
    } else if (p.status === 'reversed') {
      items.push({
        id: `r-${p.id}`,
        kind: 'reversal',
        at: p.createdAt,
        title: `${fmt(p.amountMinor, p.currency)} payment reversed`,
        detail: `For ${ref}${p.reversedReason ? ` · ${p.reversedReason}` : ''}`,
        href: `/app/orders/${p.orderId}`,
        person: null,
      })
    }
  }

  // Latest movement per variant gives an honest "when" for a low-stock state.
  const lastMove = new Map<string, string>()
  for (const m of movements) {
    const prev = lastMove.get(m.variantId)
    if (!prev || m.createdAt > prev) lastMove.set(m.variantId, m.createdAt)
  }
  for (const p of products) {
    if (p.status !== 'active' || !p.trackStock) continue
    for (const v of p.variants) {
      if (!v.isActive) continue
      const health = stockHealth(v, v.lowStockThreshold)
      if (health === 'ok') continue
      const at = lastMove.get(v.id) ?? p.updatedAt
      const name = v.name === 'Default' ? p.name : `${p.name} · ${v.name}`
      items.push({
        id: `k-${v.id}`,
        kind: 'stock',
        at,
        title: health === 'out' ? `${name} is out of stock` : `${name} is running low`,
        detail: health === 'out' ? 'Receive stock to keep selling' : `${available(v)} left`,
        href: '/app/inventory',
        person: null,
      })
    }
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/**
 * Live activity feed for the current organisation. Orders are polled by the
 * shell (useLiveOrders), so new orders appear here within ~20 s.
 */
export function useLiveFeed(limit?: number) {
  const { org } = useOrg()
  const orders = useOrders()
  const payments = usePayments()
  const products = useProducts()
  const movements = useMovements()
  const items = useMemo(() => {
    const all = buildFeed({ orders: orders.data, payments: payments.data, products: products.data, movements: movements.data, locale: org.locale })
    return limit ? all.slice(0, limit) : all
  }, [orders.data, payments.data, products.data, movements.data, org.locale, limit])
  return {
    items,
    isPending: orders.isPending,
    error: orders.error ?? payments.error ?? null,
    refetch: () => {
      void orders.refetch()
      void payments.refetch()
    },
  }
}
