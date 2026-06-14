import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { ShipState } from './shipStore'

export interface AsteroidSnapshot {
  id: string
  x: number
  y: number
  resourceType: ResourceType
  sizeCategory: SizeCategory
  currentQuantity: number
  maxQuantity: number
}

export interface ShipSnapshot {
  id: string
  name: string
  x: number
  y: number
  heading: number
  shipState: ShipState
  target: { x: number; y: number } | null
  miningTargetId: string | null
  cargoContents: Partial<Record<ResourceType, number>>
  cargoCapacity: number
  miningRate: number
  autoCycle: boolean
  unloadTimer: number
}

export interface BaseSnapshot {
  storage: Partial<Record<ResourceType, number>>
  credits: number
}

export interface SaveState {
  schemaVersion: number
  worldSeed: number
  gameClock: number
  base: BaseSnapshot
  asteroids: AsteroidSnapshot[]
  ships: ShipSnapshot[]
}

export const gameState: SaveState = {
  schemaVersion: 1,
  worldSeed: 0,
  gameClock: 0,
  base: { storage: {}, credits: 0 },
  asteroids: [],
  ships: [],
}
