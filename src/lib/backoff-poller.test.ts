import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackoffPoller, pollDelay } from './backoff-poller'

describe('pollDelay', () => {
  it('starts at 5 s, grows by 1.5x and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => pollDelay(n))).toEqual([5000, 7500, 11250, 16875, 25313, 30000, 30000, 30000])
    expect(pollDelay(-3)).toBe(5000)
    expect(pollDelay(2, { baseMs: 1000, factor: 2, maxMs: 3000 })).toBe(3000)
  })
})

describe('createBackoffPoller', () => {
  let visible = true
  const env = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isVisible: () => visible,
  }
  beforeEach(() => {
    vi.useFakeTimers()
    visible = true
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls at 5 s, then 7.5 s, then 11.25 s', async () => {
    const poll = vi.fn()
    const p = createBackoffPoller(poll, env)
    p.start()
    await vi.advanceTimersByTimeAsync(4999)
    expect(poll).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(7500)
    expect(poll).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(11250)
    expect(poll).toHaveBeenCalledTimes(3)
    p.stop()
  })

  it('reset() goes back to the fastest interval', async () => {
    const poll = vi.fn()
    const p = createBackoffPoller(poll, env)
    p.start()
    await vi.advanceTimersByTimeAsync(5000 + 7500)
    expect(p.attempt).toBe(2)
    p.reset()
    await vi.advanceTimersByTimeAsync(5000)
    expect(poll).toHaveBeenCalledTimes(3)
    p.stop()
  })

  it('pauses while the tab is hidden and polls immediately when it comes back', async () => {
    const poll = vi.fn()
    const p = createBackoffPoller(poll, env)
    p.start()
    visible = false
    await vi.advanceTimersByTimeAsync(120_000)
    expect(poll).toHaveBeenCalledTimes(0)
    visible = true
    p.onVisible()
    await vi.advanceTimersByTimeAsync(0)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(poll).toHaveBeenCalledTimes(2)
    p.stop()
  })

  it('stop() cancels everything; a failing poll does not break the loop', async () => {
    const poll = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
    const p = createBackoffPoller(poll, env)
    p.start()
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(7500)
    expect(poll).toHaveBeenCalledTimes(2)
    p.stop()
    expect(p.running).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(poll).toHaveBeenCalledTimes(2)
  })
})
