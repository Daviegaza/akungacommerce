import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/components/shared/ThemeProvider'
import { ReducedMotionProvider } from '@/components/shared/ReducedMotion'
import { HostHome } from '@/storefront/HostHome'

// Every surface is its own chunk, so a shopper on /s/:slug never downloads the merchant
// workspace, the classic template or the landing page (and vice versa).
// Merchant workspace (the commerce operating system) lives under /app.
const WorkspaceApp = lazy(() => import('@/app/WorkspaceApp'))
// Fungua product landing ("/"), public merchant shops ("/s/:slug") and buyer order tracking ("/t/:token").
const LandingPage = lazy(() => import('@/landing/LandingPage'))
const StorefrontApp = lazy(() => import('@/storefront/StorefrontApp'))
const TrackPage = lazy(() => import('@/storefront/pages/TrackPage'))
const RiderPage = lazy(() => import('@/storefront/pages/RiderPage'))
// The original storefront template (/classic, /products, /cart ...), kept for reference in DEVELOPMENT
// only: it uses mock products and invented testimonials, so production builds show a not-found page.
const ClassicStorefront = lazy(() => import('@/ClassicStorefront'))
const PublicNotFound = lazy(() => import('@/storefront/components/States').then((m) => ({ default: m.PublicNotFound })))
// Public legal pages (draft, pending legal review). Same in demo and Supabase modes.
const PrivacyPage = lazy(() => import('@/legal/LegalPage').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('@/legal/LegalPage').then((m) => ({ default: m.TermsPage })))

/** Calm full-screen placeholder for the Fungua surfaces while their code loads. */
function AppLoader() {
  return (
    <div className="ak-root flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <span className="size-8 animate-pulse rounded-xl bg-brand" aria-hidden />
    </div>
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
                <Suspense fallback={<AppLoader />}>
                  {/* On a verified custom domain, "/" opens that merchant's shop. */}
                  <HostHome landing={<LandingPage />} />
                </Suspense>
              }
            />
            <Route
              path="/s/:slug/*"
              element={
                <Suspense fallback={<AppLoader />}>
                  <StorefrontApp />
                </Suspense>
              }
            />
            <Route
              path="/t/:token"
              element={
                <Suspense fallback={<AppLoader />}>
                  <TrackPage />
                </Suspense>
              }
            />
            <Route
              path="/r/:token"
              element={
                <Suspense fallback={<AppLoader />}>
                  <RiderPage />
                </Suspense>
              }
            />
            <Route
              path="/legal/privacy"
              element={
                <Suspense fallback={<AppLoader />}>
                  <PrivacyPage />
                </Suspense>
              }
            />
            <Route
              path="/legal/terms"
              element={
                <Suspense fallback={<AppLoader />}>
                  <TermsPage />
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
            <Route
              path="*"
              element={
                <Suspense fallback={<AppLoader />}>
                  {import.meta.env.DEV ? <ClassicStorefront /> : <PublicNotFound />}
                </Suspense>
              }
            />
          </Routes>
        </ReducedMotionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
