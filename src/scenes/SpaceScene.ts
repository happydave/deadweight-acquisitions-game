import Phaser from 'phaser'
import { shipHasFreeMediumSlot, selectDispatchTarget, selectDeployTarget, selectHaulerForDesignation } from './dispatchLogic'
import { nanoid } from 'nanoid'
import { get } from 'svelte/store'
import { generateWorld, generateCompanyAsteroid } from '../world/worldGenerator'
import { computeServiceSlots, SERVICE_SLOT_COUNT, type SlotPosition } from '../world/serviceSlots'
import { computeHangarBays, HANGAR_BAY_COUNT, HANGAR_PRESSURIZED_FACTOR, type HangarPosition } from '../world/hangarBays'
import {
  ASTEROID_TEXTURE_SIZE,
  RESOURCE_COLORS,
  COMPANY_ARRIVAL_BASE_INTERVAL,
  COMPANY_ARRIVAL_MIN_INTERVAL,
  COMPANY_ASTEROID_MAX_COUNT,
  ORBITAL_K,
  SHIP_PARK_RADIUS,
  SHIP_PARK_ORBIT_RATE,
  AUTO_DISPATCH_INTERVAL,
  type ResourceType,
} from '../world/worldConfig'
import { Asteroid } from '../entities/Asteroid'
import { Base, generateBaseTexture } from '../entities/Base'
import { Planet, generatePlanetTexture } from '../entities/Planet'
import {
  Ship,
  generateShipTexture,
  DRAG_ORDER_THRESHOLD,
  CARGO_CAPACITY_TIERS,
  CARGO_UPGRADE_COSTS,
  MAX_UPGRADE_LEVEL,
  UPGRADE_HANGAR_DURATION,
} from '../entities/Ship'

import {
  AutoMiner,
  generateAutoMinerTexture,
  MINER_INITIAL_NETS,
  MINER_DEPLOY_DURATION_MS,
  MINER_DEPLOY_PROXIMITY,
  RESUPPLY_DURATION_MS,
  ATTACH_FAILURE_PROB,
  ATTACH_MAX_RETRIES,
  ATTACH_DRIFT_DURATION_MS,
  ATTACH_RETRY_DELAY_MS,
  type AutoMinerState,
} from '../entities/AutoMiner'
import {
  CargoNet,
  generateCargoNetTexture,
  NET_LEAKAGE_FRACTION,
  NET_COLLECT_DURATION_MS,
  TETHER_LINE_COLOR,
  TETHER_LINE_ALPHA,
} from '../entities/CargoNet'
import { gameState, type SaveState } from '../state/gameState'
import { commandQueue, type GameCommand } from '../state/commandStore'
import { selectedAsteroid, selectedShip } from '../state/shipStore'
import { basePanelOpen } from '../state/baseStore'
import { fleetSummary } from '../state/fleetStore'
import { designationQueue, type MiningDesignation } from '../state/designationStore'
import {
  activeBeacons,
  autoMinerSummary,
  attachNotifications,
  minerAvailability,
  type BeaconData,
  type AttachNotification,
} from '../state/autoMinerStore'
import { GameSaveService } from '../services/GameSaveService'

const NOTIFICATION_DURATION_MS = 4000
const WORLD_SIZE = 8500
const MAX_ZOOM = 2
const PAN_SPEED = 500 // world units per second
const STAR_TEXTURE_SIZE = 2048
const BASE_X = 0
const BASE_Y = 650   // GEO orbit south of planet (planet center at 0,0)
const AUTO_SAVE_INTERVAL = 60 // real-world seconds

const STAR_LAYERS = [
  { key: 'stars-far',  count: 88, parallax: 0.07, brightMin: 120, largeChance: 0.00 },
  { key: 'stars-mid',  count: 60, parallax: 0.10, brightMin: 160, largeChance: 0.00 },
  { key: 'stars-near', count: 32, parallax: 0.14, brightMin: 200, largeChance: 0.40 },
] as const

const SELECTION_RING_COLOR = 0x44ffaa
const SELECTION_RING_RADIUS = 20
const SELECTION_RING_ALPHA = 0.8

const PROXIMITY_PLANET_RADIUS = 600
const PROXIMITY_BASE_RADIUS = 250
const PROXIMITY_ASTEROID_RADIUS = 120
const PROXIMITY_MIN_SPEED = 0.25

const MINIMAP_SIZE = 180
const MINIMAP_MARGIN = 10
const MINIMAP_ALPHA = 0.65
const MINIMAP_DOT_PLANET = 6
const MINIMAP_DOT_BASE = 4
const MINIMAP_DOT_SHIP = 3
const MINIMAP_DOT_ASTEROID = 2
const MINIMAP_COLOR_BG = 0x050a14
const MINIMAP_COLOR_BORDER = 0x334466
const MINIMAP_COLOR_PLANET = 0x3a6090
const MINIMAP_COLOR_BASE = 0x88ccff
const MINIMAP_COLOR_ASTEROID = 0x777788
const MINIMAP_COLOR_COMPANY = 0x44ffdd
const MINIMAP_COLOR_SHIP = 0xffee44
const MINIMAP_COLOR_BEACON = 0xffaa44

