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
      // v2 → v3: add cargoUpgradeLevel and miningUpgradeLevel to every ship
      raw = {
        ...raw,
        schemaVersion: 3,
        ships: raw.ships.map(s => ({
          ...s,
          cargoUpgradeLevel: (s as { cargoUpgradeLevel?: number }).cargoUpgradeLevel ?? 0,
          miningUpgradeLevel: (s as { miningUpgradeLevel?: number }).miningUpgradeLevel ?? 0,
        })),
      }
      // falls through
    case 3:
      // v3 → v4: add orbitalRadius and orbitalAngle to every asteroid
      raw = {
        ...raw,
        schemaVersion: 4,
        asteroids: raw.asteroids.map(a => ({
          ...a,
          orbitalRadius: (a as { orbitalRadius?: number }).orbitalRadius ?? Math.sqrt(a.x * a.x + a.y * a.y),
          orbitalAngle: (a as { orbitalAngle?: number }).orbitalAngle ?? Math.atan2(a.y, a.x),
        })),
      }
      // falls through
    case 4:
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
