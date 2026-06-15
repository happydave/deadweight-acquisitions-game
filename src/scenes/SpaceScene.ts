import Phaser from 'phaser'
import { get } from 'svelte/store'
import { generateWorld, generateCompanyAsteroid } from '../world/worldGenerator'
import {
  ASTEROID_TEXTURE_SIZE,
  RESOURCE_COLORS,
  COMPANY_ARRIVAL_BASE_INTERVAL,
  COMPANY_ARRIVAL_MIN_INTERVAL,
  COMPANY_ASTEROID_MAX_COUNT,
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
} from '../entities/Ship'

import {
  AutoMiner,
  generateAutoMinerTexture,
  MINER_INITIAL_NETS,
  MINER_DEPLOY_DURATION_MS,
  MINER_DEPLOY_PROXIMITY,
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
import { GameSaveService } from '../services/GameSaveService'

const WORLD_SIZE = 8500
const MAX_ZOOM = 2
const PAN_SPEED = 500 // world units per second
const STAR_TEXTURE_SIZE = 512
const BASE_X = 0
const BASE_Y = 650   // GEO orbit south of planet (planet center at 0,0)
const AUTO_SAVE_INTERVAL = 60 // real-world seconds

const STAR_LAYERS = [
  { key: 'stars-far',  count: 22, parallax: 0.07, brightMin: 120, largeChance: 0.00 },
  { key: 'stars-mid',  count: 15, parallax: 0.10, brightMin: 160, largeChance: 0.00 },
  { key: 'stars-near', count:  8, parallax: 0.14, brightMin: 200, largeChance: 0.40 },
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

export class SpaceScene extends Phaser.Scene {
  private starLayers: Phaser.GameObjects.TileSprite[] = []
  private asteroids: Asteroid[] = []
  private asteroidMap: Map<string, Asteroid> = new Map()
  private ships: Ship[] = []
  private autoMiners: AutoMiner[] = []
  private autoMinerMap: Map<string, AutoMiner> = new Map()
  private cargoNets: CargoNet[] = []
  private cargoNetMap: Map<string, CargoNet> = new Map()
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
    this.base.pushToStore()

    this.add
      .text(BASE_X, BASE_Y + 40, 'BASE', {
        color: '#88ccff',
        fontSize: '12px',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 0)

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

    // Restore ships
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
      ship.cargoUpgradeLevel = snap.cargoUpgradeLevel
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[snap.cargoUpgradeLevel]
      ship.attachmentPoints = snap.attachmentPoints
      ship.setAngle(snap.heading)

      if (snap.asteroidTargetId !== null) {
        ship.asteroidTarget = this.asteroidMap.get(snap.asteroidTargetId) ?? null
      }

      this.ships.push(ship)
      this.base.registerShip(ship.id)
      this.attachShipEvents(ship)
    }

    // Rescue any ship stuck in collecting-nets (in-flight nets are not persisted)
    for (const ship of this.ships) {
      if (ship.shipState === 'collecting-nets') {
        ship.departForBase()
      }
    }
  }

  private buildSaveState(): SaveState {
    return {
      schemaVersion: 7,
      worldSeed: gameState.worldSeed,
      gameClock: this.gameClock,
      base: {
        storage: { ...this.base.storage },
        credits: this.base.credits,
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
      })),
      autoMiners: this.autoMiners.map(m => ({
        id: m.id,
        state: m.state,
        asteroidId: m.asteroidId,
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
  }

  private attachMinerEvents(miner: AutoMiner): void {
    miner.on('net-ejected', (net: CargoNet) => {
      this.cargoNets.push(net)
      this.cargoNetMap.set(net.id, net)
    })
  }

  private beginCollecting(ship: Ship, miner: AutoMiner): void {
    const fullNetIds = miner.tetheredNetIds.filter(id => {
      const net = this.cargoNetMap.get(id)
      return net?.state === 'full-tethered'
    })

    const emptyMediumSlots = ship.attachmentPoints.filter(
      ap => ap.size === 'medium' && ap.payload === null,
    )
    const collectCount = Math.min(fullNetIds.length, emptyMediumSlots.length)

    if (collectCount === 0) {
      ship.departForBase()
      return
    }

    // Pre-assign medium slots to prevent double-booking
    for (let i = 0; i < collectCount; i++) {
      emptyMediumSlots[i].payload = { kind: 'cargo-net', netId: fullNetIds[i] }
    }

    ship.beginCollecting()

    let pending = collectCount
    for (let i = 0; i < collectCount; i++) {
      const netId = fullNetIds[i]
      const net = this.cargoNetMap.get(netId)!
      this.tweens.add({
        targets: net,
        x: ship.x,
        y: ship.y,
        delay: i * NET_COLLECT_DURATION_MS,
        duration: NET_COLLECT_DURATION_MS,
        ease: 'Power2',
        onComplete: () => {
          // Apply leakage exactly once at full-tethered → in-transit transition
          net.quantity = Math.floor(net.quantity * (1 - NET_LEAKAGE_FRACTION))
          net.state = 'in-transit'
          net.setVisible(false)
          miner.tetheredNetIds = miner.tetheredNetIds.filter(id => id !== netId)
          ship.pushToStore()
          pending--
          if (pending === 0) {
            ship.departForBase()
          }
        },
      })
    }
  }

  private processNetUnloading(ship: Ship): void {
    for (const ap of ship.attachmentPoints) {
      if (ap.payload?.kind !== 'cargo-net') continue
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

    // Refill NetStore after unload
    const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
    if (netStoreSlot?.payload?.kind === 'net-store') {
      netStoreSlot.payload.currentNets = netStoreSlot.payload.maxNets
    }

    this.base.pushToStore()
    ship.pushToStore()
  }

  private drawTethers(): void {
    if (!this.tetherGfx) return
    this.tetherGfx.clear()
    this.tetherGfx.lineStyle(1, TETHER_LINE_COLOR, TETHER_LINE_ALPHA)
    for (const miner of this.autoMiners) {
      for (const netId of miner.tetheredNetIds) {
        const net = this.cargoNetMap.get(netId)
        if (net) {
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
      this.applyShipUpgrade(cmd.shipId, cmd.stat)
    } else if (cmd.type === 'deployMiner') {
      this.initiateDeployMiner(cmd.haulerId, cmd.asteroidId)
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

    const destX = asteroid.x
    const destY = asteroid.y - 20
    this.tweens.add({
      targets: miner,
      x: destX,
      y: destY,
      duration: MINER_DEPLOY_DURATION_MS,
      ease: 'Power2',
      onComplete: () => {
        miner.state = 'attaching'
        // Attach always succeeds in WI 406
        if (asteroid.currentQuantity <= 0) {
          miner.state = 'standby-beaconing'
        } else {
          miner.state = 'mining'
        }
        miner.pushToStore()
      },
    })

    ship.shipState = 'waiting-at-asteroid'
    ship.pushToStore()
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

  private applyShipUpgrade(shipId: string, stat: 'cargo'): void {
    const ship = this.ships.find(s => s.id === shipId)
    if (!ship) return

    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      const cost = CARGO_UPGRADE_COSTS[ship.cargoUpgradeLevel]
      if (this.base.credits < cost) return
      this.base.credits -= cost
      ship.cargoUpgradeLevel++
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[ship.cargoUpgradeLevel]
    }

    ship.pushToStore()
    this.base.pushToStore()
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
                    if (this.selectedShip && this.shipHasMiner(this.selectedShip)) {
                      const haulerId = this.selectedShip.id
                      commandQueue.update(q => [...q, { type: 'deployMiner', haulerId, asteroidId: hitAsteroid.id }])
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

    // Update deployed miner positions to follow their asteroid
    const deployedStates = new Set<AutoMinerState>([
      'attaching', 'mining', 'ejecting-net', 'net-starved', 'standby-beaconing',
    ])
    for (const miner of this.autoMiners) {
      if (miner.asteroidId && deployedStates.has(miner.state)) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.setPosition(asteroid.x, asteroid.y - 20)
        }
      }
    }

    // Run AutoMiner mining tick
    for (const miner of this.autoMiners) {
      if (miner.state === 'mining' && miner.asteroidId) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.updateMining(dt, asteroid)
        }
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

    // Detect miner in net-starved or standby-beaconing and trigger collection
    for (const miner of this.autoMiners) {
      if (miner.state !== 'standby-beaconing' && miner.state !== 'net-starved') continue
      const waitingShip = this.ships.find(
        s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === miner.asteroidId,
      )
      if (waitingShip) {
        this.beginCollecting(waitingShip, miner)
      }
    }

    this.drawTethers()

    for (const ship of this.ships) {
      // Keep ship target locked to orbiting asteroid
      if (ship.shipState === 'traveling-to-asteroid' && ship.asteroidTarget) {
        ship.target = { x: ship.asteroidTarget.x, y: ship.asteroidTarget.y }
      }
      ship.speedMultiplier = this.computeSpeedMultiplier(ship)
      ship.updateSteering(dt)
      // Detect arrival: steerTowardTarget transitioned to deploying-miner
      if (ship.shipState === 'deploying-miner') {
        this.performDeploy(ship)
      }
    }

    let idle = 0, active = 0, returning = 0
    for (const ship of this.ships) {
      const s = ship.shipState
      if (s === 'idle' || s === 'moving') idle++
      else if (s === 'traveling-to-base' || s === 'unloading') returning++
      else active++
    }
    fleetSummary.set({ idle, active, returning })

    if (this.selectedShip && this.selectionRing) {
      this.drawSelectionRing()
    }

    this.drawMinimap()
  }
}
