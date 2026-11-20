import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Home,
  LogOut,
  Moon,
  MoreHorizontal,
  Package,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  Truck,
  Users,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { FunguaLogo, FunguaMark } from '@/brand/FunguaLogo'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useGateway, useOrg } from './context'
import { Sheet } from './ui/layout'
import { IconButton, buttonClass } from './ui/primitives'
import {
  LiveFeedSheet,
  playChime,
  shopUrl,
  useChimeSetting,
  useLiveFeed,
  useLiveOrders,
  useLocalString,
  useMilestone,
  useSaleChime,
  useShopSettings,
} from './live'

// Loaded on the first milestone only, so framer-motion stays out of the workspace's first load.
const Celebration = lazy(() => import('./live/Celebration').then((m) => ({ default: m.Celebration })))

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { to: '/app', label: 'Today', icon: Home, end: true },
      { to: '/app/orders', label: 'Orders', icon: Receipt },
      { to: '/app/fulfilment', label: 'Fulfilment', icon: Truck },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/app/products', label: 'Products', icon: Package },
      { to: '/app/inventory', label: 'Inventory', icon: Boxes },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/app/customers', label: 'Customers', icon: Users },
      { to: '/app/payments', label: 'Payments', icon: CreditCard },
      { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Channels',
    items: [
      { to: '/app/shop', label: 'Storefront', icon: Store },
      { to: '/app/tools', label: 'Selling tools', icon: Wrench },
      { to: '/app/trust', label: 'Trust', icon: ShieldCheck },
    ],
  },
  { label: null, items: [{ to: '/app/settings', label: 'Settings', icon: Settings }] },
]
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

const MOBILE_PRIMARY = ['/app', '/app/orders', '/app/products']

export function DemoBanner() {
  const gateway = useGateway()
  if (gateway.mode !== 'demo') return null
  return (
    <div className="flex items-center justify-center gap-2 border-b border-line bg-sunken px-4 py-1 text-center text-[11px] leading-5 font-medium text-ink-2">
      <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
      <span>
        <strong className="font-semibold text-ink">Demo workspace</strong> · fictional data kept in this browser<span className="hidden sm:inline">. Nothing is sent, charged or delivered</span>.
      </span>
    </div>
  )
}

function OrgSwitcher({ compact }: { compact?: boolean }) {
  const { org, orgs, switchOrg } = useOrg()
  if (orgs.length < 2) {
    return <span className={cn('block truncate font-semibold text-ink', compact ? 'text-sm' : 'text-[15px]')}>{org.name}</span>
  }
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">Switch business</span>
      <select
        value={org.id}
        onChange={(e) => switchOrg(e.target.value)}
        className={cn(
          'w-full max-w-[220px] cursor-pointer appearance-none truncate rounded-md bg-transparent py-1 pr-6 pl-0 font-semibold text-ink hover:text-ink-2 focus:outline-none',
          compact ? 'text-sm' : 'text-[15px]',
        )}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.baseCurrency}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2 text-ink-3" />
    </label>
  )
}

function ThemeButton() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <IconButton onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}>
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </IconButton>
  )
}

