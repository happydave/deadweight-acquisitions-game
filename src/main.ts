import Phaser from 'phaser'
import { mount } from 'svelte'
import { BootScene } from './scenes/BootScene'
import { SpaceScene } from './scenes/SpaceScene'
import Hud from './ui/Hud.svelte'
import EntityPanel from './ui/EntityPanel.svelte'
import BasePanel from './ui/BasePanel.svelte'

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#05050f',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, SpaceScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
})

const hudTarget = document.getElementById('hud')
if (hudTarget) {
  mount(Hud, { target: hudTarget })
  mount(EntityPanel, { target: hudTarget })
  mount(BasePanel, { target: hudTarget })
}
