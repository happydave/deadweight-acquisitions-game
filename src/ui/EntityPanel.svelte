<script lang="ts">
  import { selectedShip } from '../state/shipStore'

  function cargoTotal(contents: Record<string, number>): number {
    return Object.values(contents).reduce((sum, n) => sum + n, 0)
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
      <span class="value">{cargoTotal($selectedShip.cargoContents)} / {$selectedShip.cargoCapacity}</span>
    </div>
    <button class="btn" on:click={() => console.log('Recall to Base — not yet implemented')}>
      Recall to Base
    </button>
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
    min-width: 180px;
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
  }

  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .label {
    color: #6a8a9a;
  }

  .value {
    color: #cce0f0;
  }

  .state-idle {
    color: #88ffaa;
  }

  .state-moving {
    color: #ffdd88;
  }

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
</style>
