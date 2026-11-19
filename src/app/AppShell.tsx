import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  CreditCard,
  Home,
  LogOut,
  Moon,
  MoreHorizontal,
  Package,
  Plus,
  Receipt,
  Settings,
  Sun,
  Truck,
  Users,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useGateway, useOrg } from './context'
import { Sheet } from './ui/layout'
import { buttonClass } from './ui/primitives'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Today', icon: Home, end: true },
  { to: '/app/orders', label: 'Orders', icon: Receipt },
  { to: '/app/fulfilment', label: 'Fulfilment', icon: Truck },
  { to: '/app/products', label: 'Products', icon: Package },
  { to: '/app/inventory', label: 'Inventory', icon: Boxes },
  { to: '/app/customers', label: 'Customers', icon: Users },
  { to: '/app/payments', label: 'Payments', icon: CreditCard },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

const MOBILE_PRIMARY = ['/app', '/app/orders', '/app/products']

export function DemoBanner() {
  const gateway = useGateway()
  if (gateway.mode !== 'demo') return null
  return (
    <div className="border-b border-warn/20 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
      Demo workspace · fictional data · stored only in this browser. Nothing is sent, charged or delivered.
    </div>
  )
}

function OrgSwitcher() {
  const { org, orgs, switchOrg } = useOrg()
  if (orgs.length < 2) {
    return <span className="truncate text-sm font-semibold text-ink">{org.name}</span>
  }
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">Switch business</span>
      <select
        value={org.id}
        onChange={(e) => switchOrg(e.target.value)}
        className="w-full max-w-[220px] cursor-pointer appearance-none truncate rounded-md bg-transparent py-1 pr-6 pl-0 text-sm font-semibold text-ink hover:text-ink-2 focus:outline-none"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.baseCurrency}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 text-ink-3">
        ▾
      </span>
    </label>
  )
}

function ThemeButton() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="rounded-md p-2 text-ink-3 hover:bg-sunken hover:text-ink"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

function SignOutButton({ className, children }: { className?: string; children?: ReactNode }) {
  const gateway = useGateway()
  const qc = useQueryClient()
  return (
    <button
      type="button"
      onClick={async () => {
        await gateway.signOut()
        qc.clear()
        qc.setQueryData(['session'], null)
      }}
      className={className ?? 'rounded-md p-2 text-ink-3 hover:bg-sunken hover:text-ink'}
      aria-label="Sign out"
    >
      {children ?? <LogOut className="size-4" />}
    </button>
  )
}

function SideNav() {
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
              isActive ? 'bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--ak-line)]' : 'text-ink-2 hover:bg-sunken hover:text-ink',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn('size-4', isActive ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')} aria-hidden />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()
  const { can } = useOrg()
  const secondary = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to))
  const moreActive = secondary.some((n) => pathname.startsWith(n.to))
  const tab = (active: boolean) =>
    cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-ink' : 'text-ink-3')

  return (
    <>
      <nav
        aria-label="Workspace"
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
          .slice(0, 2)
          .map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => tab(isActive)}>
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        {can('orders.create') ? (
          <Link to="/app/orders/new" className="flex flex-1 items-center justify-center" aria-label="New order">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg">
              <Plus className="size-5" />
            </span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        <NavLink to="/app/products" className={({ isActive }) => tab(isActive)}>
          <Package className="size-5" aria-hidden />
          Products
        </NavLink>
        <button type="button" onClick={() => setMoreOpen(true)} className={tab(moreActive)} aria-haspopup="dialog">
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="-mx-2 flex flex-col">
          {secondary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn('flex h-12 items-center gap-3 rounded-lg px-2 text-[15px]', isActive ? 'bg-sunken font-medium text-ink' : 'text-ink-2')
              }
            >
              <item.icon className="size-5 text-ink-3" aria-hidden />
              {item.label}
            </NavLink>
          ))}
          <SignOutButton className="flex h-12 items-center gap-3 rounded-lg px-2 text-left text-[15px] text-ink-2">
            <LogOut className="size-5 text-ink-3" aria-hidden />
            Sign out
          </SignOutButton>
        </div>
      </Sheet>
    </>
  )
}

export function AppShell() {
  const { org, can } = useOrg()
  return (
    <div className="ak-root min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DemoBanner />
      <div className="lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-4 lg:flex">
          <div className="mb-6 px-3">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-ink-3 uppercase">Akunga</p>
            <div className="mt-1">
              <OrgSwitcher />
            </div>
            <p className="mt-0.5 text-xs text-ink-3">
              {org.baseCurrency} · {org.timezone.replace(/_/g, ' ')}
            </p>
          </div>
          {can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('primary', 'md', 'mx-1 mb-4')}>
              <Plus className="size-4" aria-hidden /> New order
            </Link>
          )}
          <SideNav />
          <div className="mt-auto flex items-center justify-between px-1 pt-4">
            <span className="text-xs text-ink-3 capitalize">{org.role}</span>
            <div className="flex">
              <ThemeButton />
              <SignOutButton />
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
            <div className="min-w-0">
              <OrgSwitcher />
            </div>
            <ThemeButton />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav />
    </div>
  )
}
