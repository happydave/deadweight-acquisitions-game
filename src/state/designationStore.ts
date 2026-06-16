import { writable } from 'svelte/store'

export interface MiningDesignation {
  id: string
  asteroidId: string
  // 'fulfilled' = a miner is deployed and mining this asteroid; the entry persists
  // (bound to the asteroid) until the asteroid depletes, marking it "being mined"
  // and preventing re-designation.
  status: 'queued' | 'claimed' | 'fulfilled'
  claimedByShipId: string | null
}

export const designationQueue = writable<MiningDesignation[]>([])
