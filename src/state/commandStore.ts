import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export type GameCommand =
  | { type: 'sellResource'; resourceType: ResourceType }
  | { type: 'commissionShip' }
  | { type: 'manualSave' }
  | { type: 'upgradeShip'; shipId: string; stat: 'cargo' }
  | { type: 'deployMiner'; haulerId: string; asteroidId: string }

export const commandQueue = writable<GameCommand[]>([])
