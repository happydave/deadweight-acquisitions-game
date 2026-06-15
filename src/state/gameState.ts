import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { ShipState } from './shipStore'
import type { AttachmentPoint } from './attachmentTypes'

export interface AsteroidSnapshot {
  id: string
  x: number
  y: number
  orbitalRadius: number
  orbitalAngle: number
  resourceType: ResourceType
  sizeCategory: SizeCategory
  currentQuantity: number
  maxQuantity: number
  isCompany: boolean
}

export interface ShipSnapshot {
  id: string
  name: string
  x: number
  y: number
  heading: number
  shipState: ShipState
  target: { x: number; y: number } | null
  cargoContents: Partial<Record<ResourceType, number>>
  cargoCapacity: number
  cargoUpgradeLevel: number
  attachmentPoints: AttachmentPoint[]
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
