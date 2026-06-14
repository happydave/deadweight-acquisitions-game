import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export type GameCommand =
  | { type: 'toggleAutoCycle'; shipId: string }
  | { type: 'sellResource'; resourceType: ResourceType }
  | { type: 'commissionShip' }
  | { type: 'manualSave' }
  | { type: 'upgradeShip'; shipId: string; stat: 'cargo' | 'mining' }

export const commandQueue = writable<GameCommand[]>([])
