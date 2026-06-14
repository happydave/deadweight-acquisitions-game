import { writable } from 'svelte/store'

export type ShipCommand = { type: 'toggleAutoCycle'; shipId: string }

export const commandQueue = writable<ShipCommand[]>([])
