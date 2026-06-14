import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedShip, type ShipState } from '../state/shipStore'
import type { ResourceType } from '../world/worldConfig'

export const SHIP_TEXTURE_KEY = 'ship'
export const SHIP_SPEED = 180          // world units per second
export const SHIP_TURN_RATE = 180      // degrees per second
export const ARRIVAL_RADIUS = 20       // world units
export const DRAG_ORDER_THRESHOLD = 5  // screen pixels

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
  readonly cargoCapacity: number
  cargoContents: Partial<Record<ResourceType, number>>
  shipState: ShipState
  target: { x: number; y: number } | null
  heading: number   // degrees, 0 = east

  constructor(scene: Phaser.Scene, x: number, y: number, name: string) {
    super(scene, x, y, SHIP_TEXTURE_KEY)
    this.id = nanoid()
    this.shipName = name
    this.cargoCapacity = 200
    this.cargoContents = {}
    this.shipState = 'idle'
    this.target = null
    this.heading = 0

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

  updateSteering(dt: number): void {
    if (this.shipState !== 'moving' || this.target === null) return

    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
    if (dist < ARRIVAL_RADIUS) {
      this.arrive()
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
    this.scene.physics.velocityFromAngle(this.heading, SHIP_SPEED, this.body!.velocity)
  }

  private arrive(): void {
    this.setVelocity(0, 0)
    this.shipState = 'idle'
    this.target = null
    this.pushToStore()
  }

  pushToStore(): void {
    selectedShip.set({
      id: this.id,
      name: this.shipName,
      state: this.shipState,
      cargoCapacity: this.cargoCapacity,
      cargoContents: { ...this.cargoContents },
    })
  }

  deselect(): void {
    selectedShip.set(null)
  }
}
