import type { SaveState } from '../state/gameState'
import { makeDefaultLoadout } from '../state/attachmentTypes'

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
    case 4: {
      // v4 → v5: remove mining fields; add attachment points; reset mining states to idle
      type V4Ship = {
        miningRate?: unknown
        miningUpgradeLevel?: unknown
        miningTargetId?: unknown
        autoCycle?: unknown
        shipState?: string
        target?: unknown
        [key: string]: unknown
      }
      raw = {
        ...raw,
        schemaVersion: 5,
        ships: (raw.ships as unknown as V4Ship[]).map(s => {
          const { miningRate: _mr, miningUpgradeLevel: _mul, miningTargetId: _mti, autoCycle: _ac, ...rest } = s
          const shipState = (s.shipState === 'traveling-to-target' || s.shipState === 'mining')
            ? 'idle'
            : (s.shipState as string)
          const target = (s.shipState === 'traveling-to-target' || s.shipState === 'mining')
            ? null
            : rest.target
          return {
            ...rest,
            shipState,
            target,
            attachmentPoints: makeDefaultLoadout(),
          }
        }),
      } as unknown as SaveState
      // falls through
    }
    case 5:
      // v5 → v6: add autoMiners array; add asteroidTargetId to ships
      raw = {
        ...raw,
        schemaVersion: 6,
        autoMiners: [],
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          asteroidTargetId: null,
        })),
      } as unknown as SaveState
      // falls through
    case 6:
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
