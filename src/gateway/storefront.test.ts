import { describe, expect, it } from 'vitest'
import { deliveryFeeFor, haversineKm } from './storefront'

// Mirrors public.haversine_km / public.delivery_fee_for (tests/db/storefront.db.test.ts checks the SQL side).
describe('haversineKm', () => {
  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(-1.2676, 36.8108, -1.2676, 36.8108)).toBe(0)
    const a = haversineKm(-1.2676, 36.8108, -1.3192, 36.9278)
    const b = haversineKm(-1.3192, 36.9278, -1.2676, 36.8108)
    expect(a).toBeCloseTo(b, 10)
  })

  it('matches the mean Earth radius: one degree of longitude on the equator', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo((2 * Math.PI * 6371.0088) / 360, 6)
  })

  it('gives known city distances within 1%', () => {
    // Nairobi CBD -> Mombasa ≈ 440 km great-circle; Berlin -> Munich ≈ 504 km.
    expect(haversineKm(-1.2864, 36.8172, -4.0435, 39.6682)).toBeGreaterThan(435)
    expect(haversineKm(-1.2864, 36.8172, -4.0435, 39.6682)).toBeLessThan(445)
    expect(haversineKm(52.52, 13.405, 48.1351, 11.582)).toBeGreaterThan(499)
    expect(haversineKm(52.52, 13.405, 48.1351, 11.582)).toBeLessThan(509)
  })

  it('handles the antimeridian', () => {
    expect(haversineKm(0, 179.5, 0, -179.5)).toBeCloseTo((2 * Math.PI * 6371.0088) / 360, 6)
  })
})

describe('deliveryFeeFor', () => {
  const bands = [
    { maxKm: 8, feeMinor: 30000 },
    { maxKm: 3, feeMinor: 15000 },
    { maxKm: 15, feeMinor: 50000 },
  ]

  it('picks the smallest band that covers the distance, regardless of input order', () => {
    expect(deliveryFeeFor(bands, 0)).toBe(15000)
    expect(deliveryFeeFor(bands, 2.99)).toBe(15000)
    expect(deliveryFeeFor(bands, 5)).toBe(30000)
    expect(deliveryFeeFor(bands, 14.2)).toBe(50000)
  })

  it('treats the band edge as inside (max_km >= km)', () => {
    expect(deliveryFeeFor(bands, 3)).toBe(15000)
    expect(deliveryFeeFor(bands, 15)).toBe(50000)
  })

  it('returns null beyond the last band or with no bands', () => {
    expect(deliveryFeeFor(bands, 15.01)).toBeNull()
    expect(deliveryFeeFor([], 0)).toBeNull()
  })

  it('allows free bands and does not mutate the input', () => {
    const copy = [{ maxKm: 2, feeMinor: 0 }, ...bands]
    const before = JSON.stringify(copy)
    expect(deliveryFeeFor(copy, 1)).toBe(0)
    expect(JSON.stringify(copy)).toBe(before)
  })
})
