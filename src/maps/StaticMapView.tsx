import './setup'
import { useMemo } from 'react'
import { Layer, Map as MapGL, Marker, Source } from '@vis.gl/react-maplibre'
import { MAP_COLORS, MAP_STYLE_URL } from './config'
import { boundsFor, circlesToGeoJSON, isValidLatLng } from './geo'
import type { MapMarker, StaticMapProps } from './types'

const KIND_LABEL: Record<MapMarker['kind'], string> = {
  shop: 'Shop',
  drop: 'Drop-off',
  order: 'Order',
}

function markerText(m: MapMarker): string {
  return m.label ? `${KIND_LABEL[m.kind]}: ${m.label}` : KIND_LABEL[m.kind]
}

function Pin({ color, label }: { color: string; label: string }) {
  return (
    <div title={label}>
      <svg width="30" height="38" viewBox="0 0 36 46" className="drop-shadow-[0_3px_5px_rgb(22_15_30/0.35)]" aria-hidden>
        <path d="M18 45c-1.2-6-14-15.5-14-27a14 14 0 1 1 28 0c0 11.5-12.8 21-14 27Z" fill={color} stroke="#fff" strokeWidth="2.5" />
        <circle cx="18" cy="18" r="5.5" fill="#fff" />
      </svg>
    </div>
  )
}

function MarkerBody({ marker }: { marker: MapMarker }) {
  const label = markerText(marker)
  if (marker.kind === 'order') {
    return (
      <span
        title={label}
        className="block size-3.5 rounded-full border-2 border-white shadow-[0_1px_3px_rgb(22_15_30/0.4)]"
        style={{ background: MAP_COLORS.mango }}
      />
    )
  }
  // Shop = hibiscus pin, drop-off = ink pin (white stroke keeps it visible on dark tiles).
  return <Pin color={marker.kind === 'shop' ? 'var(--ak-brand)' : MAP_COLORS.ink} label={label} />
}

/** Read-only map with branded markers and optional zone circles (64-point polygons). */
export default function StaticMapView({
  markers,
  circles = [],
  height = 220,
  fitToMarkers = true,
  interactive = false,
}: StaticMapProps) {
  const valid = useMemo(() => markers.filter(isValidLatLng), [markers])
  const zones = useMemo(() => circles.filter((c) => isValidLatLng(c) && c.radiusKm > 0), [circles])
  const geojson = useMemo(() => circlesToGeoJSON(zones), [zones])

  const initialViewState = useMemo(() => {
    const pts = fitToMarkers ? valid : valid.slice(0, 1)
    const bounds = boundsFor(pts, fitToMarkers ? zones : [])
    const multi = pts.length > 1 || (fitToMarkers && zones.length > 0)
    if (bounds && multi) return { bounds, fitBoundsOptions: { padding: 48, maxZoom: 15 } }
    if (valid[0]) return { latitude: valid[0].lat, longitude: valid[0].lng, zoom: 14 }
    if (zones[0]) return { latitude: zones[0].lat, longitude: zones[0].lng, zoom: 11 }
    return { latitude: 0, longitude: 20, zoom: 1.5 }
  }, [valid, zones, fitToMarkers])

  const description = [
    ...valid.map(markerText),
    ...zones.map((z) => z.label ?? `${z.radiusKm} km zone`),
  ].join('; ')

  return (
    <figure style={{ height }} className="relative m-0 w-full overflow-hidden rounded-2xl border border-line bg-sunken">
      <figcaption className="sr-only">{description ? `Map showing ${description}` : 'Map'}</figcaption>
      <MapGL
        mapStyle={MAP_STYLE_URL}
        initialViewState={initialViewState}
        interactive={interactive}
        dragRotate={false}
        touchPitch={false}
        attributionControl={{ compact: false }}
        style={{ width: '100%', height: '100%' }}
      >
        {zones.length > 0 && (
          <Source id="rafu-zones" type="geojson" data={geojson}>
            <Layer id="rafu-zones-fill" type="fill" paint={{ 'fill-color': MAP_COLORS.hibiscus, 'fill-opacity': 0.08 }} />
            <Layer
              id="rafu-zones-line"
              type="line"
              paint={{ 'line-color': MAP_COLORS.hibiscus, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] }}
            />
          </Source>
        )}
        {valid.map((m, i) => (
          <Marker
            key={`${m.kind}-${i}-${m.lat}-${m.lng}`}
            latitude={m.lat}
            longitude={m.lng}
            anchor={m.kind === 'order' ? 'center' : 'bottom'}
          >
            <MarkerBody marker={m} />
          </Marker>
        ))}
      </MapGL>
    </figure>
  )
}
