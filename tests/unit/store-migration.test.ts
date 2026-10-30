import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPersisted, migratePersistedKey, savePersisted } from '@/state/store'

const LEGACY = 'sonora:library:v1'
const CURRENT = 'realaxify:library:v1'

/** jsdom in this vitest setup does not expose localStorage; stub a tiny one. */
function stubLocalStorage(): void {
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size
    },
  })
}

describe('migratePersistedKey', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  it('copies a legacy payload onto the current key and drops the legacy key', () => {
    localStorage.setItem(LEGACY, JSON.stringify({ v: 1, data: { favoriteSongIds: ['a', 'b'] } }))

    migratePersistedKey(LEGACY, CURRENT)

    expect(loadPersisted(CURRENT, { favoriteSongIds: [] as string[] })).toEqual({ favoriteSongIds: ['a', 'b'] })
    expect(localStorage.getItem(LEGACY)).toBeNull()
  })

  it('never overwrites data already stored under the current key', () => {
    savePersisted(CURRENT, { favoriteSongIds: ['current'] })
    localStorage.setItem(LEGACY, JSON.stringify({ v: 1, data: { favoriteSongIds: ['legacy'] } }))

    migratePersistedKey(LEGACY, CURRENT)

    expect(loadPersisted(CURRENT, { favoriteSongIds: [] as string[] })).toEqual({ favoriteSongIds: ['current'] })
    expect(localStorage.getItem(LEGACY)).not.toBeNull()
  })

  it('is a no-op when there is nothing to migrate', () => {
    expect(() => migratePersistedKey(LEGACY, CURRENT)).not.toThrow()
    expect(localStorage.getItem(CURRENT)).toBeNull()
  })
})
