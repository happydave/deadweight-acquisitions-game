import { writable } from 'svelte/store'
import type { ResourceType, SizeCategory } from '../world/worldConfig'

export type ShipState =
  | 'idle'
  | 'moving'
  | 'traveling-to-target'
  | 'mining'
  | 'traveling-to-base'
  | 'unloading'

export interface SelectedShipData {
  id: string
  name: string
  state: ShipState
  cargoCapacity: number
  miningRate: number
  cargoUpgradeLevel: number
  miningUpgradeLevel: number
  cargoContents: Partial<Record<ResourceType, number>>
  autoCycle: boolean
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
