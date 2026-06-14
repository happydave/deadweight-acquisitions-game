import Phaser from 'phaser'
import { baseState } from '../state/baseStore'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../world/worldConfig'

export const BASE_TEXTURE_KEY = 'base'
export const BASE_STORAGE_CAPACITY = 2000
export const STARTING_CREDITS = 750
export const SHIP_COMMISSION_COST = 500

const OUTER_R = 32
const INNER_R = 20
const TEXTURE_SIZE = OUTER_R * 2 + 4
const TEXTURE_CX = TEXTURE_SIZE / 2
const TEXTURE_CY = TEXTURE_SIZE / 2

export function generateBaseTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(BASE_TEXTURE_KEY)) return
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  gfx.fillStyle(0x44aaff, 1)
  gfx.fillCircle(TEXTURE_CX, TEXTURE_CY, INNER_R)
  gfx.lineStyle(2, 0x88ccff, 1)
  gfx.strokeCircle(TEXTURE_CX, TEXTURE_CY, OUTER_R)
  gfx.generateTexture(BASE_TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE)
  gfx.destroy()
}

export class Base extends Phaser.GameObjects.Image {
  readonly storageCapacity: number
  storage: Partial<Record<ResourceType, number>>
  credits: number
  readonly ships: string[]

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, BASE_TEXTURE_KEY)
    this.storageCapacity = BASE_STORAGE_CAPACITY
    this.storage = {}
    this.credits = STARTING_CREDITS
    this.ships = []
    scene.add.existing(this)
    this.setInteractive(
      new Phaser.Geom.Circle(TEXTURE_CX, TEXTURE_CY, OUTER_R),
      Phaser.Geom.Circle.Contains,
    )
    this.pushToStore()
  }

  totalStored(): number {
    return Object.values(this.storage).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  canAcceptCargo(cargo: Partial<Record<ResourceType, number>>): boolean {
    const incoming = Object.values(cargo).reduce((sum, n) => sum + (n ?? 0), 0)
    return this.totalStored() + incoming <= this.storageCapacity
  }

  acceptCargo(cargo: Partial<Record<ResourceType, number>>): void {
    for (const [type, qty] of Object.entries(cargo) as [ResourceType, number][]) {
      if (qty > 0) {
        this.storage[type] = (this.storage[type] ?? 0) + qty
      }
    }
    this.pushToStore()
  }

  registerShip(id: string): void {
    this.ships.push(id)
    this.pushToStore()
  }

  sellResource(type: ResourceType): void {
    const qty = this.storage[type] ?? 0
    if (qty <= 0) return
    this.storage[type] = 0
    this.credits += qty * RESOURCE_SELL_PRICES[type]
    this.pushToStore()
  }

  commissionShip(): boolean {
    if (this.credits < SHIP_COMMISSION_COST) return false
    this.credits -= SHIP_COMMISSION_COST
    this.pushToStore()
    return true
  }

  pushToStore(): void {
    baseState.set({
      storage: { ...this.storage },
      storageCapacity: this.storageCapacity,
      credits: this.credits,
      fleetSize: this.ships.length,
    })
  }
}
