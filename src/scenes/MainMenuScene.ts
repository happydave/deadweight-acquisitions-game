import Phaser from 'phaser'
import { GameSaveService } from '../services/GameSaveService'

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' })
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.add
      .text(cx, cy - 80, 'DEADWEIGHT ACQUISITIONS', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#4a7a9a',
        letterSpacing: 3,
      })
      .setOrigin(0.5, 0.5)

    this.add
      .text(cx, cy - 48, 'CORP.', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#2a5a6a',
        letterSpacing: 2,
      })
      .setOrigin(0.5, 0.5)

    const hasSave = GameSaveService.hasSave()

    if (hasSave) {
      this.makeButton(cx, cy + 10, 'CONTINUE', () => {
        this.scene.start('SpaceScene')
      })
    }

    this.makeButton(cx, cy + (hasSave ? 54 : 10), 'NEW GAME', () => {
      GameSaveService.clear()
      this.scene.start('SpaceScene')
    })
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, `[ ${label} ]`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#6aaaca',
      })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true })

    btn.on('pointerover', () => btn.setColor('#aaddff'))
    btn.on('pointerout', () => btn.setColor('#6aaaca'))
    btn.on('pointerdown', onClick)
  }
}
