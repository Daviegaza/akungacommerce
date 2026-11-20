import { Link, useLocation } from 'react-router-dom'
import { buttonClass } from '../ui/primitives'

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center sm:py-24">
      <p className="text-[13px] text-ink-3">Page not found</p>
      <h1 className="mt-2 font-display text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-[30px]">There is nothing at this address</h1>
      <p className="mt-3 max-w-full rounded-md bg-sunken px-2 py-1 font-mono text-xs break-all text-ink-3">{pathname}</p>
      <p className="mt-4 text-sm leading-relaxed text-ink-2">The link may be old, or the order or product may belong to another business you work with.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
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
