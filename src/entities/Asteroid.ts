import Phaser from 'phaser'
import { SIZE_CONFIGS, type ResourceType, type SizeCategory } from '../world/worldConfig'
import type { AsteroidData } from '../world/worldGenerator'

export class Asteroid extends Phaser.GameObjects.Image {
  readonly resourceType: ResourceType
  currentQuantity: number
  readonly maxQuantity: number
  readonly sizeCategory: SizeCategory

  constructor(scene: Phaser.Scene, data: AsteroidData) {
    super(scene, data.x, data.y, `asteroid-${data.resourceType}`)
    this.resourceType = data.resourceType
    this.currentQuantity = data.currentQuantity
    this.maxQuantity = data.maxQuantity
    this.sizeCategory = data.sizeCategory
    this.setScale(SIZE_CONFIGS[data.sizeCategory].scale)
    scene.add.existing(this)
    this.setInteractive()
    this.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this)
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) return
    console.log(
      `Asteroid | type: ${this.resourceType} | size: ${this.sizeCategory}` +
      ` | qty: ${this.currentQuantity}/${this.maxQuantity}` +
      ` | pos: (${Math.round(this.x)}, ${Math.round(this.y)})`
    )
  }
}
