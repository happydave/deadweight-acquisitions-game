import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedShip, type ShipState } from '../state/shipStore'
import type { ResourceType } from '../world/worldConfig'
import type { Asteroid } from './Asteroid'
import type { Base } from './Base'

export const SHIP_TEXTURE_KEY = 'ship'
export const SHIP_SPEED = 180          // world units per second
export const SHIP_TURN_RATE = 180      // degrees per second
export const ARRIVAL_RADIUS = 20       // world units — used for base arrival
export const MINING_PROXIMITY = 60     // world units — arrival threshold for asteroid
export const DRAG_ORDER_THRESHOLD = 5  // screen pixels
export const UNLOAD_DURATION = 3       // seconds

export const MAX_UPGRADE_LEVEL = 3
export const CARGO_CAPACITY_TIERS = [200, 350, 550, 800] as const
export const MINING_RATE_TIERS    = [10,  15,  22,  32]  as const
export const CARGO_UPGRADE_COSTS  = [300, 600, 1000]     as const
export const MINING_UPGRADE_COSTS = [400, 800, 1500]     as const

export function generateShipTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHIP_TEXTURE_KEY)) return
  const w = 24
  const h = 16
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  // Triangle pointing east (right): tip at (w, h/2), base at (0, 0) and (0, h)
  gfx.fillStyle(0x88ddff, 1)
  gfx.fillTriangle(w, h / 2, 0, 0, 0, h)
  gfx.lineStyle(1, 0xffffff, 0.5)
  gfx.strokeTriangle(w, h / 2, 0, 0, 0, h)
  gfx.generateTexture(SHIP_TEXTURE_KEY, w, h)
  gfx.destroy()
}

