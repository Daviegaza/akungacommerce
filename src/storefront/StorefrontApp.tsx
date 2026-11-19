import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ShoppingBag } from 'lucide-react'
import type { PublicShop } from '@/gateway/storefront'
import { useCart } from './cart'
import { CartDrawer } from './components/CartDrawer'
import { useStorefront } from './components/hooks'
import { HomeSkeleton, LoadError, ProductNotFound, ProductSkeleton, ShopNotFound } from './components/States'
import { fmtMoney, isNotFoundError, shopPath } from './components/storefront-utils'
import ProductPage from './pages/ProductPage'
import ShopHome from './pages/ShopHome'
import WishlistPage from './pages/WishlistPage'

const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))

/** Public shopper storefront, mounted at /s/:slug/*. */
export default function StorefrontApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) => !isNotFoundError(err) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  return (
    <div className="ak-root min-h-dvh">
      <QueryClientProvider client={client}>
        <StorefrontShell />
      </QueryClientProvider>
    </div>
  )
}

function StorefrontShell() {
  const { slug = '' } = useParams()
  const { pathname } = useLocation()
  const query = useStorefront(slug)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  if (query.isPending) {
    return /\/p\/[^/]+\/?$/.test(pathname) ? <ProductSkeleton /> : <HomeSkeleton />
  }
  if (query.isError) {
    if (isNotFoundError(query.error)) return <ShopNotFound />
    return <LoadError onRetry={() => void query.refetch()} />
  }

  const data = query.data
  const onProduct = /\/p\/[^/]+\/?$/.test(pathname)
  const onCheckout = /\/checkout\/?$/.test(pathname)

  return (
    <>
      <Routes>
        <Route index element={<ShopHome slug={slug} data={data} />} />
        <Route path="p/:productId" element={<ProductPage slug={slug} data={data} />} />
        <Route
          path="checkout"
          element={
            <Suspense fallback={<ProductSkeleton />}>
              <CheckoutPage />
            </Suspense>
          }
        />
        <Route path="wishlist" element={<WishlistPage slug={slug} data={data} />} />
        <Route path="*" element={<ProductNotFound homeHref={shopPath(slug)} />} />
      </Routes>
      <CartDrawer slug={slug} shop={data.shop} />
      {!onProduct && !onCheckout && <CartPill slug={slug} shop={data.shop} />}
    </>
  )
}

/** Sticky bottom cart pill on phones once something is in the cart. */
function CartPill({ slug, shop }: { slug: string; shop: PublicShop }) {
  const cart = useCart(slug)
  const reduce = useReducedMotion()
  const show = cart.count > 0 && !cart.isOpen
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 96, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden"
        >
          <button
            type="button"
            onClick={cart.open}
            className="flex h-14 w-full items-center gap-3 rounded-2xl bg-brand pr-4 pl-2 text-on-brand shadow-[0_12px_32px_-10px_var(--ak-brand)] active:scale-[0.99]"
          >
            <span className="relative grid size-10 place-items-center rounded-xl bg-white/20">
              <ShoppingBag className="size-5" aria-hidden />
              <span
                key={cart.count}
                className="ak-pop absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-brand tnum"
              >
                {cart.count}
              </span>
            </span>
            <span className="flex-1 text-left text-[15px] font-semibold">View cart</span>
            <span className="font-display text-lg font-extrabold tnum">
              {fmtMoney(cart.subtotalMinor, cart.currency ?? shop.currency, shop.locale)}
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
