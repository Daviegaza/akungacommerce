export interface LatLng {
  lat: number
  lng: number
}

export interface PinPickerProps {
  value: LatLng | null
  onChange(v: LatLng): void
  center: LatLng
  zoom?: number
  height?: number
  label?: string
}

export type MapMarkerKind = 'shop' | 'drop' | 'order'

export interface MapMarker {
  lat: number
  lng: number
  kind: MapMarkerKind
  label?: string
}

export interface MapCircle {
  lat: number
  lng: number
  radiusKm: number
  label?: string
}

export interface StaticMapProps {
  markers: MapMarker[]
  circles?: MapCircle[]
  height?: number
  fitToMarkers?: boolean
  interactive?: boolean
}
