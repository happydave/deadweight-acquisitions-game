import Phaser from 'phaser'

export const PLANET_TEXTURE_KEY = 'planet'
export const PLANET_RADIUS = 280

export function generatePlanetTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLANET_TEXTURE_KEY)) return

  const size = PLANET_RADIUS * 2 + 8
  const cx = size / 2
  const cy = size / 2

  const gfx = scene.make.graphics({ x: 0, y: 0 })

  // Body — deep blue-grey gas giant
  gfx.fillStyle(0x1a2a44, 1)
  gfx.fillCircle(cx, cy, PLANET_RADIUS)

  // Subtle atmospheric banding
  gfx.fillStyle(0x1e3050, 0.5)
  gfx.fillEllipse(cx, cy - PLANET_RADIUS * 0.2, PLANET_RADIUS * 1.8, PLANET_RADIUS * 0.35)
  gfx.fillStyle(0x152236, 0.4)
  gfx.fillEllipse(cx, cy + PLANET_RADIUS * 0.25, PLANET_RADIUS * 1.6, PLANET_RADIUS * 0.28)

  // Rim highlight
  gfx.lineStyle(3, 0x3a6090, 0.6)
  gfx.strokeCircle(cx, cy, PLANET_RADIUS)

  gfx.generateTexture(PLANET_TEXTURE_KEY, size, size)
  gfx.destroy()
}

export class Planet extends Phaser.GameObjects.Image {
  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, PLANET_TEXTURE_KEY)
    scene.add.existing(this)
    this.setDepth(-10)
  }
}
