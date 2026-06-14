import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export type ShipState = 'idle' | 'moving'

export interface SelectedShipData {
  id: string
  name: string
  state: ShipState
  cargoCapacity: number
  cargoContents: Partial<Record<ResourceType, number>>
}

export const selectedShip = writable<SelectedShipData | null>(null)
