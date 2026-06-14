import Phaser from 'phaser'
import { get } from 'svelte/store'
import { generateWorld } from '../world/worldGenerator'
import {
  ASTEROID_TEXTURE_SIZE,
  RESOURCE_COLORS,
  type ResourceType,
} from '../world/worldConfig'
import { Asteroid } from '../entities/Asteroid'
import { Base, generateBaseTexture } from '../entities/Base'
import { Ship, generateShipTexture, DRAG_ORDER_THRESHOLD } from '../entities/Ship'
import { gameState, type SaveState } from '../state/gameState'
import { commandQueue, type GameCommand } from '../state/commandStore'
import { selectedAsteroid, selectedShip } from '../state/shipStore'
import { basePanelOpen } from '../state/baseStore'
import { fleetSummary } from '../state/fleetStore'
import { GameSaveService } from '../services/GameSaveService'

const WORLD_SIZE = 6000
const MAX_ZOOM = 2
const PAN_SPEED = 500 // world units per second
const STAR_TEXTURE_SIZE = 512
const BASE_X = 0
const BASE_Y = 0
const AUTO_SAVE_INTERVAL = 60 // real-world seconds

const STAR_LAYERS = [
  { key: 'stars-far',  count: 22, parallax: 0.07, brightMin: 120, largeChance: 0.00 },
  { key: 'stars-mid',  count: 15, parallax: 0.10, brightMin: 160, largeChance: 0.00 },
  { key: 'stars-near', count:  8, parallax: 0.14, brightMin: 200, largeChance: 0.40 },
] as const

const SELECTION_RING_COLOR = 0x44ffaa
const SELECTION_RING_RADIUS = 20
const SELECTION_RING_ALPHA = 0.8

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

    const save = GameSaveService.load()
    if (save !== null) {
      this.loadFromSave(save)
    } else {
      this.spawnBase()
      this.spawnWorld()
      this.spawnStarterShip()
    }

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
      schemaVersion: 1,
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
        resourceType: a.resourceType,
        sizeCategory: a.sizeCategory,
        currentQuantity: a.currentQuantity,
        maxQuantity: a.maxQuantity,
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

    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, targets: Phaser.GameObjects.GameObject[]) => {
        if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
          this.isDragging = true
          this.dragLastX = pointer.x
          this.dragLastY = pointer.y
          if (pointer.rightButtonDown()) {
            this.rightDownX = pointer.x
            this.rightDownY = pointer.y
          }
        }

        if (pointer.leftButtonDown()) {
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

    const cam = this.cameras.main
    const speed = PAN_SPEED * dt

    const left = this.cursors.left.isDown || this.wasd.left.isDown
    const right = this.cursors.right.isDown || this.wasd.right.isDown
    const up = this.cursors.up.isDown || this.wasd.up.isDown
    const down = this.cursors.down.isDown || this.wasd.down.isDown

    if (left) cam.scrollX -= speed
    else if (right) cam.scrollX += speed

    if (up) cam.scrollY -= speed
    else if (down) cam.scrollY += speed

    for (let i = 0; i < this.starLayers.length; i++) {
      this.starLayers[i].tilePositionX = cam.scrollX * STAR_LAYERS[i].parallax
      this.starLayers[i].tilePositionY = cam.scrollY * STAR_LAYERS[i].parallax
    }

    for (const ship of this.ships) {
      ship.updateSteering(dt)
    }

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
  }
}
