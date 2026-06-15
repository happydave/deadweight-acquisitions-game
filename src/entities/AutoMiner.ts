import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedAutoMiner } from '../state/autoMinerStore'
import type { ResourceType } from '../world/worldConfig'
import type { Asteroid } from './Asteroid'

export type AutoMinerState =
  | 'in-transit'
  | 'deploying'
  | 'attaching'
  | 'mining'
  | 'ejecting-net'
  | 'net-starved'
  | 'standby-beaconing'

export interface TetheredNetData {
  readonly id: string
  readonly resourceType: ResourceType
  readonly quantity: number
}

export const MINER_RATE = 5               // resource units per second
export const NET_CAPACITY = 50            // resource units per net
export const MINER_INITIAL_NETS = 3       // spare nets transferred on deploy (+ 1 active = 4 total)
export const MINER_DEPLOY_DURATION_MS = 2000
export const MINER_DEPLOY_PROXIMITY = 80  // world units; Hauler arrival threshold
export const MINER_TEXTURE_KEY = 'autominer'

export function generateAutoMinerTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(MINER_TEXTURE_KEY)) return
  const w = 14
  const h = 14
  const cx = w / 2
  const cy = h / 2
  const r = 5
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  // Diamond body
  gfx.fillStyle(0x3a5570, 1)
  gfx.fillPoints(
    [
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ],
    true,
  )
  // Bright center
  gfx.fillStyle(0x88ccee, 0.9)
  gfx.fillRect(cx - 2, cy - 2, 4, 4)
  // Outline
  gfx.lineStyle(1, 0xaaddee, 0.9)
  gfx.strokePoints(
    [
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ],
    true,
  )
  gfx.generateTexture(MINER_TEXTURE_KEY, w, h)
  gfx.destroy()
}

export class AutoMiner extends Phaser.GameObjects.Image {
  readonly id: string
  state: AutoMinerState
  asteroidId: string | null
  spareNetCount: number
  activeNetFill: number
  tetheredNets: TetheredNetData[]
  readonly technologyLevel: number
  isSelected: boolean

  constructor(scene: Phaser.Scene, id?: string) {
    super(scene, 0, 0, MINER_TEXTURE_KEY)
    this.id = id ?? nanoid()
    this.state = 'in-transit'
    this.asteroidId = null
    this.spareNetCount = 0
    this.activeNetFill = 0
    this.tetheredNets = []
    this.technologyLevel = 1
    this.isSelected = false

    scene.add.existing(this)
    this.setOrigin(0.5, 0.5)
    this.setInteractive()
    this.setVisible(false)
  }

  updateMining(dt: number, asteroid: Asteroid): void {
    if (this.state !== 'mining') return

    const extracted = Math.min(MINER_RATE * dt, asteroid.currentQuantity)
    asteroid.currentQuantity -= extracted
    this.activeNetFill += extracted
    asteroid.pushToStore()

    if (asteroid.currentQuantity <= 0) {
      this.state = 'standby-beaconing'
      this.pushToStore()
      return
    }

    if (this.activeNetFill >= NET_CAPACITY) {
      this.ejectNet(asteroid.resourceType)
    }
  }

  private ejectNet(resourceType: ResourceType): void {
    this.state = 'ejecting-net'
    this.tetheredNets = [
      ...this.tetheredNets,
      { id: nanoid(), resourceType, quantity: this.activeNetFill },
    ]
    this.activeNetFill = 0

    this.playEjectEffect()

    if (this.spareNetCount > 0) {
      this.spareNetCount--
      this.state = 'mining'
    } else {
      this.state = 'net-starved'
    }

    this.pushToStore()
  }

  private playEjectEffect(): void {
    const dot = this.scene.add.circle(this.x, this.y, 3, 0xffcc44, 1)
    this.scene.tweens.add({
      targets: dot,
      x: this.x + 15,
      y: this.y - 15,
      alpha: 0,
      duration: 500,
      ease: 'Power1',
      onComplete: () => dot.destroy(),
    })
  }

  select(): void {
    this.isSelected = true
    this.pushToStore()
  }

  deselect(): void {
    this.isSelected = false
    selectedAutoMiner.set(null)
  }

  pushToStore(): void {
    if (!this.isSelected) return
    selectedAutoMiner.set({
      id: this.id,
      state: this.state,
      asteroidId: this.asteroidId,
      activeNetFill: this.activeNetFill,
      spareNetCount: this.spareNetCount,
      tetheredNetCount: this.tetheredNets.length,
    })
  }

  destroy(fromScene?: boolean): void {
    if (this.isSelected) selectedAutoMiner.set(null)
    super.destroy(fromScene)
  }
}
