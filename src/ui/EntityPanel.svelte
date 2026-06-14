<script lang="ts">
  import { selectedShip, selectedAsteroid } from '../state/shipStore'
  import { commandQueue } from '../state/commandStore'

  function cargoTotal(contents: Record<string, number>): number {
    return Object.values(contents).reduce((sum, n) => sum + n, 0)
  }

  function cargoEntries(contents: Record<string, number>): [string, number][] {
    return Object.entries(contents).filter(([, qty]) => qty > 0)
  }

  function toggleAutoCycle(): void {
    if (!$selectedShip) return
    commandQueue.update(q => [...q, { type: 'toggleAutoCycle', shipId: $selectedShip!.id }])
  }
</script>

{#if $selectedShip}
  <div class="panel">
    <div class="name">{$selectedShip.name}</div>
    <div class="row">
      <span class="label">State</span>
      <span class="value state-{$selectedShip.state}">{$selectedShip.state}</span>
    </div>
    <div class="row">
      <span class="label">Cargo</span>
      <span class="value">{Math.floor(cargoTotal($selectedShip.cargoContents))} / {$selectedShip.cargoCapacity}</span>
    </div>
    {#each cargoEntries($selectedShip.cargoContents) as [type, qty]}
      <div class="row cargo-row">
        <span class="label resource-{type}">{type}</span>
        <span class="value">{Math.floor(qty)}</span>
      </div>
    {/each}
    <button
      class="btn"
      class:btn-active={$selectedShip.autoCycle}
      on:click={toggleAutoCycle}
    >
      Auto {$selectedShip.autoCycle ? 'ON' : 'OFF'}
    </button>
  </div>
{:else if $selectedAsteroid}
  <div class="panel">
    <div class="name asteroid-name">{$selectedAsteroid.resourceType}</div>
    <div class="row">
      <span class="label">Size</span>
      <span class="value">{$selectedAsteroid.sizeCategory}</span>
    </div>
    <div class="row">
      <span class="label">Quantity</span>
      <span class="value">{Math.floor($selectedAsteroid.currentQuantity)} / {$selectedAsteroid.maxQuantity}</span>
    </div>
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 24px;
    right: 24px;
    background: rgba(5, 10, 20, 0.85);
    border: 1px solid #2a4a6a;
    border-radius: 4px;
    padding: 12px 16px;
    min-width: 200px;
    font-family: monospace;
    font-size: 12px;
    color: #aaccee;
    pointer-events: auto;
  }

  .name {
    font-size: 13px;
    color: #88ddff;
    margin-bottom: 8px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .asteroid-name {
    color: #cc9966;
  }

  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .cargo-row {
    padding-left: 8px;
  }

  .label {
    color: #6a8a9a;
  }

  .value {
    color: #cce0f0;
  }

  .state-idle            { color: #88ffaa; }
  .state-moving          { color: #ffdd88; }
  .state-traveling-to-target { color: #ffdd88; }
  .state-mining          { color: #44ffcc; }
  .state-traveling-to-base   { color: #ff9944; }
  .state-unloading       { color: #44aaff; }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }

  .btn {
    margin-top: 10px;
    width: 100%;
    padding: 5px 0;
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 11px;
    cursor: pointer;
  }

  .btn:hover {
    background: rgba(60, 100, 150, 0.7);
  }

  .btn-active {
    background: rgba(30, 80, 50, 0.7);
    border-color: #44aa66;
    color: #88ffaa;
  }
</style>
