import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export type GameCommand =
  | { type: 'toggleAutoCycle'; shipId: string }
  | { type: 'sellResource'; resourceType: ResourceType }
  | { type: 'commissionShip' }
  | { type: 'manualSave' }

export const commandQueue = writable<GameCommand[]>([])
