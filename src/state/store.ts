/** Minimal observable store + localStorage persistence helper. */

export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  subscribe(listener: (state: T) => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<(s: T) => void>()
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      listeners.forEach((l) => l(state))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * One-time key rename (brand migration): copies a legacy key's payload onto
 * the current key when the current key does not exist yet, then drops the
 * legacy key. Best-effort — private mode / quota failures are ignored.
 */
export function migratePersistedKey(legacyKey: string, key: string): void {
  try {
    if (localStorage.getItem(key) !== null) return
    const raw = localStorage.getItem(legacyKey)
    if (raw === null) return
    localStorage.setItem(key, raw)
    localStorage.removeItem(legacyKey)
  } catch {
    /* storage unavailable — nothing to migrate */
  }
}

export function loadPersisted<T>(key: string, fallback: T, version = 1): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { v?: number; data?: T }
    if (parsed.v !== version || parsed.data === undefined) return fallback
    return parsed.data
  } catch {
    return fallback
  }
}

export function savePersisted<T>(key: string, data: T, version = 1): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: version, data }))
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

export function persistStore<T>(key: string, store: Store<T>, version = 1, debounceMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    savePersisted(key, store.get(), version)
  }
  const flush = () => {
    clearTimeout(timer)
    write()
  }
  const unsub = store.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(write, debounceMs)
  })
  // Never lose the last few hundred ms of changes on tab close / full navigation.
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
  return () => {
    clearTimeout(timer)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush)
    unsub()
  }
}
