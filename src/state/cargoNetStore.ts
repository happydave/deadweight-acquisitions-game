import { writable } from 'svelte/store'
import type { CargoNetState } from '../entities/CargoNet'
import type { ResourceType } from '../world/worldConfig'

export interface SelectedCargoNetData {
  id: string
  state: CargoNetState
  resourceType: ResourceType
  quantity: number
}

export const selectedCargoNet = writable<SelectedCargoNetData | null>(null)
