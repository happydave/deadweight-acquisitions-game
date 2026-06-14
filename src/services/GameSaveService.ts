import type { SaveState } from '../state/gameState'

const SAVE_KEY = 'dwa-save'

function migrate(raw: SaveState): SaveState | null {
  // Each case falls through so saves upgrade through all intermediate versions.
  switch (raw.schemaVersion) {
    case 1:
      // v1 → v2: add isCompany: false to every asteroid
      raw = {
        ...raw,
        schemaVersion: 2,
        asteroids: raw.asteroids.map(a => ({
          ...a,
          isCompany: (a as { isCompany?: boolean }).isCompany ?? false,
        })),
      }
      // falls through
    case 2:
      return raw
    default:
      console.warn(`GameSaveService: unrecognized schema version ${raw.schemaVersion}, discarding save`)
      return null
  }
}

export const GameSaveService = {
  save(state: SaveState): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch {
      // localStorage unavailable or quota exceeded — silently no-op
    }
  },

  load(): SaveState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw === null) return null
      const parsed = JSON.parse(raw) as SaveState
      return migrate(parsed)
    } catch {
      return null
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      // silently no-op
    }
  },

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null
    } catch {
      return false
    }
  },
}
