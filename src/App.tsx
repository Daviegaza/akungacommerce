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

const HomePage = lazy(() => import('@/pages/HomePage'))
const ProductListPage = lazy(() => import('@/pages/ProductListPage'))
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'))
const CartPage = lazy(() => import('@/pages/CartPage'))
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'))
const AccountPage = lazy(() => import('@/pages/AccountPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage'))
// Merchant workspace (the commerce operating system) lives under /app.
const WorkspaceApp = lazy(() => import('@/app/WorkspaceApp'))

function PageLoader() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <ProductDetailSkeleton />
    </div>
  )
}

function RouteWrapper({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>
}

/** The original storefront template, kept intact as the public shop prototype. */
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
              <Route path="/" element={<RouteWrapper><HomePage /></RouteWrapper>} />
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
