import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppProviders, OrgProvider, useOrganisations, useSessionUser } from './context'
import { AppShell } from './AppShell'
import { OnboardingPage, SignInPage } from './pages/AuthPages'
import { ErrorNotice } from './ui/layout'
import { Spinner } from './ui/primitives'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const OrdersPage = lazy(() => import('./pages/OrdersPage'))
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'))
const ProductsPage = lazy(() => import('./pages/ProductsPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const FulfilmentPage = lazy(() => import('./pages/FulfilmentPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ShopSettingsPage = lazy(() => import('./pages/ShopSettingsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const ProductImportPage = lazy(() => import('./pages/ProductImportPage'))
const SellingToolsPage = lazy(() => import('./pages/SellingToolsPage'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const JoinTeamPage = lazy(() => import('./pages/JoinTeamPage'))

function FullPageLoader() {
  return (
    <div className="ak-root flex min-h-dvh items-center justify-center">
      <Spinner />
    </div>
  )
}

function Gate() {
  const session = useSessionUser()
  const orgs = useOrganisations(Boolean(session.data))

  if (session.isPending) return <FullPageLoader />
  if (!session.data) return <SignInPage />
  if (orgs.isPending) return <FullPageLoader />
  if (orgs.isError)
    return (
      <div className="ak-root min-h-dvh p-6">
        <ErrorNotice error={orgs.error} onRetry={() => orgs.refetch()} />
      </div>
    )
  if (!orgs.data?.length) return <OnboardingPage />

  return (
    <OrgProvider orgs={orgs.data}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="*"
            element={
              <Suspense fallback={<Spinner />}>
                <Routes>
                  <Route index element={<DashboardPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="orders/new" element={<NewOrderPage />} />
                  <Route path="orders/:orderId" element={<OrderDetailPage />} />
                  <Route path="orders/:orderId/invoice" element={<InvoicePage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/import" element={<ProductImportPage />} />
                  <Route path="tools" element={<SellingToolsPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:customerId" element={<CustomerDetailPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="fulfilment" element={<FulfilmentPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="shop" element={<ShopSettingsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </OrgProvider>
  )
}

export default function WorkspaceApp() {
  return (
    <AppProviders fallback={<FullPageLoader />}>
      <Routes>
        {/* Staff invitation links work before the person belongs to any business. */}
        <Route
          path="join/:token"
          element={
            <Suspense fallback={<FullPageLoader />}>
              <JoinTeamPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Gate />} />
      </Routes>
    </AppProviders>
  )
}
