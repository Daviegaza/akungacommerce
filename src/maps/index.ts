import { lazy } from 'react'

/**
 * Public map API. The MapLibre bundle (~450 KB) lives in the lazily imported
 * modules below, so it only loads on screens that actually render a map.
 * Wrap usages in <Suspense fallback={<MapFallback height={...} />}>.
 */
export const PinPicker = lazy(() => import('./PinPickerMap'))
export const StaticMap = lazy(() => import('./StaticMapView'))
export { MapFallback } from './MapFallback'
export type { LatLng, MapCircle, MapMarker, MapMarkerKind, PinPickerProps, StaticMapProps } from './types'