export class SpaceScene extends Phaser.Scene {
  private starLayers: Phaser.GameObjects.TileSprite[] = []
  private asteroids: Asteroid[] = []
  private asteroidMap: Map<string, Asteroid> = new Map()
  private ships: Ship[] = []
  private autoMiners: AutoMiner[] = []
  private autoMinerMap: Map<string, AutoMiner> = new Map()
  private cargoNets: CargoNet[] = []
  private cargoNetMap: Map<string, CargoNet> = new Map()
  private shipMinerRecoveryTargets: Map<string, string> = new Map()
  private attachRetryCount: Map<string, number> = new Map()
  private base!: Base
  private selectedShip: Ship | null = null
  private selectedAutoMinerEntity: AutoMiner | null = null
  private selectedCargoNetEntity: CargoNet | null = null
  private tetherGfx: Phaser.GameObjects.Graphics | null = null
  private selectionRing: Phaser.GameObjects.Graphics | null = null
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }
  private isDragging = false
  private dragLastX = 0
  private dragLastY = 0
  private rightDownX = 0
  private rightDownY = 0
  private minZoom = 0.1
  private gameClock = 0
  private autoSaveAccumulator = 0
  private companyArrivalAccumulator = 0
  private followCam = false
  private minimap!: Phaser.GameObjects.Graphics
  private slotPositions: SlotPosition[] = []
  private slotOccupants: Array<string | null> = []
  private hangarPositions: HangarPosition[] = []
  private hangarOccupants: Array<string | null> = []
  private shipPendingUpgrades: Map<string, 'cargo'> = new Map()
  private shipPendingDesignationAsteroid: Map<string, string> = new Map()
  private designations: MiningDesignation[] = []
  private beforeUnloadHandler!: () => void

  constructor() {
    super({ key: 'SpaceScene' })
  }

  create(): void {
    this.gameClock = 0
    this.autoSaveAccumulator = 0
    this.buildStarLayers()
    this.generateAsteroidTextures()
    generateShipTexture(this)
    generateBaseTexture(this)
    generatePlanetTexture(this)
    generateAutoMinerTexture(this)
    generateCargoNetTexture(this)
    this.tetherGfx = this.add.graphics()
    this.spawnPlanet()

    const save = GameSaveService.load()
    if (save !== null) {
      this.loadFromSave(save)
    } else {
      this.spawnBase()
      this.spawnWorld()
      this.spawnStarterShip()
    }

    this.minimap = this.add.graphics()
    this.minimap.setScrollFactor(0)
    this.minimap.setDepth(1000)

    this.setupCamera()
    this.setupInput()
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.onResize(size))

    this.beforeUnloadHandler = () => {
      GameSaveService.save(this.buildSaveState())
    }
    window.addEventListener('beforeunload', this.beforeUnloadHandler)

    this.time.addEvent({
      delay: AUTO_DISPATCH_INTERVAL * 1000,
      callback: this.autoDispatch,
      callbackScope: this,
      loop: true,
    })
  }

  shutdown(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler)
  }

  private loadFromSave(save: SaveState): void {
    gameState.worldSeed = save.worldSeed
    gameState.gameClock = save.gameClock
    this.gameClock = save.gameClock

    // Restore asteroids from save (bypasses generateWorld — IDs and depletion are in save)
    this.asteroids = save.asteroids.map(data => new Asteroid(this, data))
    this.asteroidMap = new Map(this.asteroids.map(a => [a.id, a]))

    // Restore base
    this.base = new Base(this, BASE_X, BASE_Y)
    this.base.storage = { ...save.base.storage }
    this.base.credits = save.base.credits
    this.base.ownedDockCount = save.base.ownedDockCount ?? 0
    this.base.ownedHangarCount = save.base.ownedHangarCount ?? 0
    this.base.hangarPressurized = save.base.hangarPressurized ?? false
    this.base.stationMinerSlotCount = save.base.stationMinerSlotCount ?? 0
    this.base.stationMinerIds = [...(save.base.stationMinerIds ?? [])]
    this.base.pushToStore()

    this.add
      .text(BASE_X, BASE_Y + 40, 'BASE', {
        color: '#88ccff',
        fontSize: '12px',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 0)
    this.initSlots()
    this.initHangars()

    // Restore AutoMiners
    for (const snap of save.autoMiners) {
      const miner = new AutoMiner(this, snap.id)
      miner.state = snap.state
      miner.asteroidId = snap.asteroidId
      miner.spareNetCount = snap.spareNetCount
      miner.activeNetFill = snap.activeNetFill
      miner.tetheredNetIds = [...snap.tetheredNetIds]

      if (snap.asteroidId !== null) {
        const asteroid = this.asteroidMap.get(snap.asteroidId)
        if (asteroid) {
          miner.setPosition(asteroid.x, asteroid.y - 20)
          miner.setVisible(true)
        } else {
          console.warn(`AutoMiner ${snap.id}: asteroid ${snap.asteroidId} not found, skipping`)
          miner.destroy()
          continue
        }
      } else if (snap.freeOrbitalRadius !== null && snap.freeOrbitalAngle !== null) {
        miner.freeOrbitalRadius = snap.freeOrbitalRadius
        miner.freeOrbitalAngle = snap.freeOrbitalAngle
        miner.setPosition(
          Math.cos(snap.freeOrbitalAngle) * snap.freeOrbitalRadius,
          Math.sin(snap.freeOrbitalAngle) * snap.freeOrbitalRadius - 20,
        )
        miner.setVisible(true)
      }

      this.autoMiners.push(miner)
      this.autoMinerMap.set(miner.id, miner)
      this.attachMinerEvents(miner)
    }

    // Restore CargoNets (only full-tethered nets are persisted)
    for (const snap of save.cargoNets) {
      const net = new CargoNet(
        this,
        snap.resourceType as import('../world/worldConfig').ResourceType,
        snap.quantity,
        snap.asteroidId,
        snap.id,
      )
      net.state = snap.state
      if (snap.asteroidId) {
        const asteroid = this.asteroidMap.get(snap.asteroidId)
        if (asteroid) {
          const siblingCount = this.cargoNets.filter(n => n.asteroidId === snap.asteroidId).length
          const angle = (siblingCount / 4) * Math.PI * 2
          net.setPosition(asteroid.x + Math.cos(angle) * 18, asteroid.y + Math.sin(angle) * 18)
        }
      }
      this.cargoNets.push(net)
      this.cargoNetMap.set(net.id, net)
    }

    // Reposition nets belonging to free-orbiting miners (their asteroid is no longer in scene)
    for (const net of this.cargoNets) {
      const owningMiner = this.autoMiners.find(m => m.tetheredNetIds.includes(net.id))
      if (owningMiner && owningMiner.freeOrbitalRadius !== null) {
        const idx = owningMiner.tetheredNetIds.indexOf(net.id)
        const count = owningMiner.tetheredNetIds.length
        const angle = (idx / Math.max(1, count)) * Math.PI * 2
        net.setPosition(owningMiner.x + Math.cos(angle) * 18, owningMiner.y + Math.sin(angle) * 18)
        net.setVisible(true)
      }
    }

    // Restore ships — loop 1: create entities and reconstruct slot occupancy
    for (const snap of save.ships) {
      const ship = new Ship(
        this,
        snap.x,
        snap.y,
        snap.name,
        { x: BASE_X, y: BASE_Y },
        this.base,
        snap.id,
      )
      ship.heading = snap.heading
      ship.shipState = snap.shipState
      ship.target = snap.target
      ship.cargoContents = { ...snap.cargoContents }
      ship.unloadTimer = snap.unloadTimer
      ship.attachUnloadTimer = snap.attachUnloadTimer
      ship.cargoUpgradeLevel = snap.cargoUpgradeLevel
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[snap.cargoUpgradeLevel]
      ship.attachmentPoints = snap.attachmentPoints
      ship.setAngle(snap.heading)

      if (snap.asteroidTargetId !== null) {
        ship.asteroidTarget = this.asteroidMap.get(snap.asteroidTargetId) ?? null
      }
      ship.waitOrbitalAngle = snap.waitOrbitalAngle

      // Restore dock slot assignment
      const savedSlot = snap.dockSlotIndex ?? null
      if (savedSlot !== null && savedSlot >= 0 && savedSlot < this.slotOccupants.length) {
        ship.dockSlotIndex = savedSlot
        this.slotOccupants[savedSlot] = ship.id
      }

      // Restore hangar slot assignment
      const savedHangarSlot = snap.hangarSlotIndex ?? null
      if (savedHangarSlot !== null && savedHangarSlot >= 0 && savedHangarSlot < this.hangarOccupants.length) {
        ship.hangarSlotIndex = savedHangarSlot
        ship.hangarServiceTimer = snap.hangarServiceTimer ?? 0
        this.hangarOccupants[savedHangarSlot] = ship.id
      }

      this.ships.push(ship)
      this.base.registerShip(ship.id)
      this.attachShipEvents(ship)
    }

    // Rescue ships stuck in mid-animation states — loop 2: runs after slot occupancy is reconstructed
    for (const ship of this.ships) {
      if (ship.shipState === 'in-hangar') {
        // Hangar service timers are not resumed across sessions; rescue to idle and release slot
        this.releaseHangarSlot(ship)
        ship.shipState = 'idle'
        ship.pushToStore()
      } else if (ship.shipState === 'fetching-station-miner') {
        ship.shipState = 'idle'
        ship.target = null
        ship.pushToStore()
      } else if (ship.shipState === 'collecting-nets') {
        this.departShipForBase(ship)
      } else if (ship.shipState === 'resupplying-miner' && ship.asteroidTarget !== null) {
        // Complete the resupply immediately
        const miner = this.autoMiners.find(m => m.asteroidId === ship.asteroidTarget!.id)
        const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
        const transferred =
          netStoreSlot?.payload?.kind === 'net-store'
            ? Math.min(MINER_INITIAL_NETS + 1, netStoreSlot.payload.currentNets)
            : 0
        if (miner && transferred > 0 && netStoreSlot?.payload?.kind === 'net-store') {
          netStoreSlot.payload.currentNets -= transferred
          miner.spareNetCount += transferred - 1
          miner.state = 'mining'
        }
        ship.shipState = 'waiting-at-asteroid'
      } else if (ship.shipState === 'resupplying-miner') {
        ship.shipState = 'waiting-at-asteroid'
      } else if (ship.shipState === 'responding-to-beacon' || ship.shipState === 'loading-miner') {
        ship.shipState = 'idle'
        ship.asteroidTarget = null
        // Clear any pre-assigned auto-miner slot so the miner can re-beacon
        for (const ap of ship.attachmentPoints) {
          if (ap.payload?.kind === 'auto-miner') {
            const miner = this.autoMinerMap.get(ap.payload.minerId)
            if (miner && miner.state === 'in-transit') {
              miner.state = 'standby-beaconing'
              miner.setVisible(true)
            }
            ap.payload = null
          }
        }
      }
    }

    // Rescue drifting miners: treat as standby-beaconing (retry is lost but miner is recoverable)
    for (const miner of this.autoMiners) {
      if (miner.state === 'drifting') {
        miner.state = 'standby-beaconing'
      }
    }

    // Populate active beacons from miners still beaconing after rescue
    const beaconList: BeaconData[] = []
    for (const miner of this.autoMiners) {
      if (miner.state === 'standby-beaconing') {
        beaconList.push({ id: miner.id, x: miner.x, y: miner.y })
        miner.startBeacon()
      }
    }
    activeBeacons.set(beaconList)

    // Restore designations; drop any whose asteroid is gone; demote claimed with missing ship
    const shipIds = new Set(this.ships.map(s => s.id))
    const asteroidIds = new Set(this.asteroids.map(a => a.id))
    this.designations = (save.designations ?? [])
      .filter(d => asteroidIds.has(d.asteroidId))
      .map(d => {
        if (d.status === 'claimed' && d.claimedByShipId !== null && !shipIds.has(d.claimedByShipId)) {
          return { ...d, status: 'queued' as const, claimedByShipId: null }
        }
        return { ...d }
      })
    designationQueue.set([...this.designations])
  }

  private buildSaveState(): SaveState {
    return {
      schemaVersion: 16,
      worldSeed: gameState.worldSeed,
      gameClock: this.gameClock,
      base: {
        storage: { ...this.base.storage },
        credits: this.base.credits,
        ownedDockCount: this.base.ownedDockCount,
        ownedHangarCount: this.base.ownedHangarCount,
        hangarPressurized: this.base.hangarPressurized,
        stationMinerSlotCount: this.base.stationMinerSlotCount,
        stationMinerIds: [...this.base.stationMinerIds],
      },
      asteroids: this.asteroids.map(a => ({
        id: a.id,
        x: a.x,
        y: a.y,
        orbitalRadius: a.orbitalRadius,
        orbitalAngle: a.orbitalAngle,
        resourceType: a.resourceType,
        sizeCategory: a.sizeCategory,
        currentQuantity: a.currentQuantity,
        maxQuantity: a.maxQuantity,
        isCompany: a.isCompany,
      })),
      ships: this.ships.map(s => ({
        id: s.id,
        name: s.shipName,
        x: s.x,
        y: s.y,
        heading: s.heading,
        shipState: s.shipState,
        target: s.target,
        asteroidTargetId: s.asteroidTarget?.id ?? null,
        cargoContents: { ...s.cargoContents },
        cargoCapacity: s.cargoCapacity,
        cargoUpgradeLevel: s.cargoUpgradeLevel,
        attachmentPoints: s.attachmentPoints,
        unloadTimer: s.unloadTimer,
        attachUnloadTimer: s.attachUnloadTimer,
        waitOrbitalAngle: s.waitOrbitalAngle,
        dockSlotIndex: s.dockSlotIndex,
        hangarSlotIndex: s.hangarSlotIndex,
        hangarServiceTimer: s.hangarServiceTimer,
      })),
      autoMiners: this.autoMiners.map(m => ({
        id: m.id,
        state: m.state,
        asteroidId: m.asteroidId,
        freeOrbitalRadius: m.freeOrbitalRadius,
        freeOrbitalAngle: m.freeOrbitalAngle,
        technologyLevel: m.technologyLevel,
        spareNetCount: m.spareNetCount,
        activeNetFill: m.activeNetFill,
        tetheredNetIds: [...m.tetheredNetIds],
      })),
      cargoNets: this.cargoNets
        .filter(n => n.state === 'full-tethered')
        .map(n => ({
          id: n.id,
          state: n.state,
          resourceType: n.resourceType,
          quantity: n.quantity,
          asteroidId: n.asteroidId,
        })),
      designations: this.designations.map(d => ({
        id: d.id,
        asteroidId: d.asteroidId,
        status: d.status,
        claimedByShipId: d.claimedByShipId,
      })),
    }
  }

  private generateAsteroidTextures(): void {
    const resourceTypes = Object.keys(RESOURCE_COLORS) as ResourceType[]
    for (const type of resourceTypes) {
      const key = `asteroid-${type}`
      if (this.textures.exists(key)) continue
      const color = RESOURCE_COLORS[type]
      const s = ASTEROID_TEXTURE_SIZE
      const r = s / 2
      const gfx = this.make.graphics({ x: 0, y: 0 })
      gfx.fillStyle(color, 1)
      gfx.fillCircle(r, r, r)
      gfx.lineStyle(1, 0xffffff, 0.25)
      gfx.strokeCircle(r, r, r - 1)
      gfx.generateTexture(key, s, s)
      gfx.destroy()
    }
  }

  private spawnPlanet(): void {
    new Planet(this)
  }

  private spawnWorld(): void {
    const seed = Math.floor(Math.random() * 0x100000000)
    gameState.worldSeed = seed
    const asteroidData = generateWorld(seed)
    this.asteroids = asteroidData.map(data => new Asteroid(this, data))
    this.asteroidMap = new Map(this.asteroids.map(a => [a.id, a]))
  }

  private spawnBase(): void {
    this.base = new Base(this, BASE_X, BASE_Y)
    this.add
      .text(BASE_X, BASE_Y + 40, 'BASE', {
        color: '#88ccff',
        fontSize: '12px',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 0)
    this.initSlots()
    this.initHangars()
  }

  private initSlots(): void {
    this.slotPositions = computeServiceSlots(BASE_X, BASE_Y)
    this.slotOccupants = Array(SERVICE_SLOT_COUNT).fill(null)
    const gfx = this.add.graphics()
    gfx.lineStyle(1, 0x88ccff, 0.25)
    for (const slot of this.slotPositions) {
      gfx.strokeCircle(slot.x, slot.y, 8)
    }
  }

  private initHangars(): void {
    this.hangarPositions = computeHangarBays(BASE_X, BASE_Y)
    this.hangarOccupants = Array(HANGAR_BAY_COUNT).fill(null)
    const gfx = this.add.graphics()
    gfx.lineStyle(1, 0xffaa44, 0.30)
    for (const bay of this.hangarPositions) {
      gfx.strokeCircle(bay.x, bay.y, 12)
    }
  }

  private assignDockSlot(ship: Ship): SlotPosition | null {
    const idx = this.slotOccupants.findIndex(occ => occ === null)
    if (idx < 0) return null
    this.slotOccupants[idx] = ship.id
    ship.dockSlotIndex = idx
    return this.slotPositions[idx]
  }

  private releaseDockSlot(ship: Ship): void {
    const idx = ship.dockSlotIndex
    if (idx !== null && idx >= 0 && idx < this.slotOccupants.length) {
      this.slotOccupants[idx] = null
    }
    ship.dockSlotIndex = null
  }

  private departShipForBase(ship: Ship): void {
    const slot = this.assignDockSlot(ship)
    ship.departForBase(slot ?? undefined)
  }

  private assignHangarSlot(ship: Ship): HangarPosition | null {
    const idx = this.hangarOccupants.findIndex(occ => occ === null)
    if (idx < 0) return null
    this.hangarOccupants[idx] = ship.id
    ship.hangarSlotIndex = idx
    return this.hangarPositions[idx]
  }

  private releaseHangarSlot(ship: Ship): void {
    const idx = ship.hangarSlotIndex
    if (idx !== null && idx >= 0 && idx < this.hangarOccupants.length) {
      this.hangarOccupants[idx] = null
    }
    ship.hangarSlotIndex = null
  }

  beginHangarService(ship: Ship, baseDuration: number): boolean {
    const slotPos = this.assignHangarSlot(ship)
    if (slotPos === null) return false
    const isOwnedBay = ship.hangarSlotIndex !== null && ship.hangarSlotIndex < this.base.ownedHangarCount
    const duration = (isOwnedBay && this.base.hangarPressurized)
      ? baseDuration * HANGAR_PRESSURIZED_FACTOR
      : baseDuration
    ship.enterHangar(slotPos, duration)
    return true
  }

  private spawnStarterShip(): void {
    const ship = new Ship(this, 0, 0, 'Hauler-01', { x: BASE_X, y: BASE_Y }, this.base)

    // Pre-load one AutoMiner on the first medium attachment point
    const miner = new AutoMiner(this)
    this.autoMiners.push(miner)
    this.autoMinerMap.set(miner.id, miner)
    this.attachMinerEvents(miner)
    const mediumSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (mediumSlot) {
      mediumSlot.payload = { kind: 'auto-miner', minerId: miner.id }
    }

    this.ships.push(ship)
    this.base.registerShip(ship.id)
    this.attachShipEvents(ship)
  }

  private attachShipInput(ship: Ship): void {
    ship.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return
      this.selectShip(ship)
    })
  }

  private attachShipEvents(ship: Ship): void {
    this.attachShipInput(ship)
    ship.on('begin-unloading', () => this.processNetUnloading(ship))
    ship.on('attachment-unload-complete', () => this.processAttachmentNets(ship))
    ship.on('unload-complete', () => {
      this.base.chargeDockFee(ship.dockSlotIndex)
      this.releaseDockSlot(ship)
    })
    ship.on('hangar-service-complete', () => {
      this.base.chargeHangarFee(ship.hangarSlotIndex)
      this.releaseHangarSlot(ship)
      const pendingStat = this.shipPendingUpgrades.get(ship.id)
      if (pendingStat) {
        this.shipPendingUpgrades.delete(ship.id)
        this.applyUpgradeStat(ship, pendingStat)
      }
    })
  }

  private attachMinerEvents(miner: AutoMiner): void {
    miner.on('net-ejected', (net: CargoNet) => {
      this.cargoNets.push(net)
      this.cargoNetMap.set(net.id, net)
    })
    miner.on('beacon-emitted', (data: BeaconData) => {
      activeBeacons.update(beacons => {
        const idx = beacons.findIndex(b => b.id === data.id)
        if (idx >= 0) {
          const updated = [...beacons]
          updated[idx] = data
          return updated
        }
        return [...beacons, data]
      })
    })
  }

  private beginCollecting(ship: Ship, miner: AutoMiner, onComplete?: () => void): void {
    const complete = onComplete ?? (() => this.departShipForBase(ship))

    const fullNetIds = miner.tetheredNetIds.filter(id => {
      const net = this.cargoNetMap.get(id)
      return net?.state === 'full-tethered'
    })

    // Build indexed list of empty medium slots so we can track progress per slot
    const emptyMediumSlotPairs = ship.attachmentPoints
      .map((ap, idx) => ({ ap, idx }))
      .filter(({ ap }) => ap.size === 'medium' && ap.payload === null)

    const collectCount = Math.min(fullNetIds.length, emptyMediumSlotPairs.length)

    if (collectCount === 0) {
      complete()
      return
    }

    // Pre-assign medium slots to prevent double-booking
    for (let i = 0; i < collectCount; i++) {
      emptyMediumSlotPairs[i].ap.payload = { kind: 'cargo-net', netId: fullNetIds[i] }
    }

    // beginCollecting clears collectSlotProgress; init progress entries after the call
    ship.beginCollecting()
    for (let i = 0; i < collectCount; i++) {
      ship.collectSlotProgress.set(emptyMediumSlotPairs[i].idx, 0)
    }

    let pending = collectCount
    for (let i = 0; i < collectCount; i++) {
      const netId = fullNetIds[i]
      const net = this.cargoNetMap.get(netId)!
      const slotIdx = emptyMediumSlotPairs[i].idx
      this.tweens.add({
        targets: net,
        x: ship.x,
        y: ship.y,
        delay: i * NET_COLLECT_DURATION_MS,
        duration: NET_COLLECT_DURATION_MS,
        ease: 'Power2',
        onUpdate: (tween) => {
          ship.collectSlotProgress.set(slotIdx, tween.progress)
          ship.pushToStore()
        },
        onComplete: () => {
          // Apply leakage exactly once at full-tethered → in-transit transition
          net.quantity = Math.floor(net.quantity * (1 - NET_LEAKAGE_FRACTION))
          net.state = 'in-transit'
          net.setVisible(false)
          miner.tetheredNetIds = miner.tetheredNetIds.filter(id => id !== netId)
          ship.pushToStore()
          pending--
          if (pending === 0) {
            complete()
          }
        },
      })
    }
  }

  private processNetUnloading(ship: Ship): void {
    for (const ap of ship.attachmentPoints) {
      // cargo-net slots are handled by the attachment unload timer (processAttachmentNets)
      if (ap.payload?.kind === 'auto-miner') {
        const miner = this.autoMinerMap.get(ap.payload.minerId)
        if (miner) {
          for (const netId of miner.tetheredNetIds) {
            const net = this.cargoNetMap.get(netId)
            if (net) {
              this.base.acceptCargo({ [net.resourceType]: net.quantity })
              this.cargoNetMap.delete(net.id)
              this.cargoNets = this.cargoNets.filter(n => n.id !== net.id)
              if (this.selectedCargoNetEntity === net) this.selectedCargoNetEntity = null
              net.destroy()
            }
          }
          miner.tetheredNetIds = []
          // Auto-transfer in-transit miner to station storage if a slot is available
          if (miner.state === 'in-transit' && this.base.storeAutoMiner(miner.id)) {
            miner.state = 'station-stored'
            miner.setVisible(false)
            ap.payload = null
            miner.pushToStore()
          }
        }
      }
    }

    // Refill NetStore after unload
    const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
    if (netStoreSlot?.payload?.kind === 'net-store') {
      netStoreSlot.payload.currentNets = netStoreSlot.payload.maxNets
    }

    this.base.pushToStore()
    ship.pushToStore()
  }

  private processAttachmentNets(ship: Ship): void {
    for (const ap of ship.attachmentPoints) {
      if (ap.payload?.kind === 'cargo-net') {
        const net = this.cargoNetMap.get(ap.payload.netId)
        if (net) {
          this.base.acceptCargo({ [net.resourceType]: net.quantity })
          this.cargoNetMap.delete(net.id)
          this.cargoNets = this.cargoNets.filter(n => n.id !== net.id)
          if (this.selectedCargoNetEntity === net) this.selectedCargoNetEntity = null
          net.destroy()
        }
        ap.payload = null
      }
    }
    this.base.pushToStore()
    ship.pushToStore()
  }

  private autoDispatch(): void {
    // Fulfil queued mining designations
    for (const designation of [...this.designations]) {
      if (designation.status !== 'queued') continue
      const asteroid = this.asteroidMap.get(designation.asteroidId)
      if (!asteroid) {
        this.retireDesignationsForAsteroid(designation.asteroidId)
        continue
      }
      // Skip if a ship is already heading to this asteroid or fetching miner for it
      const alreadyDispatched =
        this.ships.some(s => s.asteroidTarget?.id === designation.asteroidId) ||
        [...this.shipPendingDesignationAsteroid.values()].includes(designation.asteroidId)
      if (alreadyDispatched) continue

      const hauler = selectHaulerForDesignation(this.ships, this.base.stationMinerIds.length > 0)
      if (!hauler) continue

      if (!this.claimDesignation(designation.id, hauler.id)) continue

      const hasMiner = hauler.attachmentPoints.some(
        ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner',
      )

      if (hasMiner) {
        hauler.asteroidTarget = asteroid
        hauler.target = { x: asteroid.x, y: asteroid.y }
        hauler.shipState = 'traveling-to-asteroid'
        hauler.pushToStore()
      } else {
        this.shipPendingDesignationAsteroid.set(hauler.id, designation.asteroidId)
        hauler.target = { x: this.base.x, y: this.base.y }
        hauler.shipState = 'fetching-station-miner'
        hauler.pushToStore()
      }
    }

    for (const miner of this.autoMiners) {
      // Free-orbiting miner: use existing beacon-response flow
      if (miner.freeOrbitalRadius !== null && miner.state === 'standby-beaconing') {
        const alreadyDispatched = [...this.shipMinerRecoveryTargets.values()].includes(miner.id)
        if (!alreadyDispatched) this.initiateRespondToBeacon(miner.id)
        continue
      }

      if (!miner.asteroidId) continue
      const asteroid = this.asteroidMap.get(miner.asteroidId)
      if (!asteroid) continue

      const shipEnRoute = this.ships.some(s => s.asteroidTarget?.id === miner.asteroidId)
      if (shipEnRoute) continue

      if (miner.state === 'standby-beaconing') {
        this.dispatchToAsteroid(asteroid)
      } else if (miner.state === 'net-starved') {
        this.dispatchToAsteroid(asteroid)
      } else if (miner.state === 'mining' || miner.state === 'ejecting-net') {
        const fullNets = miner.tetheredNetIds.filter(id => this.cargoNetMap.get(id)?.state === 'full-tethered')
        if (fullNets.length > 0) this.dispatchToAsteroid(asteroid)
      }
    }

    // Deploy pending miners: dispatch idle ships that carry in-transit miners to the nearest asteroid.
    // This unblocks ships that filled both M slots via sequential beacon-recovery trips.
    for (const ship of this.ships) {
      if (ship.shipState !== 'idle') continue
      const hasInTransitMiner = ship.attachmentPoints.some(
        ap => ap.payload?.kind === 'auto-miner' &&
              this.autoMinerMap.get(ap.payload.minerId)?.state === 'in-transit',
      )
      if (!hasInTransitMiner) continue

      const occupiedIds = new Set(
        this.ships.filter(s => s.asteroidTarget !== null).map(s => s.asteroidTarget!.id),
      )
      const nearest = selectDeployTarget(this.asteroids, ship, occupiedIds)
      if (!nearest) continue

      ship.asteroidTarget = nearest
      ship.target = { x: nearest.x, y: nearest.y }
      ship.shipState = 'traveling-to-asteroid'
      ship.pushToStore()
    }
  }

  private dispatchToAsteroid(asteroid: Asteroid): void {
    const nearest = selectDispatchTarget(this.ships, asteroid)
    if (!nearest) return
    nearest.asteroidTarget = asteroid
    nearest.target = { x: asteroid.x, y: asteroid.y }
    nearest.shipState = 'traveling-to-asteroid'
    nearest.pushToStore()
  }

  private performAtAsteroidRecovery(ship: Ship, miner: AutoMiner): void {
    miner.asteroidId = null
    miner.state = 'in-transit'
    miner.setVisible(false)
    for (const netId of miner.tetheredNetIds) {
      this.cargoNetMap.get(netId)?.setVisible(false)
    }
    miner.stopBeacon()
    activeBeacons.update(beacons => beacons.filter(b => b.id !== miner.id))
    miner.pushToStore()
    this.departShipForBase(ship)
  }

  private drawTethers(): void {
    if (!this.tetherGfx) return
    this.tetherGfx.clear()
    this.tetherGfx.lineStyle(1, TETHER_LINE_COLOR, TETHER_LINE_ALPHA)
    for (const miner of this.autoMiners) {
      if (!miner.visible) continue
      for (const netId of miner.tetheredNetIds) {
        const net = this.cargoNetMap.get(netId)
        if (net && net.visible) {
          this.tetherGfx.lineBetween(miner.x, miner.y, net.x, net.y)
        }
      }
    }
  }

  private selectShip(ship: Ship): void {
    if (this.selectedShip === ship) return
    this.clearSelection()
    this.selectedShip = ship
    this.selectionRing = this.add.graphics()
    this.selectionRing.setDepth(ship.depth - 1)
    this.drawSelectionRing()
    ship.select()
  }

  private clearSelection(): void {
    this.cancelFollowCam()
    if (this.selectedShip) {
      this.selectedShip.deselect()
      this.selectedShip = null
    }
    if (this.selectionRing) {
      this.selectionRing.destroy()
      this.selectionRing = null
    }
    if (this.selectedAutoMinerEntity) {
      this.selectedAutoMinerEntity.deselect()
      this.selectedAutoMinerEntity = null
    }
    if (this.selectedCargoNetEntity) {
      this.selectedCargoNetEntity.deselect()
      this.selectedCargoNetEntity = null
    }
    selectedAsteroid.set(null)
  }

  private drawSelectionRing(): void {
    if (!this.selectionRing || !this.selectedShip) return
    this.selectionRing.clear()
    this.selectionRing.lineStyle(2, SELECTION_RING_COLOR, SELECTION_RING_ALPHA)
    this.selectionRing.strokeCircle(
      this.selectedShip.x,
      this.selectedShip.y,
      SELECTION_RING_RADIUS,
    )
  }

  private toggleFollowCam(): void {
    if (!this.selectedShip) return
    if (this.followCam) {
      this.cancelFollowCam()
    } else {
      this.followCam = true
      this.cameras.main.startFollow(this.selectedShip, false, 1, 1)
    }
  }

  private cancelFollowCam(): void {
    this.followCam = false
    this.cameras.main.stopFollow()
  }

  private computeSpeedMultiplier(ship: Ship): number {
    let m = 1.0

    const dPlanet = Math.sqrt(ship.x * ship.x + ship.y * ship.y)
    if (dPlanet < PROXIMITY_PLANET_RADIUS) {
      m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dPlanet / PROXIMITY_PLANET_RADIUS))
    }

    const dBase = Phaser.Math.Distance.Between(ship.x, ship.y, BASE_X, BASE_Y)
    if (dBase < PROXIMITY_BASE_RADIUS) {
      m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dBase / PROXIMITY_BASE_RADIUS))
    }

    for (const asteroid of this.asteroids) {
      const dAst = Phaser.Math.Distance.Between(ship.x, ship.y, asteroid.x, asteroid.y)
      if (dAst < PROXIMITY_ASTEROID_RADIUS) {
        m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dAst / PROXIMITY_ASTEROID_RADIUS))
      }
    }

    return m
  }

  private drawMinimap(): void {
    const zoom = this.cameras.main.zoom
    const hw = this.scale.width / 2
    const hh = this.scale.height / 2
    const targetX = this.scale.width - MINIMAP_SIZE - MINIMAP_MARGIN
    const targetY = MINIMAP_MARGIN
    const drawX = hw + (targetX - hw) / zoom
    const drawY = hh + (targetY - hh) / zoom
    const drawSize = MINIMAP_SIZE / zoom

    this.minimap.clear()

    this.minimap.fillStyle(MINIMAP_COLOR_BG, MINIMAP_ALPHA)
    this.minimap.fillRect(drawX, drawY, drawSize, drawSize)
    this.minimap.lineStyle(1 / zoom, MINIMAP_COLOR_BORDER, 0.9)
    this.minimap.strokeRect(drawX, drawY, drawSize, drawSize)

    const wx = (worldX: number) => drawX + (worldX / WORLD_SIZE + 0.5) * drawSize
    const wy = (worldY: number) => drawY + (worldY / WORLD_SIZE + 0.5) * drawSize

    this.minimap.fillStyle(MINIMAP_COLOR_PLANET, 0.9)
    this.minimap.fillCircle(wx(0), wy(0), MINIMAP_DOT_PLANET / zoom)

    this.minimap.fillStyle(MINIMAP_COLOR_BASE, 1)
    const baseHalf = MINIMAP_DOT_BASE / zoom / 2
    this.minimap.fillRect(wx(BASE_X) - baseHalf, wy(BASE_Y) - baseHalf, MINIMAP_DOT_BASE / zoom, MINIMAP_DOT_BASE / zoom)

    for (const asteroid of this.asteroids) {
      const color = asteroid.isCompany ? MINIMAP_COLOR_COMPANY : MINIMAP_COLOR_ASTEROID
      this.minimap.fillStyle(color, 0.85)
      this.minimap.fillCircle(wx(asteroid.x), wy(asteroid.y), MINIMAP_DOT_ASTEROID / zoom)
    }

    for (const ship of this.ships) {
      this.minimap.fillStyle(MINIMAP_COLOR_SHIP, 1)
      this.minimap.fillCircle(wx(ship.x), wy(ship.y), MINIMAP_DOT_SHIP / zoom)
    }

    for (const miner of this.autoMiners) {
      if (miner.state === 'standby-beaconing') {
        this.minimap.fillStyle(MINIMAP_COLOR_BEACON, 1)
        this.minimap.fillCircle(wx(miner.x), wy(miner.y), MINIMAP_DOT_ASTEROID / zoom)
      }
    }
  }

  private companyArrivalInterval(): number {
    const natural = this.asteroids.filter(a => !a.isCompany)
    if (natural.length === 0) return COMPANY_ARRIVAL_MIN_INTERVAL
    const totalMax = natural.reduce((sum, a) => sum + a.maxQuantity, 0)
    const totalCurrent = natural.reduce((sum, a) => sum + a.currentQuantity, 0)
    const fraction = totalMax > 0 ? totalCurrent / totalMax : 0
    return COMPANY_ARRIVAL_MIN_INTERVAL +
      (COMPANY_ARRIVAL_BASE_INTERVAL - COMPANY_ARRIVAL_MIN_INTERVAL) * fraction
  }

  private trySpawnCompanyAsteroid(): void {
    const liveCount = this.asteroids.filter(a => a.isCompany).length
    if (liveCount >= COMPANY_ASTEROID_MAX_COUNT) return
    const seed = Math.floor(Math.random() * 0x100000000)
    const data = generateCompanyAsteroid(seed)
    const asteroid = new Asteroid(this, data)
    this.asteroids.push(asteroid)
    this.asteroidMap.set(asteroid.id, asteroid)
  }

  private buildStarLayers(): void {
    const { width, height } = this.scale

    for (const layer of STAR_LAYERS) {
      const gfx = this.make.graphics({ x: 0, y: 0 })
      for (let i = 0; i < layer.count; i++) {
        const x = Phaser.Math.Between(0, STAR_TEXTURE_SIZE - 1)
        const y = Phaser.Math.Between(0, STAR_TEXTURE_SIZE - 1)
        const brightness = Phaser.Math.Between(layer.brightMin, 255)
        const size = Math.random() < layer.largeChance ? 2 : 1
        gfx.fillStyle(Phaser.Display.Color.GetColor(brightness, brightness, brightness), 1)
        gfx.fillRect(x, y, size, size)
      }
      gfx.generateTexture(layer.key, STAR_TEXTURE_SIZE, STAR_TEXTURE_SIZE)
      gfx.destroy()

      const sprite = this.add.tileSprite(0, 0, width, height, layer.key)
      sprite.setOrigin(0, 0)
      sprite.setScrollFactor(0)
      this.starLayers.push(sprite)
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main
    const half = WORLD_SIZE / 2
    cam.setBounds(-half, -half, WORLD_SIZE, WORLD_SIZE)
    this.minZoom = this.computeMinZoom()
    cam.setZoom(Math.max(1, this.minZoom))
    cam.centerOn(0, 0)
  }

  private computeMinZoom(): number {
    return Math.max(this.scale.width / WORLD_SIZE, this.scale.height / WORLD_SIZE)
  }

  private drainCommandQueue(): void {
    const commands = get(commandQueue)
    if (commands.length === 0) return
    commandQueue.set([])
    for (const cmd of commands) {
      this.handleCommand(cmd)
    }
  }

  private handleCommand(cmd: GameCommand): void {
    if (cmd.type === 'sellResource') {
      this.base.sellResource(cmd.resourceType)
    } else if (cmd.type === 'commissionShip') {
      this.commissionNewShip()
    } else if (cmd.type === 'manualSave') {
      GameSaveService.save(this.buildSaveState())
    } else if (cmd.type === 'upgradeShip') {
      this.initiateShipUpgrade(cmd.shipId, cmd.stat)
    } else if (cmd.type === 'deployMiner') {
      this.initiateDeployMiner(cmd.haulerId, cmd.asteroidId)
    } else if (cmd.type === 'resupplyMiner') {
      this.initiateResupplyMiner(cmd.minerId)
    } else if (cmd.type === 'respondToBeacon') {
      this.initiateRespondToBeacon(cmd.minerId)
    } else if (cmd.type === 'purchaseMiner') {
      this.performPurchaseMiner(cmd.haulerId)
    } else if (cmd.type === 'collectNets') {
      this.initiateCollectNets(cmd.haulerId, cmd.asteroidId)
    } else if (cmd.type === 'purchaseMinerSlot') {
      this.base.purchaseMinerSlot()
    } else if (cmd.type === 'purchaseOwnedDock') {
      this.base.purchaseOwnedDock()
    } else if (cmd.type === 'purchaseHangar') {
      this.base.purchaseHangar()
    } else if (cmd.type === 'purchasePressurization') {
      this.base.purchasePressurization()
    } else if (cmd.type === 'designateAsteroid') {
      this.addDesignation(cmd.asteroidId)
    } else if (cmd.type === 'undesignateAsteroid') {
      this.removeDesignation(cmd.asteroidId)
    }
  }

  private initiateDeployMiner(haulerId: string, asteroidId: string): void {
    const ship = this.ships.find(s => s.id === haulerId)
    const asteroid = this.asteroidMap.get(asteroidId)
    if (!ship || !asteroid) return
    if (!this.shipHasMiner(ship)) return

    ship.asteroidTarget = asteroid
    ship.target = { x: asteroid.x, y: asteroid.y }
    ship.shipState = 'traveling-to-asteroid'
    ship.pushToStore()
  }

  private initiateCollectNets(haulerId: string, asteroidId: string): void {
    const ship = this.ships.find(s => s.id === haulerId)
    const asteroid = this.asteroidMap.get(asteroidId)
    if (!ship || !asteroid || ship.shipState !== 'idle') return

    ship.asteroidTarget = asteroid
    ship.target = { x: asteroid.x, y: asteroid.y }
    ship.shipState = 'traveling-to-asteroid'
    ship.pushToStore()
  }

  private asteroidHasTetheredNets(asteroid: Asteroid): boolean {
    return this.autoMiners.some(m => m.asteroidId === asteroid.id && m.tetheredNetIds.length > 0)
  }

  private initiateResupplyMiner(minerId: string): void {
    const miner = this.autoMinerMap.get(minerId)
    if (!miner) return
    const ship = this.ships.find(
      s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === miner.asteroidId,
    )
    if (!ship) return
    const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
    if (!netStoreSlot || netStoreSlot.payload?.kind !== 'net-store') return
    if (netStoreSlot.payload.currentNets < 1) return
    this.beginResupply(ship, miner)
  }

  private beginResupply(ship: Ship, miner: AutoMiner): void {
    ship.shipState = 'resupplying-miner'
    ship.pushToStore()

    this.time.delayedCall(RESUPPLY_DURATION_MS, () => {
      const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
      const transferred =
        netStoreSlot?.payload?.kind === 'net-store'
          ? Math.min(MINER_INITIAL_NETS + 1, netStoreSlot.payload.currentNets)
          : 0

      if (transferred > 0 && netStoreSlot?.payload?.kind === 'net-store') {
        netStoreSlot.payload.currentNets -= transferred
        miner.spareNetCount += transferred - 1
        miner.state = 'mining'
        miner.pushToStore()
      } else if (miner.tetheredNetIds.length > 0) {
        this.beginCollecting(ship, miner)
        return
      }

      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
    })
  }

  private initiateRespondToBeacon(minerId: string): void {
    const miner = this.autoMinerMap.get(minerId)
    if (!miner || miner.state !== 'standby-beaconing') return

    const nearestIdle = this.ships
      .filter(s => s.shipState === 'idle')
      .reduce<Ship | null>((best, s) => {
        if (!best) return s
        const dBest = Phaser.Math.Distance.Between(best.x, best.y, miner.x, miner.y)
        const dS = Phaser.Math.Distance.Between(s.x, s.y, miner.x, miner.y)
        return dS < dBest ? s : best
      }, null)
    if (!nearestIdle) return

    const freeSlot = nearestIdle.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!freeSlot) return

    freeSlot.payload = { kind: 'auto-miner', minerId: miner.id }
    nearestIdle.asteroidTarget = null
    nearestIdle.target = { x: miner.x, y: miner.y }
    nearestIdle.shipState = 'responding-to-beacon'
    nearestIdle.pushToStore()
    this.shipMinerRecoveryTargets.set(nearestIdle.id, miner.id)
  }

  private handleLoadingMiner(ship: Ship): void {
    const minerId = this.shipMinerRecoveryTargets.get(ship.id)
    const miner = minerId ? this.autoMinerMap.get(minerId) : null

    if (miner) {
      ship.minerTarget = miner
      const fullNetIds = miner.tetheredNetIds.filter(
        id => this.cargoNetMap.get(id)?.state === 'full-tethered',
      )
      if (fullNetIds.length > 0) {
        this.beginCollecting(ship, miner, () => this.performRecovery(ship))
        return
      }
    }

    this.performRecovery(ship)
  }

  private removeDepletedAsteroid(asteroid: Asteroid, miner: AutoMiner): void {
    // Handle any ship already waiting at this asteroid before clearing asteroidId
    const waitingShip = this.ships.find(
      s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === asteroid.id,
    )
    if (waitingShip) {
      waitingShip.asteroidTarget = null
      this.beginCollecting(waitingShip, miner)
    }

    // Detach miner into free orbit using asteroid's current orbital parameters
    miner.freeOrbitalRadius = asteroid.orbitalRadius
    miner.freeOrbitalAngle = asteroid.orbitalAngle
    miner.asteroidId = null

    // Detach any other miners still referencing this asteroid (e.g. net-starved, attaching, drifting).
    // Must run before asteroid.destroy() so orbitalRadius/Angle are still valid.
    for (const otherMiner of this.autoMiners) {
      if (otherMiner === miner || otherMiner.asteroidId !== asteroid.id) continue
      otherMiner.freeOrbitalRadius = asteroid.orbitalRadius
      otherMiner.freeOrbitalAngle = asteroid.orbitalAngle
      otherMiner.asteroidId = null
      if (otherMiner.state !== 'standby-beaconing') {
        otherMiner.state = 'standby-beaconing'
        otherMiner.startBeacon()
      }
      otherMiner.pushToStore()
    }

    // Cancel ships traveling to this asteroid
    for (const ship of this.ships) {
      if (ship.asteroidTarget?.id === asteroid.id && ship.shipState === 'traveling-to-asteroid') {
        ship.asteroidTarget = null
        ship.shipState = 'idle'
        ship.target = null
        ship.pushToStore()
      }
    }

    // Auto-retire any designations for this depleted asteroid
    this.retireDesignationsForAsteroid(asteroid.id)

    // Remove asteroid from scene
    this.asteroids = this.asteroids.filter(a => a.id !== asteroid.id)
    this.asteroidMap.delete(asteroid.id)
    asteroid.destroy()
  }

  private performRecovery(ship: Ship): void {
    const minerId = this.shipMinerRecoveryTargets.get(ship.id)
    this.shipMinerRecoveryTargets.delete(ship.id)
    if (!minerId) {
      this.departShipForBase(ship)
      return
    }
    const miner = this.autoMinerMap.get(minerId)
    if (miner) {
      miner.freeOrbitalRadius = null
      miner.freeOrbitalAngle = null
      miner.state = 'in-transit'
      miner.setVisible(false)
      for (const netId of miner.tetheredNetIds) {
        this.cargoNetMap.get(netId)?.setVisible(false)
      }
      miner.stopBeacon()
      activeBeacons.update(beacons => beacons.filter(b => b.id !== minerId))
    }
    this.departShipForBase(ship)
  }

  private shipHasMiner(ship: Ship): boolean {
    return ship.attachmentPoints.some(
      ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner',
    )
  }

  private performDeploy(ship: Ship): void {
    const asteroid = ship.asteroidTarget
    if (!asteroid) {
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    const slotIndex = ship.attachmentPoints.findIndex(
      ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner',
    )
    if (slotIndex === -1) {
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    const slot = ship.attachmentPoints[slotIndex]
    if (slot.payload?.kind !== 'auto-miner') return

    const miner = this.autoMinerMap.get(slot.payload.minerId)
    if (!miner) {
      ship.attachmentPoints[slotIndex] = { ...slot, payload: null }
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    // Transfer nets from NetStore: MINER_INITIAL_NETS spares + 1 active = total MINER_INITIAL_NETS + 1
    const netStoreSlot = ship.attachmentPoints.find(
      ap => ap.payload?.kind === 'net-store',
    )
    let transferred = 0
    if (netStoreSlot?.payload?.kind === 'net-store') {
      const desired = MINER_INITIAL_NETS + 1
      transferred = Math.min(desired, netStoreSlot.payload.currentNets)
      netStoreSlot.payload.currentNets -= transferred
    }
    miner.spareNetCount = Math.max(0, transferred - 1)  // last net is active net
    miner.activeNetFill = 0

    // Clear attachment slot
    ship.attachmentPoints[slotIndex] = { ...slot, payload: null }

    // Reveal miner at ship position, tween to asteroid
    miner.asteroidId = asteroid.id
    miner.state = 'deploying'
    miner.setPosition(ship.x, ship.y)
    miner.setVisible(true)

    // Fulfil any designation claimed by this ship
    const claimedDesig = this.designations.find(d => d.claimedByShipId === ship.id)
    if (claimedDesig) this.fulfillDesignation(claimedDesig.id)

    const destX = asteroid.x
    const destY = asteroid.y - 20
    this.attachRetryCount.set(ship.id, ATTACH_MAX_RETRIES)
    this.tweens.add({
      targets: miner,
      x: destX,
      y: destY,
      duration: MINER_DEPLOY_DURATION_MS,
      ease: 'Power2',
      onComplete: () => {
        miner.state = 'attaching'
        miner.pushToStore()
        this.beginAttachAttempt(ship, miner, asteroid)
      },
    })

    ship.shipState = 'waiting-at-asteroid'
    ship.pushToStore()
  }

  private beginAttachAttempt(ship: Ship, miner: AutoMiner, asteroid: Asteroid): void {
    if (!miner.active || ship.shipState !== 'waiting-at-asteroid') {
      this.attachRetryCount.delete(ship.id)
      return
    }

    if (asteroid.currentQuantity <= 0) {
      miner.state = 'standby-beaconing'
      miner.startBeacon()
      miner.pushToStore()
      this.attachRetryCount.delete(ship.id)
      return
    }

    if (Math.random() >= ATTACH_FAILURE_PROB) {
      miner.state = 'mining'
      miner.pushToStore()
      this.attachRetryCount.delete(ship.id)
      return
    }

    miner.state = 'drifting'
    miner.pushToStore()

    const remaining = (this.attachRetryCount.get(ship.id) ?? 1) - 1
    this.attachRetryCount.set(ship.id, remaining)

    const attemptNum = ATTACH_MAX_RETRIES - remaining
    this.pushAttachNotification(
      `Miner attach failed (attempt ${attemptNum}/${ATTACH_MAX_RETRIES})${remaining > 0 ? ' — retrying' : ''}`,
      false,
    )

    this.tweens.add({
      targets: miner,
      x: miner.x + 25,
      y: miner.y + 15,
      duration: ATTACH_DRIFT_DURATION_MS,
      ease: 'Power1',
    })

    if (remaining > 0) {
      this.time.delayedCall(ATTACH_RETRY_DELAY_MS, () => {
        miner.setPosition(asteroid.x, asteroid.y - 20)
        miner.state = 'attaching'
        miner.pushToStore()
        this.beginAttachAttempt(ship, miner, asteroid)
      })
    } else {
      this.time.delayedCall(ATTACH_RETRY_DELAY_MS, () => {
        this.handleAttachExhaustion(ship, miner, asteroid)
      })
    }
  }

  private handleAttachExhaustion(ship: Ship, miner: AutoMiner, asteroid: Asteroid): void {
    this.attachRetryCount.delete(ship.id)

    // Release any designation claimed by this ship so it can be re-queued
    const claimedDesig = this.designations.find(d => d.claimedByShipId === ship.id)
    if (claimedDesig) this.releaseDesignation(claimedDesig.id)

    const freeSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (freeSlot) {
      freeSlot.payload = { kind: 'auto-miner', minerId: miner.id }
      miner.state = 'in-transit'
      miner.setVisible(false)
    } else {
      console.warn(`handleAttachExhaustion: no free medium slot on ship ${ship.id}, miner ${miner.id} falls back to beaconing`)
      miner.state = 'standby-beaconing'
      miner.startBeacon()
    }

    miner.pushToStore()
    ship.pushToStore()

    this.pushAttachNotification(
      `Miner attach exhausted — ${asteroid.resourceType} asteroid ${miner.asteroidId ?? ''}`,
      true,
    )
  }

  private pushAttachNotification(message: string, exhausted: boolean): void {
    const entry: AttachNotification = { id: nanoid(), message, exhausted }
    attachNotifications.update(ns => [...ns, entry])
    this.time.delayedCall(NOTIFICATION_DURATION_MS, () => {
      attachNotifications.update(ns => ns.filter(n => n.id !== entry.id))
    })
  }

  private commissionNewShip(): void {
    if (!this.base.commissionShip()) return
    const index = this.ships.length + 1
    const name = `Hauler-${String(index).padStart(2, '0')}`
    const offset = 40 + (index % 4) * 20
    const angle = (index * 90) % 360
    const spawnX = BASE_X + Math.cos(Phaser.Math.DegToRad(angle)) * offset
    const spawnY = BASE_Y + Math.sin(Phaser.Math.DegToRad(angle)) * offset
    const ship = new Ship(this, spawnX, spawnY, name, { x: BASE_X, y: BASE_Y }, this.base)
    this.ships.push(ship)
    this.base.registerShip(ship.id)
    this.attachShipEvents(ship)
  }

  private performPurchaseMiner(haulerId: string): void {
    const ship = this.ships.find(s => s.id === haulerId)
    if (!ship) return
    const slot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!slot) return
    if (!this.base.purchaseMiner()) return

    const miner = new AutoMiner(this)
    miner.setPosition(ship.x, ship.y)
    this.autoMiners.push(miner)
    this.autoMinerMap.set(miner.id, miner)
    this.attachMinerEvents(miner)

    const idx = ship.attachmentPoints.indexOf(slot)
    ship.attachmentPoints[idx] = { ...slot, payload: { kind: 'auto-miner', minerId: miner.id } }
    ship.pushToStore()
  }

  private initiateShipUpgrade(shipId: string, stat: 'cargo'): void {
    const ship = this.ships.find(s => s.id === shipId)
    if (!ship) return
    if (ship.shipState !== 'idle') return
    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      const cost = CARGO_UPGRADE_COSTS[ship.cargoUpgradeLevel]
      if (this.base.credits < cost) return
      const slotPos = this.assignHangarSlot(ship)
      if (slotPos === null) return  // no bay available
      this.base.credits -= cost
      this.base.pushToStore()
      this.shipPendingUpgrades.set(ship.id, stat)
      ship.target = { ...slotPos }
      ship.shipState = 'traveling-to-hangar'
      ship.pushToStore()
    }
  }

  private handleHangarEntry(ship: Ship): void {
    const slotIdx = ship.hangarSlotIndex
    if (slotIdx === null) {
      ship.shipState = 'idle'
      ship.pushToStore()
      return
    }
    const slotPos = this.hangarPositions[slotIdx]
    const isOwnedPressurized = slotIdx < this.base.ownedHangarCount && this.base.hangarPressurized
    const duration = UPGRADE_HANGAR_DURATION * (isOwnedPressurized ? HANGAR_PRESSURIZED_FACTOR : 1)
    ship.enterHangar(slotPos, duration)
  }

  private applyUpgradeStat(ship: Ship, stat: 'cargo'): void {
    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      ship.cargoUpgradeLevel++
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[ship.cargoUpgradeLevel]
    }
    ship.pushToStore()
  }

  private handleFetchStationMinerArrival(ship: Ship): void {
    const asteroidId = this.shipPendingDesignationAsteroid.get(ship.id)
    this.shipPendingDesignationAsteroid.delete(ship.id)

    const designation = this.designations.find(
      d => d.claimedByShipId === ship.id,
    )

    const minerId = this.base.retrieveAutoMiner()
    if (!minerId || !asteroidId) {
      // Storage empty or pending asteroid lost — release designation and go idle
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    const miner = this.autoMinerMap.get(minerId)
    if (!miner) {
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    const freeSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!freeSlot) {
      // No free slot; put miner back and release designation
      this.base.storeAutoMiner(minerId)
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    miner.state = 'in-transit'
    miner.setVisible(false)
    freeSlot.payload = { kind: 'auto-miner', minerId }
    miner.pushToStore()

    const asteroid = this.asteroidMap.get(asteroidId)
    if (!asteroid) {
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    ship.asteroidTarget = asteroid
    ship.target = { x: asteroid.x, y: asteroid.y }
    ship.shipState = 'traveling-to-asteroid'
    ship.pushToStore()
  }

  addDesignation(asteroidId: string): void {
    if (this.designations.some(d => d.asteroidId === asteroidId)) return
    const entry: MiningDesignation = { id: nanoid(), asteroidId, status: 'queued', claimedByShipId: null }
    this.designations.push(entry)
    designationQueue.set([...this.designations])
  }

  removeDesignation(asteroidId: string): void {
    this.designations = this.designations.filter(d => d.asteroidId !== asteroidId)
    designationQueue.set([...this.designations])
  }

  claimDesignation(id: string, shipId: string): boolean {
    const entry = this.designations.find(d => d.id === id)
    if (!entry || entry.status === 'claimed') return false
    entry.status = 'claimed'
    entry.claimedByShipId = shipId
    designationQueue.set([...this.designations])
    return true
  }

  releaseDesignation(id: string): void {
    const idx = this.designations.findIndex(d => d.id === id)
    if (idx < 0) return
    const entry = this.designations[idx]
    if (entry.status !== 'claimed') return
    this.designations.splice(idx, 1)
    entry.status = 'queued'
    entry.claimedByShipId = null
    this.designations.push(entry)
    designationQueue.set([...this.designations])
  }

  fulfillDesignation(id: string): void {
    const idx = this.designations.findIndex(d => d.id === id)
    if (idx < 0) return
    this.designations.splice(idx, 1)
    designationQueue.set([...this.designations])
  }

  retireDesignationsForAsteroid(asteroidId: string): void {
    const had = this.designations.some(d => d.asteroidId === asteroidId)
    if (!had) return
    this.designations = this.designations.filter(d => d.asteroidId !== asteroidId)
    designationQueue.set([...this.designations])
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard!

    this.cursors = keyboard.createCursorKeys()
    this.wasd = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.HOME).on('down', () => {
      this.cameras.main.pan(0, 0, 300, 'Power2')
    })

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on('down', () => {
      this.clearSelection()
      basePanelOpen.set(false)
    })

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      this.toggleFollowCam()
    })

    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, targets: Phaser.GameObjects.GameObject[]) => {
        if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
          if (this.followCam) this.cancelFollowCam()
          this.isDragging = true
          this.dragLastX = pointer.x
          this.dragLastY = pointer.y
          if (pointer.rightButtonDown()) {
            this.rightDownX = pointer.x
            this.rightDownY = pointer.y
          }
        }

        if (pointer.leftButtonDown()) {
          const mmLeft = this.scale.width - MINIMAP_SIZE - MINIMAP_MARGIN
          const mmTop = MINIMAP_MARGIN
          if (
            pointer.x >= mmLeft && pointer.x <= mmLeft + MINIMAP_SIZE &&
            pointer.y >= mmTop && pointer.y <= mmTop + MINIMAP_SIZE
          ) {
            if (this.followCam) this.cancelFollowCam()
            const worldX = (pointer.x - mmLeft - MINIMAP_SIZE / 2) * (WORLD_SIZE / MINIMAP_SIZE)
            const worldY = (pointer.y - mmTop - MINIMAP_SIZE / 2) * (WORLD_SIZE / MINIMAP_SIZE)
            this.cameras.main.pan(worldX, worldY, 300, 'Power2')
            return
          }

          const hitShip = targets.some(t => t instanceof Ship)
          if (!hitShip) {
            const hitCargoNet = targets.find(t => t instanceof CargoNet) as CargoNet | undefined
            if (hitCargoNet) {
              this.clearSelection()
              this.selectedCargoNetEntity = hitCargoNet
              hitCargoNet.select()
            } else {
              const hitAutoMiner = targets.find(t => t instanceof AutoMiner) as AutoMiner | undefined
              if (hitAutoMiner && hitAutoMiner.state !== 'in-transit') {
                this.clearSelection()
                this.selectedAutoMinerEntity = hitAutoMiner
                hitAutoMiner.select()
              } else {
                const hitBase = targets.find(t => t instanceof Base)
                if (hitBase) {
                  selectedAsteroid.set(null)
                  if (this.selectedAutoMinerEntity) {
                    this.selectedAutoMinerEntity.deselect()
                    this.selectedAutoMinerEntity = null
                  }
                  basePanelOpen.set(true)
                } else {
                  const hitAsteroid = targets.find(t => t instanceof Asteroid) as Asteroid | undefined
                  if (hitAsteroid) {
                    if (
                      this.selectedShip &&
                      this.selectedShip.shipState === 'idle' &&
                      this.asteroidHasTetheredNets(hitAsteroid)
                    ) {
                      const haulerId = this.selectedShip.id
                      commandQueue.update(q => [...q, { type: 'collectNets', haulerId, asteroidId: hitAsteroid.id }])
                    } else {
                      this.clearSelection()
                      hitAsteroid.selectSelf()
                    }
                  } else {
                    this.clearSelection()
                    basePanelOpen.set(false)
                  }
                }
              }
            }
          }
        }
      },
    )

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging) return
      const cam = this.cameras.main
      cam.scrollX -= (pointer.x - this.dragLastX) / cam.zoom
      cam.scrollY -= (pointer.y - this.dragLastY) / cam.zoom
      this.dragLastX = pointer.x
      this.dragLastY = pointer.y
    })

    this.input.on(
      'pointerup',
      (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown() && !pointer.middleButtonDown()) {
          this.isDragging = false
        }

        if (pointer.rightButtonReleased()) {
          const dx = pointer.x - this.rightDownX
          const dy = pointer.y - this.rightDownY
          if (Math.sqrt(dx * dx + dy * dy) < DRAG_ORDER_THRESHOLD && this.selectedShip) {
            this.selectedShip.issueMoveTo(pointer.worldX, pointer.worldY)
          }
        }
      },
    )

    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _objects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        const cam = this.cameras.main
        cam.zoom = Phaser.Math.Clamp(cam.zoom + (deltaY > 0 ? -0.1 : 0.1), this.minZoom, MAX_ZOOM)
      },
    )
  }

  private onResize(size: Phaser.Structs.Size): void {
    for (const layer of this.starLayers) {
      layer.setSize(size.width, size.height)
    }
    this.minZoom = this.computeMinZoom()
    const cam = this.cameras.main
    if (cam.zoom < this.minZoom) cam.setZoom(this.minZoom)
  }

  update(_time: number, delta: number): void {
    this.drainCommandQueue()

    const dt = delta / 1000
    this.gameClock += dt

    this.autoSaveAccumulator += dt
    if (this.autoSaveAccumulator >= AUTO_SAVE_INTERVAL) {
      this.autoSaveAccumulator = 0
      GameSaveService.save(this.buildSaveState())
    }

    this.companyArrivalAccumulator += dt
    if (this.companyArrivalAccumulator >= this.companyArrivalInterval()) {
      this.companyArrivalAccumulator = 0
      this.trySpawnCompanyAsteroid()
    }

    const cam = this.cameras.main
    const speed = PAN_SPEED * dt

    const left = this.cursors.left.isDown || this.wasd.left.isDown
    const right = this.cursors.right.isDown || this.wasd.right.isDown
    const up = this.cursors.up.isDown || this.wasd.up.isDown
    const down = this.cursors.down.isDown || this.wasd.down.isDown

    if (!this.followCam) {
      if (left) cam.scrollX -= speed
      else if (right) cam.scrollX += speed

      if (up) cam.scrollY -= speed
      else if (down) cam.scrollY += speed
    }

    for (let i = 0; i < this.starLayers.length; i++) {
      this.starLayers[i].tilePositionX = cam.scrollX * STAR_LAYERS[i].parallax
      this.starLayers[i].tilePositionY = cam.scrollY * STAR_LAYERS[i].parallax
    }

    for (const asteroid of this.asteroids) {
      asteroid.updateOrbit(dt)
    }

    // Update deployed miner positions to follow their asteroid.
    // Only include states where the miner should track its asteroid per-frame.
    // Do NOT include 'drifting' or other states that manage their own position via tweens.
    const deployedStates = new Set<AutoMinerState>([
      'attaching', 'mining', 'ejecting-net', 'net-starved', 'standby-beaconing', 'dark',
    ])
    for (const miner of this.autoMiners) {
      if (miner.asteroidId && deployedStates.has(miner.state)) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.setPosition(asteroid.x, asteroid.y - 20)
        }
      }
    }

    // Run AutoMiner mining tick; detect asteroid depletion
    for (const miner of this.autoMiners) {
      if (miner.state === 'mining' && miner.asteroidId) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.updateMining(dt, asteroid)
          if (asteroid.currentQuantity <= 0 && this.asteroidMap.has(asteroid.id)) {
            this.removeDepletedAsteroid(asteroid, miner)
          }
        }
      }
    }

    // Update free-orbiting miner positions (asteroid depleted, miner detached)
    for (const miner of this.autoMiners) {
      if (miner.freeOrbitalRadius !== null && miner.freeOrbitalAngle !== null) {
        miner.freeOrbitalAngle += (ORBITAL_K / Math.max(miner.freeOrbitalRadius, 1) ** 1.5) * dt
        miner.setPosition(
          Math.cos(miner.freeOrbitalAngle) * miner.freeOrbitalRadius,
          Math.sin(miner.freeOrbitalAngle) * miner.freeOrbitalRadius - 20,
        )
      }
    }

    // Update tethered net positions to orbit their miner
    for (const miner of this.autoMiners) {
      const count = miner.tetheredNetIds.length
      for (let i = 0; i < count; i++) {
        const net = this.cargoNetMap.get(miner.tetheredNetIds[i])
        if (net && net.state === 'full-tethered') {
          const angle = (i / Math.max(1, count)) * Math.PI * 2
          net.setPosition(miner.x + Math.cos(angle) * 18, miner.y + Math.sin(angle) * 18)
        }
      }
    }

    // Detect miner state transitions requiring Hauler action
    for (const miner of this.autoMiners) {
      const waitingShip = this.ships.find(
        s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === miner.asteroidId,
      )
      if (!waitingShip) continue

      // Attachment-time capacity check: ship must have at least one free medium slot before
      // attempting any collection or recovery. If full, depart immediately so a capable ship
      // can be dispatched on the next autoDispatch tick.
      if (!shipHasFreeMediumSlot(waitingShip)) {
        this.departShipForBase(waitingShip)
        continue
      }

      if (miner.state === 'net-starved') {
        // Resupply takes priority over collection when NetStore has nets
        const netStoreSlot = waitingShip.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
        if (netStoreSlot?.payload?.kind === 'net-store' && netStoreSlot.payload.currentNets >= 1) {
          this.beginResupply(waitingShip, miner)
        } else {
          // NetStore empty — fall back to collecting any full-tethered nets
          this.beginCollecting(waitingShip, miner)
        }
      } else if (miner.state === 'standby-beaconing') {
        const freeSlot = waitingShip.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
        if (freeSlot) {
          freeSlot.payload = { kind: 'auto-miner', minerId: miner.id }
          this.beginCollecting(waitingShip, miner, () => this.performAtAsteroidRecovery(waitingShip, miner))
        } else {
          this.departShipForBase(waitingShip)
        }
      } else if (miner.state === 'mining' || miner.state === 'ejecting-net') {
        const fullNets = miner.tetheredNetIds.filter(id => this.cargoNetMap.get(id)?.state === 'full-tethered')
        if (fullNets.length > 0) this.beginCollecting(waitingShip, miner)
      }
    }

    this.drawTethers()

    for (const ship of this.ships) {
      // Keep ship target locked to orbiting asteroid
      if (ship.shipState === 'traveling-to-asteroid' && ship.asteroidTarget) {
        ship.target = { x: ship.asteroidTarget.x, y: ship.asteroidTarget.y }
      }
      // Orbit asteroid while parked
      if (
        ship.asteroidTarget &&
        this.asteroidMap.has(ship.asteroidTarget.id) && (
          ship.shipState === 'waiting-at-asteroid' ||
          ship.shipState === 'collecting-nets' ||
          ship.shipState === 'resupplying-miner'
        )
      ) {
        const ast = ship.asteroidTarget
        if (ship.waitOrbitalAngle === null) {
          ship.waitOrbitalAngle = Math.atan2(ship.y - ast.y, ship.x - ast.x)
        }
        ship.waitOrbitalAngle += SHIP_PARK_ORBIT_RATE * dt
        ship.setPosition(
          ast.x + Math.cos(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
          ast.y + Math.sin(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
        )
      // Orbit free-orbiting miner while collecting its nets
      } else if (ship.minerTarget && ship.shipState === 'collecting-nets') {
        const m = ship.minerTarget
        if (ship.waitOrbitalAngle === null) {
          ship.waitOrbitalAngle = Math.atan2(ship.y - m.y, ship.x - m.x)
        }
        ship.waitOrbitalAngle += SHIP_PARK_ORBIT_RATE * dt
        ship.setPosition(
          m.x + Math.cos(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
          m.y + Math.sin(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
        )
      }
      // Keep responding-to-beacon target locked to miner's current position
      if (ship.shipState === 'responding-to-beacon') {
        const minerId = this.shipMinerRecoveryTargets.get(ship.id)
        if (minerId) {
          const miner = this.autoMinerMap.get(minerId)
          if (miner) ship.target = { x: miner.x, y: miner.y }
        }
      }
      ship.speedMultiplier = this.computeSpeedMultiplier(ship)
      ship.updateSteering(dt)
      // Detect arrival: steerTowardTarget transitioned to deploying-miner
      if (ship.shipState === 'deploying-miner') {
        this.performDeploy(ship)
      }
      // Detect arrival: steerTowardTarget transitioned to loading-miner
      if (ship.shipState === 'loading-miner') {
        this.handleLoadingMiner(ship)
      }
      // Detect arrival: steerTowardTarget transitioned to entering-hangar
      if (ship.shipState === 'entering-hangar') {
        this.handleHangarEntry(ship)
      }
      // Detect arrival at base for station-miner fetch
      if (ship.shipState === 'fetching-station-miner') {
        const dBase = Phaser.Math.Distance.Between(ship.x, ship.y, this.base.x, this.base.y)
        if (dBase < PROXIMITY_BASE_RADIUS) {
          this.handleFetchStationMinerArrival(ship)
        }
      }
    }

    let idle = 0, active = 0, returning = 0
    for (const ship of this.ships) {
      const s = ship.shipState
      if (s === 'idle' || s === 'moving') idle++
      else if (s === 'traveling-to-base' || s === 'unloading' || s === 'in-hangar' || s === 'traveling-to-hangar' || s === 'fetching-station-miner') returning++
      else active++
    }
    fleetSummary.set({ idle, active, returning })

    let mining = 0, netStarved = 0, beaconing = 0, dark = 0
    for (const miner of this.autoMiners) {
      if (miner.state === 'mining' || miner.state === 'ejecting-net') mining++
      else if (miner.state === 'net-starved') netStarved++
      else if (miner.state === 'standby-beaconing') beaconing++
      else if (miner.state === 'dark') dark++
    }
    autoMinerSummary.set({ mining, netStarved, beaconing, dark })

    // Compute miner availability vs designation demand
    const idleShipIds = new Set(this.ships.filter(s => s.shipState === 'idle').map(s => s.id))
    let carried = 0
    for (const miner of this.autoMiners) {
      if (miner.state !== 'in-transit') continue
      const onIdleShip = this.ships.some(
        s => idleShipIds.has(s.id) &&
             s.attachmentPoints.some(ap => ap.payload?.kind === 'auto-miner' && ap.payload.minerId === miner.id),
      )
      if (onIdleShip) carried++
    }
    const stored = this.base.stationMinerIds.length
    const available = carried + stored
    const demanded = this.designations.filter(d => d.status === 'queued' || d.status === 'claimed').length
    minerAvailability.set({ available, demanded, shortage: available < demanded })

    if (this.selectedShip && this.selectionRing) {
      this.drawSelectionRing()
    }

    this.drawMinimap()
  }
}
