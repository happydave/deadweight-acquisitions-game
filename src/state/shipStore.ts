import { writable } from 'svelte/store'
import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { AttachmentPoint } from './attachmentTypes'

export type ShipState =
  | 'idle'
  | 'moving'
  | 'traveling-to-base'
  | 'unloading'
  | 'in-hangar'
  | 'traveling-to-asteroid'
  | 'deploying-miner'
  | 'waiting-at-asteroid'
  | 'collecting-nets'
  | 'resupplying-miner'
  | 'responding-to-beacon'
  | 'loading-miner'

export interface SelectedShipData {
  id: string
  name: string
  state: ShipState
  cargoCapacity: number
  cargoUpgradeLevel: number
  cargoContents: Partial<Record<ResourceType, number>>
  attachmentPoints: AttachmentPoint[]
  unloadProgress: number
  attachUnloadProgress: number
  collectSlotProgress: Record<number, number>
}

export interface SelectedAsteroidData {
  id: string
  resourceType: ResourceType
  currentQuantity: number
  maxQuantity: number
  sizeCategory: SizeCategory
}

export const selectedShip = writable<SelectedShipData | null>(null)
export const selectedAsteroid = writable<SelectedAsteroidData | null>(null)
