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

export const selectedAutoMiner = writable<SelectedAutoMinerData | null>(null)
