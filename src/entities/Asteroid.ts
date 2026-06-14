import Phaser from 'phaser'
import { SIZE_CONFIGS, ASTEROID_TEXTURE_SIZE, type ResourceType, type SizeCategory } from '../world/worldConfig'
import type { AsteroidData } from '../world/worldGenerator'
import { selectedAsteroid } from '../state/shipStore'
import { get } from 'svelte/store'

const COMPANY_RING_RADIUS = ASTEROID_TEXTURE_SIZE * 1.2  // slightly larger than the largest visual
const COMPANY_RING_COLOR = 0x44ffdd
const COMPANY_RING_ALPHA = 0.85
const COMPANY_RING_WIDTH = 1.5

export class Asteroid extends Phaser.GameObjects.Image {
  readonly id: string
  readonly resourceType: ResourceType
  currentQuantity: number
  readonly maxQuantity: number
  readonly sizeCategory: SizeCategory
  readonly isCompany: boolean
  private companyRing: Phaser.GameObjects.Graphics | null = null

  constructor(scene: Phaser.Scene, data: AsteroidData) {
    super(scene, data.x, data.y, `asteroid-${data.resourceType}`)
    this.id = data.id
    this.resourceType = data.resourceType
    this.currentQuantity = data.currentQuantity
    this.maxQuantity = data.maxQuantity
    this.sizeCategory = data.sizeCategory
    this.isCompany = data.isCompany
    this.setScale(SIZE_CONFIGS[data.sizeCategory].scale)
    scene.add.existing(this)
    this.setInteractive()

    if (this.isCompany) {
      this.companyRing = scene.add.graphics()
      this.companyRing.lineStyle(COMPANY_RING_WIDTH, COMPANY_RING_COLOR, COMPANY_RING_ALPHA)
      this.companyRing.strokeCircle(data.x, data.y, COMPANY_RING_RADIUS)

      scene.tweens.add({
        targets: this.companyRing,
        alpha: { from: COMPANY_RING_ALPHA, to: 0.1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
  }

  pushToStore(): void {
    const current = get(selectedAsteroid)
    if (current?.id !== this.id) return
    selectedAsteroid.set({
      id: this.id,
      resourceType: this.resourceType,
      currentQuantity: this.currentQuantity,
      maxQuantity: this.maxQuantity,
      sizeCategory: this.sizeCategory,
    })
  }

  selectSelf(): void {
    selectedAsteroid.set({
      id: this.id,
      resourceType: this.resourceType,
      currentQuantity: this.currentQuantity,
      maxQuantity: this.maxQuantity,
      sizeCategory: this.sizeCategory,
    })
  }

  destroy(fromScene?: boolean): void {
    if (this.companyRing) {
      this.companyRing.destroy()
      this.companyRing = null
    }
    super.destroy(fromScene)
  }
}
