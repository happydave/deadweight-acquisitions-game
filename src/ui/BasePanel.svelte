<script lang="ts">
  import { baseState, basePanelOpen } from '../state/baseStore'

  const RESOURCE_LABELS: Record<string, string> = {
    iron: 'Iron',
    ice: 'Ice',
    silicates: 'Silicates',
    'rare-metals': 'Rare Metals',
  }

  function totalStored(storage: Record<string, number>): number {
    return Object.values(storage).reduce((sum, n) => sum + n, 0)
  }

  function storageEntries(storage: Record<string, number>): [string, number][] {
    return Object.entries(storage).filter(([, qty]) => qty > 0)
  }

  function close(): void {
    basePanelOpen.set(false)
  }
</script>

{#if $basePanelOpen}
  <div class="panel">
    <div class="header">
      <span class="title">BASE STORAGE</span>
      <button class="close-btn" on:click={close}>✕</button>
    </div>
    <div class="row">
      <span class="label">Total</span>
      <span class="value">{Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}</span>
    </div>
    <div class="row">
      <span class="label">Credits</span>
      <span class="value credits">{$baseState.credits}</span>
    </div>
    {#each storageEntries($baseState.storage) as [type, qty]}
      <div class="row storage-row">
        <span class="label resource-{type}">{RESOURCE_LABELS[type] ?? type}</span>
        <span class="value">{Math.floor(qty)}</span>
      </div>
    {/each}
    {#if storageEntries($baseState.storage).length === 0}
      <div class="empty">Empty</div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 24px;
    left: 24px;
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

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .title {
    font-size: 13px;
    color: #44aaff;
    letter-spacing: 0.05em;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6a8a9a;
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
    padding: 0 2px;
  }

  .close-btn:hover {
    color: #aaccee;
  }

  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .storage-row {
    padding-left: 8px;
  }

  .label {
    color: #6a8a9a;
  }

  .value {
    color: #cce0f0;
  }

  .credits {
    color: #ffdd88;
  }

  .empty {
    color: #4a6a7a;
    font-size: 11px;
    margin-top: 4px;
  }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }
</style>
