import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { ShipState } from './shipStore'
import type { AttachmentPoint } from './attachmentTypes'
import type { AutoMinerState } from '../entities/AutoMiner'
import type { CargoNetState } from '../entities/CargoNet'

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

export interface CargoNetSnapshot {
  id: string
  state: CargoNetState
  resourceType: string
  quantity: number
  asteroidId: string | null
}

export interface AutoMinerSnapshot {
  id: string
  state: AutoMinerState
  asteroidId: string | null
  freeOrbitalRadius: number | null
  freeOrbitalAngle: number | null
  technologyLevel: number
  spareNetCount: number
  activeNetFill: number
  tetheredNetIds: string[]
}

export interface ShipSnapshot {
  id: string
  name: string
  x: number
  y: number
  heading: number
  shipState: ShipState
  target: { x: number; y: number } | null
  asteroidTargetId: string | null
  cargoContents: Partial<Record<ResourceType, number>>
  cargoCapacity: number
  cargoUpgradeLevel: number
  attachmentPoints: AttachmentPoint[]
  unloadTimer: number
  attachUnloadTimer: number
  waitOrbitalAngle: number | null
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
  autoMiners: AutoMinerSnapshot[]
  cargoNets: CargoNetSnapshot[]
}

export const gameState: SaveState = {
  schemaVersion: 1,
  worldSeed: 0,
  gameClock: 0,
  base: { storage: {}, credits: 0 },
  asteroids: [],
  ships: [],
  autoMiners: [],
  cargoNets: [],
}
