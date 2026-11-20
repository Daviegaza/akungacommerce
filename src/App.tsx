import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/components/shared/ThemeProvider'
import { ReducedMotionProvider } from '@/components/shared/ReducedMotion'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { PageTransition } from '@/components/shared/PageTransition'
import { ScrollProgress } from '@/components/shared/ScrollProgress'
import { ToastContainer } from '@/components/ui/toast'
import { KeyboardShortcuts } from '@/components/shared/KeyboardShortcuts'
import { ProductDetailSkeleton } from '@/components/ui/skeleton'
import { HostHome } from '@/storefront/HostHome'

const HomePage = lazy(() => import('@/pages/HomePage'))
const ProductListPage = lazy(() => import('@/pages/ProductListPage'))
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'))
const CartPage = lazy(() => import('@/pages/CartPage'))
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'))
const AccountPage = lazy(() => import('@/pages/AccountPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage'))
// Merchant workspace (the commerce operating system) lives under /app.
const WorkspaceApp = lazy(() => import('@/app/WorkspaceApp'))
// Rafu product landing ("/"), public merchant shops ("/s/:slug") and buyer order tracking ("/t/:token").
const LandingPage = lazy(() => import('@/landing/LandingPage'))
const StorefrontApp = lazy(() => import('@/storefront/StorefrontApp'))
const TrackPage = lazy(() => import('@/storefront/pages/TrackPage'))
const RiderPage = lazy(() => import('@/storefront/pages/RiderPage'))

function PageLoader() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <ProductDetailSkeleton />
    </div>
  )
}

/** Calm full-screen placeholder for the Rafu surfaces while their code loads. */
function RafuLoader() {
  return (
    <div className="ak-root flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <span className="size-8 animate-pulse rounded-xl bg-brand" aria-hidden />
    </div>
  )
}

function RouteWrapper({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>
}

/**
 * The original storefront template, kept intact as the public shop prototype.
 * Its home moved from "/" to "/classic" (the Rafu landing owns "/"); every other route is unchanged.
 */
function Storefront() {
  return (
    <>
      <KeyboardShortcuts />
      <ScrollProgress />
      <div className="flex min-h-screen flex-col bg-surface-50 dark:bg-surface-950 transition-colors duration-300">
        <Navbar />
        <main className="flex-1">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/classic" element={<RouteWrapper><HomePage /></RouteWrapper>} />
              <Route path="/products" element={<RouteWrapper><ProductListPage /></RouteWrapper>} />
              <Route path="/products/:id" element={<RouteWrapper><ProductDetailPage /></RouteWrapper>} />
              <Route path="/cart" element={<RouteWrapper><CartPage /></RouteWrapper>} />
              <Route path="/checkout" element={<RouteWrapper><CheckoutPage /></RouteWrapper>} />
              <Route path="/account" element={<RouteWrapper><AccountPage /></RouteWrapper>} />
              <Route path="/search" element={<RouteWrapper><SearchPage /></RouteWrapper>} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
      <ToastContainer />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ReducedMotionProvider>
          <Routes>
            <Route
              path="/"
              element={
                <Suspense fallback={<RafuLoader />}>
                  {/* On a verified custom domain, "/" opens that merchant's shop. */}
                  <HostHome landing={<LandingPage />} />
                </Suspense>
              }
            />
            <Route
              path="/s/:slug/*"
              element={
                <Suspense fallback={<RafuLoader />}>
                  <StorefrontApp />
                </Suspense>
              }
            />
            <Route
              path="/t/:token"
              element={
                <Suspense fallback={<RafuLoader />}>
                  <TrackPage />
                </Suspense>
              }
            />
            <Route
              path="/r/:token"
              element={
                <Suspense fallback={<RafuLoader />}>
                  <RiderPage />
                </Suspense>
              }
            />
            <Route
              path="/app/*"
              element={
                <Suspense fallback={null}>
                  <WorkspaceApp />
                </Suspense>
              }
            />
            <Route path="*" element={<Storefront />} />
          </Routes>
        </ReducedMotionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
