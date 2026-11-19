import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tiny localStorage-backed value store for per-device preferences (sale chime,
 * seen milestones, feed read marker). Safe when storage is blocked: values then
 * live in memory for this tab only.
 */
const memory = new Map<string, string | null>()
const listeners = new Map<string, Set<() => void>>()

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  let v: string | null
  try {
    v = localStorage.getItem(key)
  } catch {
    v = null
  }
  memory.set(key, v)
  return v
}

export function writeLocal(key: string, value: string | null) {
  memory.set(key, value)
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  for (const l of listeners.get(key) ?? []) l()
}

export function readLocal(key: string): string | null {
  return read(key)
}

function subscribeKey(key: string, l: () => void) {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(l)
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      memory.set(key, e.newValue)
      l()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    set.delete(l)
    window.removeEventListener('storage', onStorage)
  }
}

/** Raw string value for `key` (null when unset) and a setter. */
export function useLocalString(key: string): [string | null, (v: string | null) => void] {
  const subscribe = useCallback((l: () => void) => subscribeKey(key, l), [key])
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  )
  const set = useCallback((v: string | null) => writeLocal(key, v), [key])
  return [value, set]
}
