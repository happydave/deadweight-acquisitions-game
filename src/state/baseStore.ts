import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export interface BaseState {
  storage: Partial<Record<ResourceType, number>>
  storageCapacity: number
  credits: number
  fleetSize: number
  stationMinerCount: number
  stationMinerSlotCount: number
  ownedDockCount: number
  ownedHangarCount: number
  hangarPressurized: boolean
}

export const baseState = writable<BaseState>({
  storage: {},
  storageCapacity: 0,
  credits: 0,
  fleetSize: 0,
  stationMinerCount: 0,
  stationMinerSlotCount: 0,
  ownedDockCount: 0,
  ownedHangarCount: 0,
  hangarPressurized: false,
})

export const basePanelOpen = writable<boolean>(false)
