<script lang="ts">
  import { selectedShip, selectedAsteroid } from '../state/shipStore'

  function cargoTotal(contents: Record<string, number>): number {
    return Object.values(contents).reduce((sum, n) => sum + n, 0)
  }

  function cargoEntries(contents: Record<string, number>): [string, number][] {
    return Object.entries(contents).filter(([, qty]) => qty > 0)
  }

  function slotLabel(size: string): string {
    return size === 'small' ? 'S' : 'M'
  }

  function payloadLabel(payload: { kind: string; currentNets?: number; maxNets?: number } | null): string {
    if (payload === null) return 'empty'
    if (payload.kind === 'net-store') return `net-store [${payload.currentNets}/${payload.maxNets}]`
    return payload.kind
  }
</script>

{#if $selectedShip}
  <div class="panel">
    <div class="name">{$selectedShip.name}</div>
    <div class="row">
      <span class="label">State</span>
      <span class="value state-{$selectedShip.state}">{$selectedShip.state}</span>
    </div>
    {#if $selectedShip.state === 'unloading'}
      <div class="unload-bar-track">
        <div class="unload-bar-fill" style="width: {$selectedShip.unloadProgress * 100}%"></div>
      </div>
    {/if}
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
    <div class="section-label">ATTACHMENT POINTS</div>
    {#each $selectedShip.attachmentPoints as ap, i}
      <div class="row ap-row">
        <span class="ap-slot">{i + 1} [{slotLabel(ap.size)}]</span>
        <span class="ap-payload payload-{ap.payload?.kind ?? 'empty'}">{payloadLabel(ap.payload as { kind: string; currentNets?: number; maxNets?: number } | null)}</span>
      </div>
    {/each}
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
    min-width: 220px;
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

  .unload-bar-track {
    height: 5px;
    background: rgba(30, 50, 80, 0.8);
    border-radius: 2px;
    margin-bottom: 6px;
    overflow: hidden;
  }

  .unload-bar-fill {
    height: 100%;
    background: #88ccff;
    border-radius: 2px;
    transition: width 0.05s linear;
  }

  .section-label {
    font-size: 9px;
    color: #3a6a8a;
    letter-spacing: 0.08em;
    margin-top: 8px;
    margin-bottom: 4px;
    border-top: 1px solid #1a3a5a;
    padding-top: 6px;
  }

  .ap-row {
    padding-left: 4px;
    margin-bottom: 3px;
  }

  .ap-slot {
    color: #6a8a9a;
    min-width: 40px;
  }

  .ap-payload {
    color: #7a9aaa;
    font-size: 11px;
  }

  .payload-net-store {
    color: #88ddaa;
  }

  .state-idle            { color: #88ffaa; }
  .state-moving          { color: #ffdd88; }
  .state-traveling-to-base   { color: #ff9944; }
  .state-unloading       { color: #44aaff; }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }
</style>
