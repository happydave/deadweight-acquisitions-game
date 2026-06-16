import { writable } from 'svelte/store'
import type { CargoNetState } from '../entities/CargoNet'
import type { ResourceType } from '../world/worldConfig'

export interface SelectedCargoNetData {
  id: string
  state: CargoNetState
  resourceType: ResourceType
  quantity: number
  // True when the net is orphaned in free-orbit (recoverable via player
  // "designate for collection").
  orphaned: boolean
  designatedForCollection: boolean
}

export const selectedCargoNet = writable<SelectedCargoNetData | null>(null)
