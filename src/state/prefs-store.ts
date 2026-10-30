/** User preferences + last playback session (localStorage). */

import type { RepeatMode, SourceFilter } from '@/domain/types'
import { createStore, loadPersisted, migratePersistedKey, persistStore, type Store } from '@/state/store'
import { normalizeLanguage } from '@/data/languages'
import { normalizeSourceFilter } from '@/data/sources'

export type ThemePref = 'system' | 'light' | 'dark'

export interface SessionState {
  songIds: string[]
  index: number
  positionMs: number
  contextLabel: string | null
}

export interface Prefs {
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  theme: ThemePref
  /** Search language selector (app code; `all` = no filter). */
  language: string
  /** Search source selector (`all` = every source). */
  source: SourceFilter
  session: SessionState | null
}

const KEY = 'realaxify:prefs:v1'
/** Pre-rebrand key — migrated once so existing players keep their session. */
const LEGACY_KEY = 'sonora:prefs:v1'

const DEFAULTS: Prefs = {
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  theme: 'system',
  language: 'all',
  source: 'all',
  session: null,
}

function sanitize(raw: Prefs): Prefs {
  return {
    volume: Math.min(1, Math.max(0, Number(raw.volume) || DEFAULTS.volume)),
    muted: Boolean(raw.muted),
    shuffle: Boolean(raw.shuffle),
    repeat: raw.repeat === 'all' || raw.repeat === 'one' ? raw.repeat : 'off',
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    language: normalizeLanguage(raw.language),
    source: normalizeSourceFilter(raw.source),
    session: raw.session && Array.isArray(raw.session.songIds) && raw.session.songIds.length > 0
      ? {
          songIds: raw.session.songIds.filter((s) => typeof s === 'string'),
          index: Math.max(0, Math.floor(Number(raw.session.index) || 0)),
          positionMs: Math.max(0, Math.floor(Number(raw.session.positionMs) || 0)),
          contextLabel: typeof raw.session.contextLabel === 'string' ? raw.session.contextLabel : null,
        }
      : null,
  }
}

migratePersistedKey(LEGACY_KEY, KEY)
const initial = sanitize({ ...DEFAULTS, ...loadPersisted<Prefs>(KEY, DEFAULTS) })

export const prefsStore: Store<Prefs> = createStore(initial)
persistStore(KEY, prefsStore)

export function setVolumePref(v: number): void {
  prefsStore.set((p) => ({ ...p, volume: Math.min(1, Math.max(0, v)) }))
}

export function setMutedPref(m: boolean): void {
  prefsStore.set((p) => ({ ...p, muted: m }))
}

export function setShufflePref(s: boolean): void {
  prefsStore.set((p) => ({ ...p, shuffle: s }))
}

export function setRepeatPref(r: RepeatMode): void {
  prefsStore.set((p) => ({ ...p, repeat: r }))
}

export function setThemePref(t: ThemePref): void {
  prefsStore.set((p) => ({ ...p, theme: t }))
}

export function setSearchLanguagePref(code: string): void {
  prefsStore.set((p) => ({ ...p, language: normalizeLanguage(code) }))
}

export function setSearchSourcePref(source: SourceFilter): void {
  prefsStore.set((p) => ({ ...p, source: normalizeSourceFilter(source) }))
}

export function saveSession(session: SessionState | null): void {
  prefsStore.set((p) => ({ ...p, session }))
}
