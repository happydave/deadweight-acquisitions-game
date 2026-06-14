import Phaser from 'phaser'
import { generateWorld } from '../world/worldGenerator'
import {
  ASTEROID_TEXTURE_SIZE,
  RESOURCE_COLORS,
  type ResourceType,
} from '../world/worldConfig'
import { Asteroid } from '../entities/Asteroid'
import { Ship, generateShipTexture, DRAG_ORDER_THRESHOLD } from '../entities/Ship'
import { gameState } from '../state/gameState'

const WORLD_SIZE = 6000
const MAX_ZOOM = 2
const PAN_SPEED = 500 // world units per second
const STAR_TEXTURE_SIZE = 512

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

  constructor() {
    super({ key: 'SpaceScene' })
  }

  create(): void {
    this.buildStarLayers()
    this.generateAsteroidTextures()
    generateShipTexture(this)
    this.createBase()
    this.spawnWorld()
    this.spawnStarterShip()
    this.setupCamera()
    this.setupInput()
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.onResize(size))
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

  private spawnStarterShip(): void {
    const ship = new Ship(this, 0, 0, 'Hauler-01')
    this.ships.push(ship)
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
    ship.pushToStore()
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

  private createBase(): void {
    const gfx = this.add.graphics()
    gfx.fillStyle(0x44aaff, 1)
    gfx.fillCircle(0, 0, 20)
    gfx.lineStyle(2, 0x88ccff, 1)
    gfx.strokeCircle(0, 0, 32)
    this.add
      .text(0, 40, 'BASE', { color: '#88ccff', fontSize: '12px', fontFamily: 'monospace' })
      .setOrigin(0.5, 0)
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
            this.clearSelection()
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
    const dt = delta / 1000
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

    if (this.selectedShip && this.selectionRing) {
      this.drawSelectionRing()
    }
  }
}
