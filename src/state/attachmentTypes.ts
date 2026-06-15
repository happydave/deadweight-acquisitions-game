import { nanoid } from 'nanoid'

export type AttachmentPointSize = 'small' | 'medium'

export interface NetStorePayload {
  readonly kind: 'net-store'
  maxNets: number
  currentNets: number
}

export interface AutoMinerPayload {
  readonly kind: 'auto-miner'
  readonly minerId: string
}

export type AttachmentPayload = NetStorePayload | AutoMinerPayload

export interface AttachmentPoint {
  readonly id: string
  readonly size: AttachmentPointSize
  payload: AttachmentPayload | null
}

export const NET_STORE_MAX_NETS = 12

export function makeDefaultLoadout(): AttachmentPoint[] {
  return [
    { id: nanoid(), size: 'small', payload: { kind: 'net-store', maxNets: NET_STORE_MAX_NETS, currentNets: NET_STORE_MAX_NETS } },
    { id: nanoid(), size: 'small', payload: null },
    { id: nanoid(), size: 'medium', payload: null },
    { id: nanoid(), size: 'medium', payload: null },
  ]
}
