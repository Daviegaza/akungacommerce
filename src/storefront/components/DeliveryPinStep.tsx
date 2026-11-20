import { Suspense, useState } from 'react'
import { Check, LocateFixed, Loader2, Map as MapIcon, MapPin } from 'lucide-react'
import { Button } from '@/app/ui/primitives'
import { cn } from '@/lib/utils'
import { MapFallback, PinPicker, type LatLng } from '@/maps'

/**
 * Delivery location without downloading the map up front. The buyer can share
 * their location (browser geolocation, no map library) or open the map picker
 * on demand; MapLibre is only requested when they press "Set pin on map".
 */
export function DeliveryPinStep({
  pin,
  onPin,
  center,
  restored,
  error,
}: {
  pin: LatLng | null
  onPin(v: LatLng): void
  center: LatLng
  /** The pin came from this device's last order. */
  restored: boolean
  error: string | null
}) {
  const [mapOpen, setMapOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [source, setSource] = useState<'saved' | 'gps' | 'map' | null>(pin ? (restored ? 'saved' : 'map') : null)

  function locate() {
    setGeoError(null)
    if (!('geolocation' in navigator)) {
      setGeoError('Your browser cannot share location. Set the pin on the map instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setSource('gps')
        onPin({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) })
      },
      (err) => {
        setLocating(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Set the pin on the map instead.'
            : 'We could not find your location. Try again, or set the pin on the map.',
        )
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  if (mapOpen) {
    return (
      <div className="flex flex-col gap-2">
        <Suspense fallback={<MapFallback height={280} />}>
          <PinPicker
            value={pin}
            onChange={(v) => {
              setSource('map')
              onPin(v)
            }}
            center={pin ?? center}
            zoom={pin ? 16 : 14}
            height={280}
            label="Delivery pin"
          />
        </Suspense>
        {error && (
          <p role="alert" className="text-xs font-medium text-neg">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border p-3',
          pin ? 'border-pos/30 bg-pos-soft' : error ? 'border-neg/30 bg-neg-soft' : 'border-line bg-sunken',
        )}
        aria-live="polite"
      >
        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', pin ? 'bg-pos text-white' : 'bg-panel text-brand')}>
          {pin ? <Check className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">
            {pin
              ? source === 'gps'
                ? 'Using your current location'
                : source === 'saved'
                  ? 'Using the pin from your last order'
                  : 'Delivery pin set'
              : 'Where should the rider bring it?'}
          </p>
          <p className="text-ink-2">
            {pin
              ? 'The delivery fee is worked out from this spot. Add a landmark below so the rider finds your door.'
              : 'Share your location or set a pin to see the delivery fee. Your landmark and street help the rider.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={pin ? 'secondary' : 'brand'}
          onClick={locate}
          disabled={locating}
          icon={locating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
          className="min-h-11"
        >
          {locating ? 'Finding you…' : pin && source === 'gps' ? 'Update my location' : 'Use my current location'}
        </Button>
        <Button variant="secondary" onClick={() => setMapOpen(true)} icon={<MapIcon className="size-4" aria-hidden />} className="min-h-11">
          {pin ? 'Adjust pin on map' : 'Set pin on map'}
        </Button>
      </div>
      {(geoError || error) && (
        <p role="alert" className="text-xs font-medium text-neg">
          {geoError ?? error}
        </p>
      )}
    </div>
  )
}
