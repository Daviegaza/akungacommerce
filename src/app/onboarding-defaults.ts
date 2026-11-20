import { COUNTRY_PRESETS } from '@/domain/locale'

type Preset = (typeof COUNTRY_PRESETS)[number]

/**
 * Starting country for "create your business", taken from the browser instead of a fixed country:
 * the region of the browser language (en-GB → GB), then the browser time zone, then the first preset.
 * The merchant can always change it; this only avoids defaulting everyone to one market.
 */
export function presetForBrowser(language: string | undefined, timeZone: string | undefined): Preset {
  let region: string | undefined
  try {
    region = language ? new Intl.Locale(language).maximize().region : undefined
  } catch {
    region = undefined
  }
  return (
    COUNTRY_PRESETS.find((c) => c.code === region) ??
    COUNTRY_PRESETS.find((c) => c.timezone === timeZone) ??
    COUNTRY_PRESETS[0]
  )
}
