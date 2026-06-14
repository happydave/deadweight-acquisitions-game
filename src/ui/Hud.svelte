<script lang="ts">
  import { baseState } from '../state/baseStore'

  function totalStored(storage: Record<string, number>): number {
    return Object.values(storage).reduce((sum, n) => sum + n, 0)
  }
</script>

<div class="hud">
  <div class="hud-label">Deadweight Acquisitions</div>
  <div class="hud-row">
    <span class="hud-key">Storage</span>
    <span class="hud-val">{Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}</span>
  </div>
  <div class="hud-row">
    <span class="hud-key">Credits</span>
    <span class="hud-val credits">{$baseState.credits}</span>
  </div>
</div>

<style>
  .hud {
    position: absolute;
    top: 12px;
    left: 12px;
    font-family: monospace;
    font-size: 11px;
    pointer-events: none;
  }

  .hud-label {
    color: #6a8a6a;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }

  .hud-row {
    display: flex;
    gap: 8px;
    margin-bottom: 2px;
  }

  .hud-key {
    color: #4a6a7a;
    min-width: 52px;
  }

  .hud-val {
    color: #aaccee;
  }

  .credits {
    color: #ffdd88;
  }
</style>