function ChimeButton() {
  const [on, setOn] = useChimeSetting()
  return (
    <IconButton
      onClick={() => {
        const next = !on
        setOn(next)
        // Playing on the click both previews the sound and unlocks audio for later chimes.
        if (next) playChime()
      }}
      aria-label="Sale chime"
      aria-pressed={on}
      title={on ? 'Sale chime on: plays when a new order arrives' : 'Sale chime off'}
      className={on ? 'text-brand hover:text-brand' : undefined}
    >
      {on ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
    </IconButton>
  )
}

function BellButton({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <IconButton onClick={onClick} aria-label={unread > 0 ? `Activity, ${unread} new` : 'Activity'} aria-haspopup="dialog" title="Activity">
      <Bell className="size-[18px]" />
      {unread > 0 && (
        <span className="tnum ak-pop absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand ring-2 ring-canvas">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </IconButton>
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
      className={className ?? 'flex size-11 items-center justify-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink'}
      aria-label="Sign out"
      title="Sign out"
    >
      {children ?? <LogOut className="size-[18px]" />}
    </button>
  )
}

function CountDot({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span className={cn('tnum flex h-5 min-w-5 items-center justify-center rounded-md bg-brand px-1.5 text-[11px] font-semibold text-on-brand', className)}>
      {count > 99 ? '99+' : count}
      <span className="sr-only"> to confirm</span>
    </span>
  )
}

function SideNav({ toConfirm }: { toConfirm: number }) {
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label ?? gi} className="flex flex-col gap-px">
          {group.label && <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-3 uppercase">{group.label}</p>}
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('size-[17px]', isActive ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2')} aria-hidden />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.to === '/app/orders' && <CountDot count={toConfirm} />}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function ViewShopLink({ slug, className, onClick }: { slug: string; className?: string; onClick?: () => void }) {
  return (
    <a href={shopUrl(slug)} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
      <ExternalLink className="size-[18px] text-ink-3" aria-hidden />
      View shop
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function MobileNav({ toConfirm, slug }: { toConfirm: number; slug: string | null }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()
  const { can } = useOrg()
  const secondary = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to))
  const moreActive = secondary.some((n) => pathname.startsWith(n.to))
  const tab = (active: boolean) =>
    cn(
      'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
      active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
    )

  return (
    <>
      <nav
        aria-label="Workspace"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(14,20,32,0.06)] backdrop-blur-xl md:hidden"
      >
        <div className="flex h-[68px] items-stretch">
          <NavLink to="/app" end className={({ isActive }) => tab(isActive)}>
            <Home className="size-[22px]" aria-hidden />
            Today
          </NavLink>
          <NavLink to="/app/orders" className={({ isActive }) => tab(isActive)}>
            <span className="relative">
              <Receipt className="size-[22px]" aria-hidden />
              <CountDot count={toConfirm} className="absolute -top-2 -right-3 h-[18px] min-w-[18px] px-1 text-[10px] ring-2 ring-panel" />
            </span>
            Orders
          </NavLink>
          {can('orders.create') ? (
            <Link to="/app/orders/new" className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-ink">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-on-brand" aria-hidden>
                <Plus className="size-[18px]" strokeWidth={2.5} />
              </span>
              New order
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          <NavLink to="/app/products" className={({ isActive }) => tab(isActive)}>
            <Package className="size-[22px]" aria-hidden />
            Products
          </NavLink>
          <button type="button" onClick={() => setMoreOpen(true)} className={tab(moreActive)} aria-haspopup="dialog">
            <MoreHorizontal className="size-[22px]" aria-hidden />
            More
          </button>
        </div>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="-mx-2 flex flex-col">
          {secondary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn('flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium', isActive ? 'bg-sunken text-ink' : 'text-ink-2 hover:bg-sunken')
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('size-5', isActive ? 'text-ink' : 'text-ink-3')} aria-hidden />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
          {slug && (
            <ViewShopLink
              slug={slug}
              onClick={() => setMoreOpen(false)}
              className="flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-ink-2 hover:bg-sunken"
            />
          )}
          <div className="my-2 border-t border-line" />
          <SignOutButton className="flex h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-ink-2 hover:bg-sunken">
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
  const orders = useLiveOrders()
  const shop = useShopSettings()
  const [chimeOn] = useChimeSetting()
  useSaleChime(orders.data, org.id, chimeOn)
  const { milestone, dismiss } = useMilestone(orders.data, org.id)
  // The celebration (and framer-motion) loads the first time a milestone is reached, then stays mounted for its exit animation.
  const [celebrationLoaded, setCelebrationLoaded] = useState(false)
  if (milestone != null && !celebrationLoaded) setCelebrationLoaded(true)

  const feed = useLiveFeed(40)
  const [seen, setSeen] = useLocalString(`rafu.feedSeen.${org.id}`)
  const [feedOpen, setFeedOpen] = useState(false)
  const [openedAfter, setOpenedAfter] = useState<string | null>(null)
  const newest = feed.items[0]?.at ?? null

  // First visit on this device: start counting from what is already there.
  useEffect(() => {
    if (seen == null && newest && !feed.isPending) setSeen(newest)
  }, [seen, newest, feed.isPending, setSeen])

  const unread = seen ? feed.items.filter((i) => i.at > seen).length : 0
  const toConfirm = (orders.data ?? []).filter((o) => o.status === 'pending_confirmation' || o.status === 'draft').length
  const slug = shop.data?.slug ?? null

  const openFeed = () => {
    setOpenedAfter(seen)
    if (newest && (!seen || newest > seen)) setSeen(newest)
    setFeedOpen(true)
  }

  return (
    <div className="ak-root min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DemoBanner />
      <div className="md:grid md:grid-cols-[248px_1fr] xl:grid-cols-[264px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-panel px-4 py-5 md:flex">
          <Link to="/app" className="mb-6 self-start rounded-lg px-2 py-1.5" aria-label="Fungua, go to Today">
            <FunguaLogo size={22} />
          </Link>
          <div className="mb-5 rounded-xl border border-line bg-canvas/70 px-3 py-3">
            <OrgSwitcher />
            <p className="mt-0.5 truncate text-xs text-ink-3">
              {org.baseCurrency} · {org.timezone.replace(/_/g, ' ')}
            </p>
          </div>
          {can('orders.create') && (
            <Link to="/app/orders/new" className={buttonClass('primary', 'sm', 'mb-4 w-full')}>
              <Plus className="size-4" strokeWidth={2.5} aria-hidden /> New order
            </Link>
          )}
          <SideNav toConfirm={toConfirm} />
          <div className="mt-auto pt-4">
            {slug && (
              <ViewShopLink
                slug={slug}
                className="mb-1 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              />
            )}
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="px-2 text-xs font-medium text-ink-3 capitalize">{org.role}</span>
              <div className="flex">
                <ThemeButton />
                <SignOutButton />
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-line/80 bg-canvas/95 px-4 backdrop-blur-xl sm:px-6 md:justify-end lg:px-9">
            <div className="flex min-w-0 items-center gap-2.5 md:hidden">
              <Link to="/app" aria-label="Fungua, go to Today" className="shrink-0 rounded-lg">
                <FunguaMark size={26} />
              </Link>
              <div className="min-w-0">
                <OrgSwitcher compact />
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <ChimeButton />
              <BellButton unread={unread} onClick={openFeed} />
              <span className="md:hidden">
                <ThemeButton />
              </span>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1320px] px-4 pt-7 pb-28 sm:px-6 md:pb-16 lg:px-10 lg:pt-9">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav toConfirm={toConfirm} slug={slug} />
      <LiveFeedSheet open={feedOpen} onOpenChange={setFeedOpen} items={feed.items} loading={feed.isPending} unreadAfter={openedAfter} />
      {celebrationLoaded && (
        <Suspense fallback={null}>
          <Celebration milestone={milestone} onDismiss={dismiss} />
        </Suspense>
      )}
    </div>
  )
}
