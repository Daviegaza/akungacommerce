import { describe, expect, it, vi } from 'vitest'
import { isDeletableKey, parseCleanupRequest, runCleanup, safeEqual, type OrphanRow } from './media-cleanup'

const ORG = '0b0e7c4a-1d2f-4a55-9a8e-2f5c1c3d4e5f'
const row = (file: string, org = ORG): OrphanRow => ({ name: `${org}/${file}`, org_id: org, created_at: '2026-11-18T10:00:00Z' })

describe('media cleanup (shared)', () => {
  it('parses the request with safe defaults and bounds', () => {
    expect(parseCleanupRequest({})).toEqual({ dryRun: false, minAgeHours: 24, limit: 500 })
    expect(parseCleanupRequest(null)).toEqual({ dryRun: false, minAgeHours: 24, limit: 500 })
    expect(parseCleanupRequest({ dry_run: true, min_age_hours: 48, limit: 10 })).toEqual({ dryRun: true, minAgeHours: 48, limit: 10 })
    expect(parseCleanupRequest({ min_age_hours: 0.5 })).toMatch(/min_age_hours/)
    expect(parseCleanupRequest({ limit: 5000 })).toMatch(/limit/)
    expect(parseCleanupRequest({ dry_run: 'yes' })).toMatch(/dry_run/)
  })

  it('only ever deletes "<org-uuid>/<file>" keys', () => {
    expect(isDeletableKey(`${ORG}/a1b2.webp`)).toBe(true)
    expect(isDeletableKey(`${ORG}/../x.webp`)).toBe(false)
    expect(isDeletableKey(`${ORG}/sub/x.webp`)).toBe(false)
    expect(isDeletableKey(`${ORG}/.hidden`)).toBe(false)
    expect(isDeletableKey('not-a-uuid/x.webp')).toBe(false)
    expect(isDeletableKey('x.webp')).toBe(false)
  })

  it('dry run lists without deleting', async () => {
    const removeObjects = vi.fn()
    const listOrphans = vi.fn(async () => [row('a.webp'), row('b.webp')])
    const r = await runCleanup({ listOrphans, removeObjects }, { dryRun: true, minAgeHours: 24, limit: 500 })
    expect(r).toMatchObject({ dryRun: true, listed: 2, deleted: 0 })
    expect(listOrphans).toHaveBeenCalledWith(24, 500)
    expect(removeObjects).not.toHaveBeenCalled()
  })

  it('deletes in batches, de-duplicates, skips odd keys, and carries on after a failed batch', async () => {
    const rows = [...Array.from({ length: 5 }, (_, i) => row(`p${i}.webp`)), row('p0.webp'), { name: '../etc/passwd', org_id: null, created_at: '' }]
    const calls: string[][] = []
    const removeObjects = vi.fn(async (names: string[]) => {
      calls.push(names)
      if (calls.length === 2) throw new Error('storage hiccup')
      return names
    })
    const r = await runCleanup({ listOrphans: async () => rows, removeObjects }, { dryRun: false, minAgeHours: 0, limit: 10, batchSize: 2 })
    expect(calls).toEqual([
      [`${ORG}/p0.webp`, `${ORG}/p1.webp`],
      [`${ORG}/p2.webp`, `${ORG}/p3.webp`],
      [`${ORG}/p4.webp`],
    ])
    expect(r).toMatchObject({ listed: 5, deleted: 3, failedBatches: 1 })
  })

  it('never asks for objects younger than one hour', async () => {
    const listOrphans = vi.fn(async () => [] as OrphanRow[])
    await runCleanup({ listOrphans, removeObjects: vi.fn() }, { dryRun: false, minAgeHours: 0, limit: 5 })
    expect(listOrphans).toHaveBeenCalledWith(1, 5)
  })

  it('compares secrets without short-circuiting on length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
