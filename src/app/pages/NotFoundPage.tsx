import { Link, useLocation } from 'react-router-dom'
import { buttonClass } from '../ui/primitives'

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="max-w-lg py-10 sm:py-16">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-ink-3 uppercase">Page not found</p>
      <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">There is nothing at this address.</h1>
      <p className="mt-3 text-sm break-all text-ink-3">{pathname}</p>
      <p className="mt-3 text-sm text-ink-2">The link may be old, or the order or product may belong to another business you work with.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/app" className={buttonClass('primary')}>
          Back to Today
        </Link>
        <Link to="/app/orders" className={buttonClass('secondary')}>
          Orders
        </Link>
      </div>
    </div>
  )
}
