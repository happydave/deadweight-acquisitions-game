import { writable } from 'svelte/store'

export interface FleetSummary {
  idle: number
  mining: number
  returning: number
}

export const fleetSummary = writable<FleetSummary>({ idle: 0, mining: 0, returning: 0 })
