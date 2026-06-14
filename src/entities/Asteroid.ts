import Phaser from 'phaser'
import { SIZE_CONFIGS, type ResourceType, type SizeCategory } from '../world/worldConfig'
import type { AsteroidData } from '../world/worldGenerator'
import { selectedAsteroid } from '../state/shipStore'
import { get } from 'svelte/store'

export class Asteroid extends Phaser.GameObjects.Image {
  readonly id: string
  readonly resourceType: ResourceType
  currentQuantity: number
  readonly maxQuantity: number
  readonly sizeCategory: SizeCategory

  constructor(scene: Phaser.Scene, data: AsteroidData) {
    super(scene, data.x, data.y, `asteroid-${data.resourceType}`)
    this.id = data.id
    this.resourceType = data.resourceType
    this.currentQuantity = data.currentQuantity
    this.maxQuantity = data.maxQuantity
    this.sizeCategory = data.sizeCategory
    this.setScale(SIZE_CONFIGS[data.sizeCategory].scale)
    scene.add.existing(this)
    this.setInteractive()
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
}
