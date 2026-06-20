import Phaser from 'phaser'
import { baseState } from '../state/baseStore'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../world/worldConfig'
import { AUTOMINER_PURCHASE_COST } from './AutoMiner'
import { getPrice } from '../world/pricingSeam'
import { STATION_MINER_SLOT_CAP } from './AutoMiner'
import { SERVICE_SLOT_COUNT } from '../world/serviceSlots'
import { HANGAR_BAY_COUNT } from '../world/hangarBays'

export const BASE_TEXTURE_KEY = 'base'
export const BASE_STORAGE_CAPACITY = 2000
// Each silo-expansion purchase raises the total-tonnage cap by this much.
export const SILO_CAPACITY_INCREMENT = 1000
export const STARTING_CREDITS = 750
export const SHIP_COMMISSION_COST = 500
// Keplerian constant for the base's orbit around the planet. Matches the world
// ORBITAL_K for a consistent feel; tunable here if the base should orbit slower.
export const BASE_ORBIT_K = 500

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
  storageCapacity: number
  storage: Partial<Record<ResourceType, number>>
  credits: number
  readonly ships: string[]
  ownedDockCount: number
  ownedHangarCount: number
  hangarPressurized: boolean
  stationMinerSlotCount: number
  stationMinerIds: string[]
  autoDesignate: boolean
  orbitalRadius: number
  orbitalAngle: number

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, BASE_TEXTURE_KEY)
    // Orbit the planet (world center) through the construction point.
    this.orbitalRadius = Math.max(Math.hypot(x, y), 1)
    this.orbitalAngle = Math.atan2(y, x)
    this.storageCapacity = BASE_STORAGE_CAPACITY
    this.storage = {}
    this.credits = STARTING_CREDITS
    this.ships = []
    this.ownedDockCount = 0
    this.ownedHangarCount = 0
    this.hangarPressurized = false
    this.stationMinerSlotCount = 0
    this.stationMinerIds = []
    this.autoDesignate = false
    scene.add.existing(this)
    this.setInteractive(
      new Phaser.Geom.Circle(TEXTURE_CX, TEXTURE_CY, OUTER_R),
      Phaser.Geom.Circle.Contains,
    )
    this.pushToStore()
  }

  /** Advances the base along its orbit and repositions it (planet at world center). */
  advanceOrbit(dt: number): void {
    this.orbitalAngle += (BASE_ORBIT_K / this.orbitalRadius ** 1.5) * dt
    this.setPosition(
      Math.cos(this.orbitalAngle) * this.orbitalRadius,
      Math.sin(this.orbitalAngle) * this.orbitalRadius,
    )
  }

  totalStored(): number {
    return Object.values(this.storage).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  /**
   * Silo is full once stored tonnage reaches capacity. Full does not block an
   * in-flight unload (the silo soft-caps and may transiently exceed capacity);
   * it halts new acquisition (auto-designate) upstream instead.
   */
  isSiloFull(): boolean {
    return this.totalStored() >= this.storageCapacity
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

  chargeDockFee(isPublic: boolean): void {
    if (!isPublic) return  // owned dock — no fee
    this.credits -= getPrice('dock-cargo-drop')
    this.pushToStore()
  }

  chargeHangarFee(hangarSlotIndex: number | null): void {
    if (hangarSlotIndex === null) return
    if (hangarSlotIndex < this.ownedHangarCount) return  // owned hangar — no fee
    this.credits -= getPrice('hangar-service')
    this.pushToStore()
  }

  purchaseMinerSlot(): boolean {
    if (this.stationMinerSlotCount >= STATION_MINER_SLOT_CAP) return false
    if (this.credits < getPrice('station-miner-slot')) return false
    this.credits -= getPrice('station-miner-slot')
    this.stationMinerSlotCount++
    this.pushToStore()
    return true
  }

  storeAutoMiner(id: string): boolean {
    if (this.stationMinerIds.length >= this.stationMinerSlotCount) return false
    this.stationMinerIds.push(id)
    this.pushToStore()
    return true
  }

  retrieveAutoMiner(): string | null {
    if (this.stationMinerIds.length === 0) return null
    const id = this.stationMinerIds.shift()!
    this.pushToStore()
    return id
  }

  purchaseOwnedDock(): boolean {
    if (this.ownedDockCount >= SERVICE_SLOT_COUNT) return false
    if (this.credits < getPrice('owned-dock-purchase')) return false
    this.credits -= getPrice('owned-dock-purchase')
    this.ownedDockCount++
    this.pushToStore()
    return true
  }

  purchaseHangar(): boolean {
    if (this.ownedHangarCount >= HANGAR_BAY_COUNT) return false
    if (this.credits < getPrice('owned-hangar-purchase')) return false
    this.credits -= getPrice('owned-hangar-purchase')
    this.ownedHangarCount++
    this.pushToStore()
    return true
  }

  purchasePressurization(): boolean {
    if (this.hangarPressurized) return false
    if (this.ownedHangarCount < 1) return false
    if (this.credits < getPrice('pressurization-upgrade')) return false
    this.credits -= getPrice('pressurization-upgrade')
    this.hangarPressurized = true
    this.pushToStore()
    return true
  }

  commissionShip(): boolean {
    if (this.credits < SHIP_COMMISSION_COST) return false
    this.credits -= SHIP_COMMISSION_COST
    this.pushToStore()
    return true
  }

  purchaseMiner(): boolean {
    if (this.credits < AUTOMINER_PURCHASE_COST) return false
    this.credits -= AUTOMINER_PURCHASE_COST
    this.pushToStore()
    return true
  }

  purchaseSiloCapacity(): boolean {
    if (this.credits < getPrice('silo-capacity-upgrade')) return false
    this.credits -= getPrice('silo-capacity-upgrade')
    this.storageCapacity += SILO_CAPACITY_INCREMENT
    this.pushToStore()
    return true
  }

  pushToStore(): void {
    baseState.set({
      storage: { ...this.storage },
      storageCapacity: this.storageCapacity,
      credits: this.credits,
      fleetSize: this.ships.length,
      stationMinerCount: this.stationMinerIds.length,
      stationMinerSlotCount: this.stationMinerSlotCount,
      ownedDockCount: this.ownedDockCount,
      ownedHangarCount: this.ownedHangarCount,
      hangarPressurized: this.hangarPressurized,
      autoDesignate: this.autoDesignate,
    })
  }
}
