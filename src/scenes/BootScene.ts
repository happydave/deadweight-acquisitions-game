import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // No assets in scaffolding — load path is structurally complete
  }

  create(): void {
    this.scene.start('SpaceScene')
  }
}
