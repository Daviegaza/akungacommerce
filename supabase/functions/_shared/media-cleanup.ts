// Orphaned product-photo cleanup (runtime-agnostic; tested with vitest).
// The Edge Function `media-cleanup` wires this to Postgres (list_orphan_product_images)
// and the Storage API (service role). Nothing here talks to the network directly.

export interface OrphanRow {
  name: string
  org_id: string | null
  created_at: string
}

export interface CleanupDeps {
  /** Rows from public.list_orphan_product_images(min_age, limit). */
  listOrphans(minAgeHours: number, limit: number): Promise<OrphanRow[]>
  /** Storage API remove for bucket 'product-images'; returns the keys it reports as removed. */
  removeObjects(names: string[]): Promise<string[]>
}

export interface CleanupOptions {
  dryRun: boolean
  /** Never below 1 h (enforced again in SQL). */
  minAgeHours: number
  limit: number
  batchSize?: number
}

export interface CleanupReport {
  dryRun: boolean
  listed: number
  deleted: number
  failedBatches: number
  names: string[]
}

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/i

/** Defence in depth: only "<org-uuid>/<file>" keys are ever sent to delete. */
export function isDeletableKey(name: string): boolean {
  return KEY_RE.test(name)
}

export function parseCleanupRequest(raw: unknown): CleanupOptions | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const dryRun = r.dry_run === undefined ? false : r.dry_run
  if (typeof dryRun !== 'boolean') return 'dry_run must be true or false'
  const minAge = r.min_age_hours === undefined ? 24 : r.min_age_hours
  if (typeof minAge !== 'number' || !Number.isFinite(minAge) || minAge < 1 || minAge > 24 * 90) return 'min_age_hours must be between 1 and 2160'
  const limit = r.limit === undefined ? 500 : r.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) return 'limit must be an integer between 1 and 1000'
  return { dryRun, minAgeHours: minAge, limit }
}

export async function runCleanup(deps: CleanupDeps, opts: CleanupOptions): Promise<CleanupReport> {
  const rows = await deps.listOrphans(Math.max(1, opts.minAgeHours), opts.limit)
  const names = [...new Set(rows.map((r) => r.name).filter(isDeletableKey))]
  if (opts.dryRun || names.length === 0) return { dryRun: opts.dryRun, listed: names.length, deleted: 0, failedBatches: 0, names }
  const size = Math.min(Math.max(opts.batchSize ?? 100, 1), 1000)
  let deleted = 0
  let failedBatches = 0
  for (let i = 0; i < names.length; i += size) {
    try {
      deleted += (await deps.removeObjects(names.slice(i, i + size))).length
    } catch {
      // Keep going: a failed batch is retried on the next scheduled run.
      failedBatches++
    }
  }
  return { dryRun: false, listed: names.length, deleted, failedBatches, names }
}

/** Constant-time string comparison for the shared secret. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
