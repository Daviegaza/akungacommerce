import { Settings, Package, Heart, MapPin, LogOut, ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

const mockUser = {
  name: 'Alex Johnson',
  email: 'alex@example.com',
  avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80',
  memberSince: '2025-08-15',
}

const recentOrders = [
  { id: 'AK-ORD-001', date: '2026-04-28', status: 'delivered' as const, total: 299.99 },
  { id: 'AK-ORD-002', date: '2026-04-20', status: 'shipped' as const, total: 149.99 },
  { id: 'AK-ORD-003', date: '2026-04-10', status: 'processing' as const, total: 449.99 },
]

const statusStyles = {
  delivered: 'success',
  shipped: 'info',
  processing: 'warning',
  cancelled: 'danger',
} as const

export function ProfileCard() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Profile header */}
      <div className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <Avatar src={mockUser.avatar} alt={mockUser.name} fallback={mockUser.name} size="xl" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">{mockUser.name}</h1>
            <p className="text-surface-500 dark:text-surface-400 mt-0.5">{mockUser.email}</p>
            <p className="text-xs text-surface-400 mt-2">Member since {formatDate(mockUser.memberSince)}</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-xl border-2 border-surface-200 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-all">
            <Settings className="h-4 w-4" />
            Edit Profile
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-8">
          {[
            { icon: Package, label: 'Orders', value: '12' },
            { icon: Heart, label: 'Wishlist', value: '8' },
            { icon: MapPin, label: 'Addresses', value: '2' },
            { icon: Settings, label: 'Preferences', value: '' },
          ].map(({ icon: Icon, label, value }) => (
            <button
              key={label}
              className="flex items-center gap-3 rounded-xl bg-surface-50 dark:bg-surface-800/50 p-4 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all text-left"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-bold text-surface-900 dark:text-white">{value || '—'}</p>
                <p className="text-xs text-surface-400">{label}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Recent orders */}
      <div className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-6 sm:p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-surface-900 dark:text-white">Recent Orders</h2>
          <button className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
            View All <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {recentOrders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between rounded-xl bg-surface-50 dark:bg-surface-800/50 p-4 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all"
            >
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{order.id}</p>
                <p className="text-xs text-surface-400 mt-0.5">{formatDate(order.date)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-surface-900 dark:text-white">
                  ${order.total.toFixed(2)}
                </p>
                <Badge variant={statusStyles[order.status]} className="mt-0.5">
                  {order.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Logout */}
      <button className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-red-200 dark:border-red-800 py-3 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
        <LogOut className="h-4 w-4" />
        Sign Out
      </button>
    </div>
  )
}
