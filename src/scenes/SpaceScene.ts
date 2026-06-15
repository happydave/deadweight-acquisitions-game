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
  MINING_RATE_TIERS,
  CARGO_UPGRADE_COSTS,
  MINING_UPGRADE_COSTS,
  MAX_UPGRADE_LEVEL,
} from '../entities/Ship'
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
  private ships: Ship[] = []
  private base!: Base
  private selectedShip: Ship | null = null
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
      ship.autoCycle = snap.autoCycle
      ship.unloadTimer = snap.unloadTimer
      ship.cargoUpgradeLevel = snap.cargoUpgradeLevel
      ship.miningUpgradeLevel = snap.miningUpgradeLevel
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[snap.cargoUpgradeLevel]
      ship.miningRate = MINING_RATE_TIERS[snap.miningUpgradeLevel]
      ship.setAngle(snap.heading)

      this.ships.push(ship)
      this.base.registerShip(ship.id)
      this.attachShipInput(ship)
    }

    // Resolve miningTargetId → live Asteroid instance
    for (let i = 0; i < this.ships.length; i++) {
      const snap = save.ships[i]
      const ship = this.ships[i]
      if (snap.miningTargetId !== null) {
        const asteroid = this.asteroids.find(a => a.id === snap.miningTargetId) ?? null
        ship.miningTarget = asteroid
        if (asteroid === null && (ship.shipState === 'traveling-to-target' || ship.shipState === 'mining')) {
          ship.shipState = 'idle'
          ship.target = null
        }
      }
    }
  }

  private buildSaveState(): SaveState {
    return {
      schemaVersion: 4,
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
        miningTargetId: s.miningTarget?.id ?? null,
        cargoContents: { ...s.cargoContents },
        cargoCapacity: s.cargoCapacity,
        miningRate: s.miningRate,
        cargoUpgradeLevel: s.cargoUpgradeLevel,
        miningUpgradeLevel: s.miningUpgradeLevel,
        autoCycle: s.autoCycle,
        unloadTimer: s.unloadTimer,
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
    this.ships.push(ship)
    this.base.registerShip(ship.id)
    this.attachShipInput(ship)
  }

  private attachShipInput(ship: Ship): void {
    ship.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return
      this.selectShip(ship)
    })
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

  private removeDepletedAsteroids(): void {
    const depleted = this.asteroids.filter(a => a.currentQuantity <= 0)
    if (depleted.length === 0) return
    for (const asteroid of depleted) {
      for (const ship of this.ships) {
        ship.notifyTargetDestroyed(asteroid)
      }
      asteroid.destroy()
    }
    this.asteroids = this.asteroids.filter(a => a.currentQuantity > 0)
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
    if (cmd.type === 'toggleAutoCycle') {
      const ship = this.ships.find(s => s.id === cmd.shipId)
      if (ship) ship.setAutoCycle(!ship.autoCycle)
    } else if (cmd.type === 'sellResource') {
      this.base.sellResource(cmd.resourceType)
    } else if (cmd.type === 'commissionShip') {
      this.commissionNewShip()
    } else if (cmd.type === 'manualSave') {
      GameSaveService.save(this.buildSaveState())
    } else if (cmd.type === 'upgradeShip') {
      this.applyShipUpgrade(cmd.shipId, cmd.stat)
    }
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
    this.attachShipInput(ship)
  }

  private applyShipUpgrade(shipId: string, stat: 'cargo' | 'mining'): void {
    const ship = this.ships.find(s => s.id === shipId)
    if (!ship) return

    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      const cost = CARGO_UPGRADE_COSTS[ship.cargoUpgradeLevel]
      if (this.base.credits < cost) return
      this.base.credits -= cost
      ship.cargoUpgradeLevel++
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[ship.cargoUpgradeLevel]
    } else {
      if (ship.miningUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      const cost = MINING_UPGRADE_COSTS[ship.miningUpgradeLevel]
      if (this.base.credits < cost) return
      this.base.credits -= cost
      ship.miningUpgradeLevel++
      ship.miningRate = MINING_RATE_TIERS[ship.miningUpgradeLevel]
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
            const hitBase = targets.find(t => t instanceof Base)
            if (hitBase) {
              selectedAsteroid.set(null)
              basePanelOpen.set(true)
            } else {
              const hitAsteroid = targets.find(t => t instanceof Asteroid) as Asteroid | undefined
              if (hitAsteroid) {
                if (this.selectedShip) {
                  this.selectedShip.issueMineOrder(hitAsteroid)
                } else {
                  selectedShip.set(null)
                  hitAsteroid.selectSelf()
                }
              } else {
                this.clearSelection()
                basePanelOpen.set(false)
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

    for (const ship of this.ships) {
      ship.updateSteering(dt)
    }

    this.removeDepletedAsteroids()

    let idle = 0, mining = 0, returning = 0
    for (const ship of this.ships) {
      const s = ship.shipState
      if (s === 'idle' || s === 'moving') idle++
      else if (s === 'traveling-to-target' || s === 'mining') mining++
      else returning++
    }
    fleetSummary.set({ idle, mining, returning })

    if (this.selectedShip && this.selectionRing) {
      this.drawSelectionRing()
    }

    this.drawMinimap()
  }
}
