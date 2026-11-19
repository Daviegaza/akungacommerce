import type { LatLng, MapCircle } from './types'
import type { FeatureCollection, Polygon } from 'geojson'

const EARTH_RADIUS_KM = 6371.0088

/** A geodesic circle approximated as a closed polygon ring of `points` vertices ([lng, lat] pairs). */
export function circleRing(center: LatLng, radiusKm: number, points = 64): [number, number][] {
  const lat1 = (center.lat * Math.PI) / 180
  const lng1 = (center.lng * Math.PI) / 180
  const d = radiusKm / EARTH_RADIUS_KM
  const ring: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const bearing = (i / points) * 2 * Math.PI
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing))
    const lng2 =
      lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  ring.push(ring[0])
  return ring
}

export function circlesToGeoJSON(circles: MapCircle[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: circles.map((c, i) => ({
      type: 'Feature',
      id: i,
      properties: { label: c.label ?? '', radiusKm: c.radiusKm },
      geometry: { type: 'Polygon', coordinates: [circleRing(c, c.radiusKm, 64)] },
    })),
  }
}

/** [[west, south], [east, north]] covering all points and circle extents, or null when empty. */
export function boundsFor(points: LatLng[], circles: MapCircle[] = []): [[number, number], [number, number]] | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const extend = (lat: number, lng: number) => {
    w = Math.min(w, lng)
    e = Math.max(e, lng)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  for (const p of points) extend(p.lat, p.lng)
  for (const c of circles) {
    const dLat = c.radiusKm / 110.574
    const dLng = c.radiusKm / (111.32 * Math.max(Math.cos((c.lat * Math.PI) / 180), 0.01))
    extend(c.lat - dLat, c.lng - dLng)
    extend(c.lat + dLat, c.lng + dLng)
  }
  if (!Number.isFinite(w)) return null
  return [
    [w, s],
    [e, n],
  ]
}

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
}
