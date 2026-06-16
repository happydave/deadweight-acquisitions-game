import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedShip, type ShipState } from '../state/shipStore'
import type { ResourceType } from '../world/worldConfig'
import type { Base } from './Base'
import type { Asteroid } from './Asteroid'
import type { AutoMiner } from './AutoMiner'
import { makeDefaultLoadout, type AttachmentPoint } from '../state/attachmentTypes'
import { MINER_DEPLOY_PROXIMITY } from './AutoMiner'

export const SHIP_TEXTURE_KEY = 'ship'
export const SHIP_SPEED = 180          // world units per second
export const SHIP_TURN_RATE = 180      // degrees per second
export const ARRIVAL_RADIUS = 20       // world units — used for base arrival
export const DRAG_ORDER_THRESHOLD = 5  // screen pixels
export const UNLOAD_DURATION = 3       // seconds

export const ATTACHMENT_UNLOAD_DURATION = 1.5  // seconds; faster than cargo bay
export const UNLOAD_BAR_WIDTH = 32
export const UNLOAD_BAR_HEIGHT = 4
export const UNLOAD_BAR_Y_OFFSET = 18
export const ATTACH_BAR_Y_OFFSET = UNLOAD_BAR_Y_OFFSET + UNLOAD_BAR_HEIGHT + 4
export const ATTACH_BAR_COLOR = 0xffaa44

// Slot indicator markers drawn in a row below the hull.
export const SLOT_INDICATOR_Y_OFFSET = 14
export const SLOT_MARKER_SIZE = 5
export const SLOT_MARKER_GAP = 3
const SLOT_COLOR_MINER = 0x88ccee
const SLOT_COLOR_NET = 0xffcc44
const SLOT_COLOR_STORE = 0x99aabb
const SLOT_COLOR_EMPTY = 0x445566

export const MAX_UPGRADE_LEVEL = 3
export const CARGO_CAPACITY_TIERS = [200, 350, 550, 800] as const
export const CARGO_UPGRADE_COSTS  = [300, 600, 1000]     as const
export const UPGRADE_HANGAR_DURATION = 6  // seconds; halved by pressurization