export class Ship extends Phaser.Physics.Arcade.Sprite {
  readonly id: string
  readonly shipName: string
  cargoCapacity: number
  miningRate: number
  cargoUpgradeLevel: number
  miningUpgradeLevel: number
  readonly basePosition: { x: number; y: number }
  readonly base: Base
  cargoContents: Partial<Record<ResourceType, number>>
  shipState: ShipState
  target: { x: number; y: number } | null
  heading: number   // degrees, 0 = east
  miningTarget: Asteroid | null
  autoCycle: boolean
  speedMultiplier = 1.0
  unloadTimer: number
  private miningOffset: { x: number; y: number } | null = null
  isSelected: boolean

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    name: string,
    basePosition: { x: number; y: number },
    base: Base,
    id?: string,
  ) {
    super(scene, x, y, SHIP_TEXTURE_KEY)
    this.id = id ?? nanoid()
    this.shipName = name
    this.cargoCapacity = CARGO_CAPACITY_TIERS[0]
    this.miningRate = MINING_RATE_TIERS[0]
    this.cargoUpgradeLevel = 0
    this.miningUpgradeLevel = 0
    this.basePosition = basePosition
    this.base = base
    this.cargoContents = {}
    this.shipState = 'idle'
    this.target = null
    this.heading = 0
    this.miningTarget = null
    this.autoCycle = false
    this.unloadTimer = 0
    this.isSelected = false

    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.setOrigin(0.5, 0.5)
    this.setInteractive()
  }

  issueMoveTo(worldX: number, worldY: number): void {
    this.target = { x: worldX, y: worldY }
    this.shipState = 'moving'
    this.pushToStore()
  }

  issueMineOrder(asteroid: Asteroid): void {
    this.miningTarget = asteroid
    this.target = { x: asteroid.x, y: asteroid.y }
    this.shipState = 'traveling-to-target'
    this.pushToStore()
  }

  setAutoCycle(enabled: boolean): void {
    this.autoCycle = enabled
    this.pushToStore()
  }

  updateSteering(dt: number): void {
    switch (this.shipState) {
      case 'moving':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.arriveIdle())
        break
      case 'traveling-to-target':
        if (this.miningTarget !== null) {
          this.target = { x: this.miningTarget.x, y: this.miningTarget.y }
        }
        this.steerTowardTarget(dt, MINING_PROXIMITY, () => this.beginMining())
        break
      case 'mining':
        this.updateMining(dt)
        break
      case 'traveling-to-base':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.beginUnloading())
        break
      case 'unloading':
        this.updateUnloading(dt)
        break
      case 'idle':
        break
    }
  }

  private steerTowardTarget(
    dt: number,
    arrivalRadius: number,
    onArrive: () => void,
  ): void {
    if (this.target === null) {
      this.setVelocity(0, 0)
      this.shipState = 'idle'
      this.pushToStore()
      return
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
    if (dist < arrivalRadius) {
      this.setVelocity(0, 0)
      onArrive()
      return
    }

    const targetAngleDeg = Phaser.Math.RadToDeg(
      Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y)
    )
    const diff = Phaser.Math.Angle.ShortestBetween(this.heading, targetAngleDeg)
    const maxTurn = SHIP_TURN_RATE * dt
    this.heading = Phaser.Math.Angle.WrapDegrees(
      this.heading + Phaser.Math.Clamp(diff, -maxTurn, maxTurn)
    )
    this.setAngle(this.heading)
    this.scene.physics.velocityFromAngle(this.heading, SHIP_SPEED * this.speedMultiplier, this.body!.velocity)
  }

  private arriveIdle(): void {
    this.shipState = 'idle'
    this.target = null
    this.pushToStore()
  }

  private beginMining(): void {
    this.shipState = 'mining'
    this.target = null
    if (this.miningTarget !== null) {
      this.miningOffset = { x: this.x - this.miningTarget.x, y: this.y - this.miningTarget.y }
    }
    this.pushToStore()
  }

  private updateMining(dt: number): void {
    if (this.miningTarget !== null) {
      if (this.miningOffset === null) {
        this.miningOffset = { x: this.x - this.miningTarget.x, y: this.y - this.miningTarget.y }
      }
      this.body!.reset(this.miningTarget.x + this.miningOffset.x, this.miningTarget.y + this.miningOffset.y)
    }

    if (this.miningTarget === null || this.miningTarget.currentQuantity <= 0) {
      this.departToBase()
      return
    }

    const cargoUsed = this.totalCargo()
    const cargoSpace = this.cargoCapacity - cargoUsed
    if (cargoSpace <= 0) {
      this.departToBase()
      return
    }

    const extract = Math.min(
      this.miningRate * dt,
      this.miningTarget.currentQuantity,
      cargoSpace,
    )
    const resourceType = this.miningTarget.resourceType
    this.cargoContents[resourceType] = (this.cargoContents[resourceType] ?? 0) + extract
    this.miningTarget.currentQuantity -= extract
    this.miningTarget.pushToStore()

    this.pushToStore()

    if (this.totalCargo() >= this.cargoCapacity || this.miningTarget.currentQuantity <= 0) {
      this.departToBase()
    }
  }

  private departToBase(): void {
    this.miningOffset = null
    this.shipState = 'traveling-to-base'
    this.target = { x: this.basePosition.x, y: this.basePosition.y }
    this.pushToStore()
  }

  private beginUnloading(): void {
    this.shipState = 'unloading'
    this.unloadTimer = 0
    this.target = null
    this.pushToStore()
  }

  private updateUnloading(dt: number): void {
    if (!this.base.canAcceptCargo(this.cargoContents)) return

    this.unloadTimer += dt
    if (this.unloadTimer < UNLOAD_DURATION) return

    this.base.acceptCargo(this.cargoContents)
    this.cargoContents = {}
    this.unloadTimer = 0

    if (this.autoCycle && this.miningTarget !== null && this.miningTarget.currentQuantity > 0) {
      this.issueMineOrder(this.miningTarget)
    } else {
      this.miningTarget = null
      this.shipState = 'idle'
      this.pushToStore()
    }
  }

  private totalCargo(): number {
    return Object.values(this.cargoContents).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  notifyTargetDestroyed(asteroid: Asteroid): void {
    if (this.miningTarget !== asteroid) return
    this.miningTarget = null
    if (this.shipState === 'traveling-to-target') {
      this.target = null
      this.setVelocity(0, 0)
      this.shipState = 'idle'
      this.pushToStore()
    }
  }

  select(): void {
    this.isSelected = true
    this.pushToStore()
  }

  deselect(): void {
    this.isSelected = false
    selectedShip.set(null)
  }

  pushToStore(): void {
    if (!this.isSelected) return
    selectedShip.set({
      id: this.id,
      name: this.shipName,
      state: this.shipState,
      cargoCapacity: this.cargoCapacity,
      miningRate: this.miningRate,
      cargoUpgradeLevel: this.cargoUpgradeLevel,
      miningUpgradeLevel: this.miningUpgradeLevel,
      cargoContents: { ...this.cargoContents },
      autoCycle: this.autoCycle,
    })
  }
}
