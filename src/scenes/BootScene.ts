import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // Generated ship atlas (asset-harness, Z-Image clean stack). Frames: 'hauler', 'miner'.
    this.load.atlas('dwa_ships', 'assets/dwa_ships.png', 'assets/dwa_ships.json')
  }

  create(): void {
    this.scene.start('MainMenuScene')
  }
}