export const HAULER_FUEL_MAX = 300
export const HAULER_FUEL_DRAIN_PER_SEC = 3
export const HAULER_FUEL_EMERGENCY_RESERVE = 100
export const HAULER_BATTERY_MAX = 100
export const HAULER_BATTERY_CHARGE_RATE = 0.5
export const HAULER_RCS_MAX = 100
export const HAULER_RCS_DRAIN_MANEUVER = 2
// Time a hauler spends maneuvering to attach/recover an autominer onto an
// attachment point. RCS is consumed during this hold via HAULER_RCS_DRAIN_MANEUVER.
export const HAULER_ATTACH_MANEUVER_MS = 1500
export const HAULER_FIELD_CHARGE_FUEL_RATE = 5
export const HAULER_FIELD_CHARGE_BATTERY_RATE = 20

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
  cargoUpgradeLevel: number
  readonly basePosition: { x: number; y: number }
  readonly base: Base
  cargoContents: Partial<Record<ResourceType, number>>
  shipState: ShipState
  target: { x: number; y: number } | null
  heading: number   // degrees, 0 = east
  attachmentPoints: AttachmentPoint[]
  asteroidTarget: Asteroid | null
  speedMultiplier = 1.0
  unloadTimer: number
  attachUnloadTimer: number = 0
  waitOrbitalAngle: number | null = null
  dockSlotIndex: number | null = null
  hangarSlotIndex: number | null = null
  hangarServiceTimer: number = 0
  minerTarget: AutoMiner | null = null
  thrusterFuel: number
  rcsFuel: number
  battery: number
  chargeToggle: boolean
  collectSlotProgress: Map<number, number> = new Map()
  private progressBarGfx: Phaser.GameObjects.Graphics | null = null
  private attachUnloadGfx: Phaser.GameObjects.Graphics | null = null
  private slotGfx: Phaser.GameObjects.Graphics | null = null
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
    this.cargoUpgradeLevel = 0
    this.basePosition = basePosition
    this.base = base
    this.cargoContents = {}
    this.shipState = 'idle'
    this.target = null
    this.heading = 0
    this.attachmentPoints = makeDefaultLoadout()
    this.asteroidTarget = null
    this.unloadTimer = 0
    this.thrusterFuel = HAULER_FUEL_MAX
    this.rcsFuel = HAULER_RCS_MAX
    this.battery = HAULER_BATTERY_MAX
    this.chargeToggle = false
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

  updateSteering(dt: number): void {
    const isTransit =
      this.shipState === 'traveling-to-asteroid' ||
      this.shipState === 'traveling-to-base' ||
      this.shipState === 'responding-to-beacon' ||
      this.shipState === 'traveling-to-hangar' ||
      this.shipState === 'fetching-station-miner' ||
      this.shipState === 'moving'
    if (isTransit) {
      if (this.thrusterFuel <= 0) {
        this.setVelocity(0, 0)
        this.thrusterFuel = HAULER_FUEL_EMERGENCY_RESERVE
        this.shipState = 'coasting'
        this.pushToStore()
        this.emit('fuel-dry')
        return
      }
      this.thrusterFuel = Math.max(0, this.thrusterFuel - HAULER_FUEL_DRAIN_PER_SEC * dt)
      this.battery = Math.min(HAULER_BATTERY_MAX, this.battery + HAULER_BATTERY_CHARGE_RATE * dt)
    }
    switch (this.shipState) {
      case 'moving':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.arriveIdle())
        break
      case 'traveling-to-base':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.beginUnloading())
        break
      case 'unloading':
        this.updateUnloading(dt)
        break
      case 'traveling-to-asteroid':
        // SpaceScene updates this.target each frame to the asteroid's current position.
        // On arrival, SpaceScene detects the deploying-miner state and calls performDeploy.
        this.steerTowardTarget(dt, MINER_DEPLOY_PROXIMITY, () => {
          this.setVelocity(0, 0)
          this.shipState = 'deploying-miner'
          this.pushToStore()
        })
        break
      case 'responding-to-beacon':
        // SpaceScene updates this.target each frame to the miner's current position.
        // On arrival, transitions to loading-miner; SpaceScene detects and calls performRecovery.
        this.steerTowardTarget(dt, MINER_DEPLOY_PROXIMITY, () => {
          this.setVelocity(0, 0)
          this.shipState = 'loading-miner'
          this.pushToStore()
        })
        break
      case 'in-hangar':
        this.setVelocity(0, 0)
        this.updateHangarService(dt)
        break
      case 'traveling-to-hangar':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => {
          this.setVelocity(0, 0)
          this.shipState = 'entering-hangar'
          this.pushToStore()
        })
        break
      case 'fetching-station-miner':
        // SpaceScene detects proximity to base and calls handleFetchStationMinerArrival.
        // This steer handles movement; the callback is a safe fallback that should not fire.
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.arriveIdle())
        break
      case 'entering-hangar':
        this.setVelocity(0, 0)
        this.rcsFuel = Math.max(0, this.rcsFuel - HAULER_RCS_DRAIN_MANEUVER * dt)
        break
      case 'deploying-miner':
      case 'waiting-at-asteroid':
      case 'collecting-nets':
      case 'resupplying-miner':
      case 'loading-miner':
        this.setVelocity(0, 0)
        this.rcsFuel = Math.max(0, this.rcsFuel - HAULER_RCS_DRAIN_MANEUVER * dt)
        break
      case 'coasting':
        this.setVelocity(0, 0)
        break
      case 'idle':
        break
    }
  }

  enterHangar(slotPos: { x: number; y: number }, duration: number): void {
    this.setPosition(slotPos.x, slotPos.y)
    this.hangarServiceTimer = duration
    this.shipState = 'in-hangar'
    this.setVelocity(0, 0)
    this.pushToStore()
  }

  private updateHangarService(dt: number): void {
    this.hangarServiceTimer -= dt
    if (this.hangarServiceTimer <= 0) {
      this.hangarServiceTimer = 0
      this.shipState = 'idle'
      this.pushToStore()
      this.emit('hangar-service-complete')
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

  beginCollecting(): void {
    this.collectSlotProgress.clear() // callers must init progress entries AFTER this call
    this.shipState = 'collecting-nets'
    this.setVelocity(0, 0)
    this.pushToStore()
  }

  departForBase(slotTarget?: { x: number; y: number }): void {
    this.collectSlotProgress.clear()
    this.shipState = 'traveling-to-base'
    this.target = slotTarget ? { ...slotTarget } : { ...this.basePosition }
    this.asteroidTarget = null
    this.waitOrbitalAngle = null
    this.minerTarget = null
    this.pushToStore()
  }

  private beginUnloading(): void {
    this.emit('begin-unloading')
    this.shipState = 'unloading'
    this.target = null
    const hasCargoContents = Object.values(this.cargoContents).some(v => (v ?? 0) > 0)
    if (hasCargoContents) {
      this.unloadTimer = 0
      this.progressBarGfx = this.scene.add.graphics()
      this.progressBarGfx.setDepth(this.depth + 1)
    } else {
      this.unloadTimer = UNLOAD_DURATION
    }
    const hasAttachNets = this.attachmentPoints.some(ap => ap.payload?.kind === 'cargo-net')
    if (hasAttachNets) {
      this.attachUnloadTimer = 0
      this.attachUnloadGfx = this.scene.add.graphics()
      this.attachUnloadGfx.setDepth(this.depth + 1)
    } else {
      this.attachUnloadTimer = ATTACHMENT_UNLOAD_DURATION
    }
    this.pushToStore()
  }

  private updateUnloading(dt: number): void {
    // Draw attachment net bar (above cargo bar)
    if (this.attachUnloadGfx !== null) {
      const fill = Math.min(this.attachUnloadTimer / ATTACHMENT_UNLOAD_DURATION, 1)
      const barX = this.x - UNLOAD_BAR_WIDTH / 2
      const barY = this.y - ATTACH_BAR_Y_OFFSET
      this.attachUnloadGfx.clear()
      this.attachUnloadGfx.fillStyle(0x222222, 0.7)
      this.attachUnloadGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH, UNLOAD_BAR_HEIGHT)
      this.attachUnloadGfx.fillStyle(ATTACH_BAR_COLOR, 1)
      this.attachUnloadGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH * fill, UNLOAD_BAR_HEIGHT)
    }

    // Draw cargo bay bar
    if (this.progressBarGfx !== null) {
      const fill = Math.min(this.unloadTimer / UNLOAD_DURATION, 1)
      const barX = this.x - UNLOAD_BAR_WIDTH / 2
      const barY = this.y - UNLOAD_BAR_Y_OFFSET
      this.progressBarGfx.clear()
      this.progressBarGfx.fillStyle(0x222222, 0.7)
      this.progressBarGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH, UNLOAD_BAR_HEIGHT)
      this.progressBarGfx.fillStyle(0x88ccff, 1)
      this.progressBarGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH * fill, UNLOAD_BAR_HEIGHT)
    }

    if (!this.base.canAcceptCargo(this.cargoContents)) return

    // Advance attachment timer
    if (this.attachUnloadTimer < ATTACHMENT_UNLOAD_DURATION) {
      this.attachUnloadTimer = Math.min(this.attachUnloadTimer + dt, ATTACHMENT_UNLOAD_DURATION)
      if (this.attachUnloadTimer >= ATTACHMENT_UNLOAD_DURATION) {
        if (this.attachUnloadGfx !== null) {
          this.attachUnloadGfx.destroy()
          this.attachUnloadGfx = null
        }
        this.emit('attachment-unload-complete')
      }
    }

    // Advance cargo timer
    this.unloadTimer += dt
    this.pushToStore()
    if (this.unloadTimer < UNLOAD_DURATION) return
    if (this.attachUnloadTimer < ATTACHMENT_UNLOAD_DURATION) return

    this.base.acceptCargo(this.cargoContents)
    this.cargoContents = {}
    this.unloadTimer = 0
    this.destroyProgressBar()
    this.shipState = 'idle'
    this.pushToStore()
    this.emit('unload-complete')
  }

  private destroyProgressBar(): void {
    if (this.progressBarGfx !== null) {
      this.progressBarGfx.destroy()
      this.progressBarGfx = null
    }
    if (this.attachUnloadGfx !== null) {
      this.attachUnloadGfx.destroy()
      this.attachUnloadGfx = null
    }
  }

  /**
   * Draws a row of markers below the hull, one per attachment point, so the
   * payload aboard each slot is legible: empty (faint outline), reserved/incoming
   * (hollow, colored by target kind), carried auto-miner (cyan), cargo-net
   * (amber), net-store (grey). Called each frame; follows the hull.
   */
  destroy(fromScene?: boolean): void {
    this.destroyProgressBar()
    if (this.slotGfx !== null) {
      this.slotGfx.destroy()
      this.slotGfx = null
    }
    super.destroy(fromScene)
  }

  drawSlotIndicators(): void {
    if (this.slotGfx === null) {
      this.slotGfx = this.scene.add.graphics()
      this.slotGfx.setDepth(this.depth + 1)
    }
    const g = this.slotGfx
    g.clear()

    const n = this.attachmentPoints.length
    const s = SLOT_MARKER_SIZE
    const totalW = n * s + (n - 1) * SLOT_MARKER_GAP
    let mx = this.x - totalW / 2
    const my = this.y + SLOT_INDICATOR_Y_OFFSET

    for (const ap of this.attachmentPoints) {
      const p = ap.payload
      if (p === null) {
        g.lineStyle(1, SLOT_COLOR_EMPTY, 0.5)
        g.strokeRect(mx, my, s, s)
      } else if (p.kind === 'reserved') {
        g.lineStyle(1, p.forKind === 'auto-miner' ? SLOT_COLOR_MINER : SLOT_COLOR_NET, 0.9)
        g.strokeRect(mx, my, s, s)
      } else if (p.kind === 'auto-miner') {
        g.fillStyle(SLOT_COLOR_MINER, 1)
        g.fillRect(mx, my, s, s)
      } else if (p.kind === 'cargo-net') {
        g.fillStyle(SLOT_COLOR_NET, 1)
        g.fillRect(mx, my, s, s)
      } else if (p.kind === 'net-store') {
        g.fillStyle(SLOT_COLOR_STORE, 0.9)
        g.fillRect(mx, my, s, s)
      }
      mx += s + SLOT_MARKER_GAP
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
      cargoUpgradeLevel: this.cargoUpgradeLevel,
      cargoContents: { ...this.cargoContents },
      // Reservations are in-flight claims, not real payloads — serialize as empty
      // so a reloaded slot is released (the target miner/net re-advertises).
      attachmentPoints: this.attachmentPoints.map(ap => ({
        ...ap,
        payload: ap.payload && ap.payload.kind !== 'reserved' ? { ...ap.payload } : null,
      })),
      unloadProgress: this.shipState === 'unloading'
        ? Math.min(this.unloadTimer / UNLOAD_DURATION, 1)
        : 0,
      attachUnloadProgress: Math.min(this.attachUnloadTimer / ATTACHMENT_UNLOAD_DURATION, 1),
      collectSlotProgress: Object.fromEntries(this.collectSlotProgress) as Record<number, number>,
      thrusterFuel: this.thrusterFuel,
      rcsFuel: this.rcsFuel,
      battery: this.battery,
      chargeToggle: this.chargeToggle,
    })
  }
}
