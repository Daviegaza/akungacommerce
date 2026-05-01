import type { User } from '@/types'

export const mockUser: User = {
  id: 'user-001',
  name: 'Alex Johnson',
  email: 'alex@example.com',
  avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80',
  wishlist: ['aura-pro', 'pulse-s3', 'nomad-backpack', 'mech-keyboard-elite'],
  createdAt: '2025-08-15',
  orders: [
    {
      id: 'AK-ORD-20260428-001',
      date: '2026-04-28',
      status: 'delivered',
      total: 449.98,
      items: [],
      trackingNumber: '1Z999AA10123456784',
    },
    {
      id: 'AK-ORD-20260420-002',
      date: '2026-04-20',
      status: 'shipped',
      total: 149.99,
      items: [],
      trackingNumber: '1Z999AA10123456892',
    },
    {
      id: 'AK-ORD-20260410-003',
      date: '2026-04-10',
      status: 'processing',
      total: 629.98,
      items: [],
      trackingNumber: null,
    },
    {
      id: 'AK-ORD-20260305-004',
      date: '2026-03-05',
      status: 'delivered',
      total: 89.99,
      items: [],
      trackingNumber: '1Z999AA10123456601',
    },
  ],
  addresses: [
    {
      id: 'addr-001',
      label: 'Home',
      street: '742 Evergreen Terrace',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
      country: 'United States',
      isDefault: true,
    },
    {
      id: 'addr-002',
      label: 'Office',
      street: '1234 Market Street, Suite 500',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
      country: 'United States',
      isDefault: false,
    },
  ],
}

export const savedCards = [
  { id: 'card-001', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2027, isDefault: true },
  { id: 'card-002', brand: 'Mastercard', last4: '8888', expMonth: 8, expYear: 2026, isDefault: false },
]
