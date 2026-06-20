import Phaser from 'phaser'
import { SIZE_CONFIGS, ASTEROID_TEXTURE_SIZE, ORBITAL_K, type ResourceType, type SizeCategory } from '../world/worldConfig'
import type { Composition } from '../world/composition'
import type { AsteroidData } from '../world/worldGenerator'
import { selectedAsteroid } from '../state/shipStore'
import { get } from 'svelte/store'

const COMPANY_RING_RADIUS = ASTEROID_TEXTURE_SIZE * 1.2  // slightly larger than the largest visual
const COMPANY_RING_COLOR = 0x44ffdd
const COMPANY_RING_ALPHA = 0.85
const COMPANY_RING_WIDTH = 1.5
const DEPLETION_SCALE_MIN = 0.2

export class Asteroid extends Phaser.GameObjects.Image {
  readonly id: string
  readonly resourceType: ResourceType
  readonly composition: Composition
  scanned: boolean
  currentQuantity: number
  readonly maxQuantity: number
  readonly sizeCategory: SizeCategory
  readonly isCompany: boolean
  orbitalRadius: number
  orbitalAngle: number
  private readonly baseScale: number
  private companyRing: Phaser.GameObjects.Graphics | null = null

  constructor(scene: Phaser.Scene, data: AsteroidData) {
    super(scene, 0, 0, `asteroid-${data.resourceType}`)
    this.id = data.id
    this.resourceType = data.resourceType
    this.composition = data.composition
    this.scanned = data.scanned
    this.currentQuantity = data.currentQuantity
    this.maxQuantity = data.maxQuantity
    this.sizeCategory = data.sizeCategory
    this.isCompany = data.isCompany
    this.orbitalRadius = data.orbitalRadius
    this.orbitalAngle = data.orbitalAngle
    this.baseScale = SIZE_CONFIGS[data.sizeCategory].scale
    const depletionRatio = data.maxQuantity > 0 ? data.currentQuantity / data.maxQuantity : 1
    this.setScale(this.baseScale * Math.max(DEPLETION_SCALE_MIN, depletionRatio))
    this.x = Math.cos(this.orbitalAngle) * this.orbitalRadius
    this.y = Math.sin(this.orbitalAngle) * this.orbitalRadius
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

  updateOrbit(dt: number): void {
    this.orbitalAngle += (ORBITAL_K / Math.max(this.orbitalRadius, 1) ** 1.5) * dt
    this.x = Math.cos(this.orbitalAngle) * this.orbitalRadius
    this.y = Math.sin(this.orbitalAngle) * this.orbitalRadius
    if (this.companyRing) {
      this.companyRing.clear()
      this.companyRing.lineStyle(COMPANY_RING_WIDTH, COMPANY_RING_COLOR, COMPANY_RING_ALPHA)
      this.companyRing.strokeCircle(this.x, this.y, COMPANY_RING_RADIUS)
    }
  }

  pushToStore(): void {
    const ratio = this.maxQuantity > 0 ? this.currentQuantity / this.maxQuantity : 0
    this.setScale(this.baseScale * Math.max(DEPLETION_SCALE_MIN, ratio))

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
    if (get(selectedAsteroid)?.id === this.id) {
      selectedAsteroid.set(null)
    }
    if (this.companyRing) {
      this.companyRing.destroy()
      this.companyRing = null
    }
    super.destroy(fromScene)
  }
}
