import { writable } from 'svelte/store'
import type { AutoMinerState } from '../entities/AutoMiner'

export interface SelectedAutoMinerData {
  id: string
  state: AutoMinerState
  asteroidId: string | null
  activeNetFill: number
  spareNetCount: number
  tetheredNetCount: number
}

export interface BeaconData {
  id: string
  x: number
  y: number
}

export interface AutoMinerSummary {
  mining: number
  netStarved: number
  beaconing: number
  dark: number
}

export interface AttachNotification {
  id: string
  message: string
  exhausted: boolean
}

export const selectedAutoMiner = writable<SelectedAutoMinerData | null>(null)
export const activeBeacons = writable<BeaconData[]>([])
export const autoMinerSummary = writable<AutoMinerSummary>({ mining: 0, netStarved: 0, beaconing: 0, dark: 0 })
export const attachNotifications = writable<AttachNotification[]>([])
