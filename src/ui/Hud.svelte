<script lang="ts">
  import { baseState } from '../state/baseStore'
  import { fleetSummary } from '../state/fleetStore'

  function totalStored(storage: Record<string, number>): number {
    return Object.values(storage).reduce((sum, n) => sum + n, 0)
  }

  function storageEntries(storage: Record<string, number>): [string, number][] {
    return Object.entries(storage).filter(([, qty]) => qty > 0)
  }
</script>

<div class="hud">
  <div class="hud-label">Deadweight Acquisitions</div>
  <div class="hud-row">
    <span class="hud-key">Storage</span>
    <span class="hud-val">{Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}</span>
  </div>
  {#each storageEntries($baseState.storage) as [type, qty]}
    <div class="hud-row hud-indent">
      <span class="hud-key resource-{type}">{type}</span>
      <span class="hud-val">{Math.floor(qty)}</span>
    </div>
  {/each}
  <div class="hud-row">
    <span class="hud-key">Credits</span>
    <span class="hud-val credits">{$baseState.credits}</span>
  </div>
  <div class="hud-row hud-section">
    <span class="hud-key">Fleet</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Idle</span>
    <span class="hud-val">{$fleetSummary.idle}</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Mining</span>
    <span class="hud-val">{$fleetSummary.mining}</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Returning</span>
    <span class="hud-val">{$fleetSummary.returning}</span>
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

  .hud-section {
    margin-top: 6px;
  }

  .hud-indent {
    padding-left: 8px;
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

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }
</style>
