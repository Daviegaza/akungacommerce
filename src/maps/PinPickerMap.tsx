import './setup'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Map as MapGL, NavigationControl, type MapRef, type ViewStateChangeEvent } from '@vis.gl/react-maplibre'
import { motion, useReducedMotion } from 'framer-motion'
import { LocateFixed, Loader2 } from 'lucide-react'
import { MAP_STYLE_URL } from './config'
import { isValidLatLng } from './geo'
import type { PinPickerProps } from './types'

const NUDGE_PX = 40

/**
 * Glovo-style picker: the pin stays fixed in the centre and the shopper moves
 * the map underneath it. Emits the centre on moveend (drag, zoom, keyboard
 * nudge or "Use my location").
 */
export default function PinPickerMap({
  value,
  onChange,
  center,
  zoom = 15,
  height = 280,
  label = 'Delivery location',
}: PinPickerProps) {
  const mapRef = useRef<MapRef | null>(null)
  const helpId = useId()
  const reduceMotion = useReducedMotion()
  const [moving, setMoving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [initial] = useState(() => (isValidLatLng(value) ? value : center))

  // Keep the map in sync when the parent changes the value (e.g. a restored address).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isValidLatLng(value)) return
    const c = map.getCenter()
    if (Math.abs(c.lat - value.lat) > 1e-5 || Math.abs(c.lng - value.lng) > 1e-5) {
      map.jumpTo({ center: [value.lng, value.lat] })
    }
  }, [value])

  function handleMoveEnd(e: ViewStateChangeEvent) {
    setMoving(false)
    const { latitude, longitude } = e.viewState
    onChange({ lat: Number(latitude.toFixed(6)), lng: Number(longitude.toFixed(6)) })
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>) {
    const map = mapRef.current
    if (!map || e.target !== e.currentTarget) return
    const step = e.shiftKey ? NUDGE_PX * 3 : NUDGE_PX
    const duration = reduceMotion ? 0 : 200
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      map.panBy(move, { duration })
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      map.zoomIn({ duration })
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      map.zoomOut({ duration })
    }
  }

  function locateMe() {
    setGeoError(null)
    if (!('geolocation' in navigator)) {
      setGeoError('Your browser cannot share location. Move the map to place the pin instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const map = mapRef.current
        if (map) {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: Math.max(map.getZoom(), 16),
            duration: reduceMotion ? 0 : 900,
          })
        } else {
          onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        }
      },
      (err) => {
        setLocating(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it in your browser settings, or move the map to place the pin.'
            : err.code === err.TIMEOUT
              ? 'Finding your location took too long. Try again, or move the map to place the pin.'
              : 'We could not find your location. Move the map to place the pin instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={label}
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={nudge}
        style={{ height }}
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <MapGL
          ref={mapRef}
          mapStyle={MAP_STYLE_URL}
          initialViewState={{ latitude: initial.lat, longitude: initial.lng, zoom }}
          keyboard={false}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
          attributionControl={{ compact: false }}
          onMoveStart={() => setMoving(true)}
          onMoveEnd={handleMoveEnd}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" showCompass={false} />
        </MapGL>

        {/* Fixed centre pin: its tip sits exactly on the map centre. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full" aria-hidden>
          <motion.div
            animate={moving && !reduceMotion ? { y: -10 } : { y: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <svg width="36" height="46" viewBox="0 0 36 46" className="drop-shadow-[0_4px_6px_rgb(22_15_30/0.35)]">
              <path
                d="M18 45c-1.2-6-14-15.5-14-27a14 14 0 1 1 28 0c0 11.5-12.8 21-14 27Z"
                fill="var(--ak-brand)"
                stroke="#fff"
                strokeWidth="2.5"
              />
              <circle cx="18" cy="18" r="5.5" fill="#fff" />
            </svg>
          </motion.div>
        </div>
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/30 transition-transform ${moving ? 'scale-75' : 'scale-100'}`}
        />

        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          className="absolute bottom-9 left-3 inline-flex h-11 items-center gap-2 rounded-xl bg-panel px-3.5 text-sm font-semibold text-ink shadow-[var(--shadow-lift)] transition-colors hover:bg-sunken disabled:opacity-70"
        >
          {locating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4 text-brand" aria-hidden />}
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
      </div>

      <p id={helpId} className="text-xs text-ink-3">
        Move the map so the pin sits on your door. Keyboard: focus the map, then use the arrow keys to move it and + or − to zoom.
      </p>
      {geoError && (
        <p role="alert" className="text-xs font-medium text-neg">
          {geoError}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {isValidLatLng(value)
          ? `Pin placed at latitude ${value.lat.toFixed(5)}, longitude ${value.lng.toFixed(5)}`
          : 'No pin placed yet'}
      </p>
    </div>
  )
}
