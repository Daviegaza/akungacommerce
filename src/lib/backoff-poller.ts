/**
 * Polling with backoff that pauses while the tab is hidden. Framework-free so it
 * can be unit-tested with fake timers; the React hook lives in usePendingPoll.ts.
 *
 * Starts at `baseMs`, multiplies by `factor` after every poll up to `maxMs`, and
 * resets to `baseMs` when something changed (reset()) or the tab becomes visible.
 */
export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
  factor?: number
}

export const POLL_DEFAULTS: Required<BackoffOptions> = { baseMs: 5_000, maxMs: 30_000, factor: 1.5 }

/** Delay before poll number `attempt` (0-based). */
export function pollDelay(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs, maxMs, factor } = { ...POLL_DEFAULTS, ...opts }
  const n = Math.max(0, Math.floor(attempt))
  return Math.min(maxMs, Math.round(baseMs * factor ** n))
}

export interface PollerEnv {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  isVisible(): boolean
}

export interface BackoffPoller {
  start(): void
  stop(): void
  /** Something changed: go back to the fastest interval. */
  reset(): void
  /** The tab became visible again: poll now and restart from the fastest interval. */
  onVisible(): void
  readonly running: boolean
  readonly attempt: number
}

export function createBackoffPoller(poll: () => void | Promise<void>, env: PollerEnv, opts: BackoffOptions = {}): BackoffPoller {
  let handle: unknown = null
  let attempt = 0
  let running = false

  const clear = () => {
    if (handle !== null) env.clearTimeout(handle)
    handle = null
  }
  const schedule = () => {
    clear()
    if (!running || !env.isVisible()) return
    handle = env.setTimeout(() => {
      handle = null
      if (!running) return
      if (!env.isVisible()) return // paused; onVisible() resumes
      attempt += 1
      void Promise.resolve()
        .then(poll)
        .catch(() => undefined)
        .finally(schedule)
    }, pollDelay(attempt, opts))
  }

  return {
    start() {
      if (running) return
      running = true
      attempt = 0
      schedule()
    },
    stop() {
      running = false
      clear()
    },
    reset() {
      attempt = 0
      if (running) schedule()
    },
    onVisible() {
      if (!running || !env.isVisible()) return
      attempt = 0
      clear()
      void Promise.resolve()
        .then(poll)
        .catch(() => undefined)
        .finally(schedule)
    },
    get running() {
      return running
    },
    get attempt() {
      return attempt
    },
  }
}
