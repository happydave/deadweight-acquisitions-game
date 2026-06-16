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
  autoDesignate: boolean
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
  autoDesignate: false,
})

export const basePanelOpen = writable<boolean>(false)

export interface StationUsage {
  minersStored: number
  minerSlots: number
  docksInUse: number
  docksTotal: number
  publicDocksInUse: number
  hangarsInUse: number
  hangarsTotal: number
  publicHangarsInUse: number
}

export const stationUsage = writable<StationUsage>({
  minersStored: 0,
  minerSlots: 0,
  docksInUse: 0,
  docksTotal: 0,
  publicDocksInUse: 0,
  hangarsInUse: 0,
  hangarsTotal: 0,
  publicHangarsInUse: 0,
})
