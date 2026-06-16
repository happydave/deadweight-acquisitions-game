import { writable } from 'svelte/store'

export interface FleetSummary {
  idle: number
  active: number
  returning: number
  coasting: number
}

export const fleetSummary = writable<FleetSummary>({ idle: 0, active: 0, returning: 0, coasting: 0 })
