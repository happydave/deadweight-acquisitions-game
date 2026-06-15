import { writable } from 'svelte/store'

export interface MiningDesignation {
  id: string
  asteroidId: string
  status: 'queued' | 'claimed'
  claimedByShipId: string | null
}

export const designationQueue = writable<MiningDesignation[]>([])
