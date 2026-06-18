import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export type GameCommand =
  | { type: 'sellResource'; resourceType: ResourceType }
  | { type: 'commissionShip' }
  | { type: 'manualSave' }
  | { type: 'upgradeShip'; shipId: string; stat: 'cargo' }
  | { type: 'resupplyMiner'; minerId: string }
  | { type: 'respondToBeacon'; minerId: string }
  | { type: 'purchaseMiner' }
  | { type: 'collectNets'; haulerId: string; asteroidId: string }
  | { type: 'purchaseMinerSlot' }
  | { type: 'purchaseOwnedDock' }
  | { type: 'purchaseHangar' }
  | { type: 'purchasePressurization' }
  | { type: 'designateAsteroid'; asteroidId: string }
  | { type: 'undesignateAsteroid'; asteroidId: string }
  | { type: 'collectNet'; netId: string }
  | { type: 'repairMiner'; minerId: string }
  | { type: 'toggleAutoDesignate' }
  | { type: 'toggleMinerCharge'; shipId: string }

export const commandQueue = writable<GameCommand[]>([])
