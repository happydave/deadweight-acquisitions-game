<script lang="ts">
  import { baseState, basePanelOpen, stationUsage } from '../state/baseStore'
  import { commandQueue } from '../state/commandStore'
  import { selectedShip } from '../state/shipStore'
  import { RESOURCE_SELL_PRICES, type ResourceType } from '../world/worldConfig'
  import { SHIP_COMMISSION_COST } from '../entities/Base'
  import { AUTOMINER_PURCHASE_COST, STATION_MINER_SLOT_CAP } from '../entities/AutoMiner'
  import {
    MAX_UPGRADE_LEVEL,
    CARGO_CAPACITY_TIERS,
    CARGO_UPGRADE_COSTS,
  } from '../entities/Ship'
  import { SERVICE_SLOT_COUNT } from '../world/serviceSlots'
  import { HANGAR_BAY_COUNT } from '../world/hangarBays'
  import { getPrice } from '../world/pricingSeam'

  const DOCK_COST    = getPrice('owned-dock-purchase')
  const HANGAR_COST  = getPrice('owned-hangar-purchase')
  const PRESS_COST   = getPrice('pressurization-upgrade')
  const SLOT_COST    = getPrice('station-miner-slot')

  const FEE_CARGO_DROP  = getPrice('dock-cargo-drop')
  const FEE_HANGAR      = getPrice('hangar-service')
  const FEE_REFUEL      = getPrice('dock-refuel')
  const FEE_RECHARGE    = getPrice('dock-recharge')
  const FEE_REPAIR_PT   = getPrice('repair-per-condition-point')
  const FEE_ELECTRICITY = getPrice('electricity-per-battery-unit')

  const RESOURCE_LABELS: Record<string, string> = {
    iron: 'Iron',
    ice: 'Ice',
    silicates: 'Silicates',
    'rare-metals': 'Rare Metals',
  }

  const RESOURCE_ORDER: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

  function totalStored(storage: Partial<Record<string, number>>): number {
    return Object.values(storage).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  function close(): void {
    basePanelOpen.set(false)
  }

  function sellResource(type: ResourceType): void {
    commandQueue.update(q => [...q, { type: 'sellResource', resourceType: type }])
  }

  function commissionShip(): void {
    commandQueue.update(q => [...q, { type: 'commissionShip' }])
  }

  function upgradeShip(stat: 'cargo'): void {
    if (!$selectedShip) return
    commandQueue.update(q => [...q, { type: 'upgradeShip', shipId: $selectedShip!.id, stat }])
  }

  function purchaseMiner(): void {
    if (!$selectedShip) return
    commandQueue.update(q => [...q, { type: 'purchaseMiner', haulerId: $selectedShip!.id }])
  }

  function purchaseOwnedDock(): void {
    commandQueue.update(q => [...q, { type: 'purchaseOwnedDock' }])
  }

  function purchaseHangar(): void {
    commandQueue.update(q => [...q, { type: 'purchaseHangar' }])
  }

  function purchaseMinerSlot(): void {
    commandQueue.update(q => [...q, { type: 'purchaseMinerSlot' }])
  }

  function purchasePressurization(): void {
    commandQueue.update(q => [...q, { type: 'purchasePressurization' }])
  }

  function toggleAutoDesignate(): void {
    commandQueue.update(q => [...q, { type: 'toggleAutoDesignate' }])
  }
</script>

{#if $basePanelOpen}
  <div class="panel">
    <!-- Header -->
    <div class="header">
      <span class="title">BASE</span>
      <button class="close-btn" on:click={close}>✕</button>
    </div>
    <div class="row">
      <span class="label">Credits</span>
      <span class="value credits">{Math.floor($baseState.credits)}</span>
    </div>
    <div class="row">
      <span class="label">Storage</span>
      <span class="value">{Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}</span>
    </div>

    <!-- Market -->
    <div class="section-title">MARKET</div>
    {#each RESOURCE_ORDER as type}
      {@const qty = Math.floor($baseState.storage[type] ?? 0)}
      {@const price = RESOURCE_SELL_PRICES[type]}
      <div class="row market-row" class:disabled={qty <= 0}>
        <span class="label resource-{type}">{RESOURCE_LABELS[type]}</span>
        <span class="qty">{qty}</span>
        <span class="price">@ {price}cr</span>
        <button
          class="sell-btn"
          disabled={qty <= 0}
          on:click={() => sellResource(type)}
        >Sell</button>
      </div>
    {/each}

    <!-- Shipyard -->
    <div class="section-title">SHIPYARD</div>
    <div class="row shipyard-row" class:disabled={$baseState.credits < SHIP_COMMISSION_COST}>
      <span class="label">Hauler</span>
      <span class="price">{SHIP_COMMISSION_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.credits < SHIP_COMMISSION_COST}
        on:click={commissionShip}
      >Commission</button>
    </div>

    <!-- Equipment -->
    <div class="section-title">EQUIPMENT</div>
    {#if $selectedShip}
      {@const hasFreeSlot = $selectedShip.attachmentPoints.some(ap => ap.size === 'medium' && ap.payload === null)}
      {@const canBuyMiner = $baseState.credits >= AUTOMINER_PURCHASE_COST && hasFreeSlot}
      <div class="row shipyard-row" class:disabled={!canBuyMiner}>
        <span class="label">AutoMiner</span>
        <span class="price">{AUTOMINER_PURCHASE_COST}cr</span>
        <button
          class="commission-btn"
          disabled={!canBuyMiner}
          on:click={purchaseMiner}
        >Buy</button>
      </div>
    {:else}
      <div class="row shipyard-row disabled">
        <span class="label">AutoMiner</span>
        <span class="price">{AUTOMINER_PURCHASE_COST}cr</span>
        <button class="commission-btn" disabled>Buy</button>
      </div>
    {/if}

    <!-- Station usage -->
    <div class="section-title">STATION USAGE</div>
    <div class="row">
      <span class="label">Miner storage</span>
      <span class="value">{$stationUsage.minersStored}/{$stationUsage.minerSlots} used</span>
    </div>
    <div class="row">
      <span class="label">Docks in use</span>
      <span class="value">
        {$stationUsage.docksInUse}/{$stationUsage.docksTotal}{#if $stationUsage.publicDocksInUse > 0} <span class="fee-note">({$stationUsage.publicDocksInUse} public · fees)</span>{/if}
      </span>
    </div>
    <div class="row">
      <span class="label">Hangars in use</span>
      <span class="value">
        {$stationUsage.hangarsInUse}/{$stationUsage.hangarsTotal}{#if $stationUsage.publicHangarsInUse > 0} <span class="fee-note">({$stationUsage.publicHangarsInUse} public · fees)</span>{/if}
      </span>
    </div>

    <!-- Station -->
    <div class="section-title">STATION</div>
    <div class="row shipyard-row" class:disabled={$baseState.ownedDockCount >= SERVICE_SLOT_COUNT || $baseState.credits < DOCK_COST}>
      <span class="label">Docks</span>
      <span class="upgrade-info">{$baseState.ownedDockCount}/{SERVICE_SLOT_COUNT}</span>
      <span class="price">{DOCK_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.ownedDockCount >= SERVICE_SLOT_COUNT || $baseState.credits < DOCK_COST}
        on:click={purchaseOwnedDock}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.ownedHangarCount >= HANGAR_BAY_COUNT || $baseState.credits < HANGAR_COST}>
      <span class="label">Hangars</span>
      <span class="upgrade-info">{$baseState.ownedHangarCount}/{HANGAR_BAY_COUNT}</span>
      <span class="price">{HANGAR_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.ownedHangarCount >= HANGAR_BAY_COUNT || $baseState.credits < HANGAR_COST}
        on:click={purchaseHangar}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.stationMinerSlotCount >= STATION_MINER_SLOT_CAP || $baseState.credits < SLOT_COST}>
      <span class="label">Miner Slots</span>
      <span class="upgrade-info">{$baseState.stationMinerSlotCount}/{STATION_MINER_SLOT_CAP}</span>
      <span class="price">{SLOT_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.stationMinerSlotCount >= STATION_MINER_SLOT_CAP || $baseState.credits < SLOT_COST}
        on:click={purchaseMinerSlot}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.hangarPressurized || $baseState.ownedHangarCount < 1 || $baseState.credits < PRESS_COST}>
      <span class="label">Pressurize Bay</span>
      {#if $baseState.hangarPressurized}
        <span class="max-label">DONE</span>
      {:else}
        <span class="price">{PRESS_COST}cr</span>
        <button
          class="commission-btn"
          disabled={$baseState.ownedHangarCount < 1 || $baseState.credits < PRESS_COST}
          on:click={purchasePressurization}
        >Buy</button>
      {/if}
    </div>

    <!-- Automation -->
    <div class="section-title">AUTOMATION</div>
    <div class="row shipyard-row">
      <span class="label">Auto-Designate</span>
      <span class="value">{$baseState.autoDesignate ? 'ON' : 'OFF'}</span>
      <button class="toggle-btn" on:click={toggleAutoDesignate}>
        {$baseState.autoDesignate ? 'Disable' : 'Enable'}
      </button>
    </div>

    <!-- Fees -->
    <div class="section-title">FEES</div>
    <div class="row fee-row">
      <span class="label">Cargo drop</span>
      <span class="fee-value">{FEE_CARGO_DROP}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Hangar service</span>
      <span class="fee-value">{FEE_HANGAR}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Refuel</span>
      <span class="fee-value">{FEE_REFUEL}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Recharge</span>
      <span class="fee-value">{FEE_RECHARGE}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Repair</span>
      <span class="fee-value">{FEE_REPAIR_PT}cr/pt</span>
    </div>
    <div class="row fee-row">
      <span class="label">Electricity</span>
      <span class="fee-value">{FEE_ELECTRICITY}cr/unit</span>
    </div>

    <!-- Upgrades (visible only when a ship is selected) -->
    {#if $selectedShip}
      {@const cargoLvl = $selectedShip.cargoUpgradeLevel}
      <div class="section-title">UPGRADES — {$selectedShip.name}</div>
      <div class="row upgrade-row" class:disabled={cargoLvl >= MAX_UPGRADE_LEVEL || $baseState.credits < CARGO_UPGRADE_COSTS[cargoLvl]}>
        <span class="label">Cargo</span>
        <span class="upgrade-info">
          {CARGO_CAPACITY_TIERS[cargoLvl]}
          {#if cargoLvl < MAX_UPGRADE_LEVEL}→ {CARGO_CAPACITY_TIERS[cargoLvl + 1]}{/if}
        </span>
        {#if cargoLvl < MAX_UPGRADE_LEVEL}
          <span class="price">{CARGO_UPGRADE_COSTS[cargoLvl]}cr</span>
          <button
            class="upgrade-btn"
            disabled={$baseState.credits < CARGO_UPGRADE_COSTS[cargoLvl]}
            on:click={() => upgradeShip('cargo')}
          >Upgrade</button>
        {:else}
          <span class="max-label">MAX</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 24px;
    left: 24px;
    background: rgba(5, 10, 20, 0.90);
    border: 1px solid #2a4a6a;
    border-radius: 4px;
    padding: 12px 16px;
    min-width: 240px;
    font-family: monospace;
    font-size: 12px;
    color: #aaccee;
    pointer-events: auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
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
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .label {
    color: #6a8a9a;
    flex: 1;
  }

  .value {
    color: #cce0f0;
  }

  .fee-note {
    color: #ffaa66;
    font-size: 0.85em;
  }

  .credits {
    color: #ffdd88;
  }

  .section-title {
    font-size: 10px;
    color: #3a6a8a;
    letter-spacing: 0.08em;
    margin-top: 10px;
    margin-bottom: 4px;
    border-top: 1px solid #1a3a5a;
    padding-top: 6px;
  }

  .market-row .qty {
    color: #cce0f0;
    min-width: 36px;
    text-align: right;
  }

  .price {
    color: #6a8a9a;
    font-size: 10px;
    min-width: 40px;
  }

  .sell-btn,
  .commission-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .toggle-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .toggle-btn:hover {
    background: rgba(60, 100, 150, 0.7);
  }

  .sell-btn:hover:not(:disabled),
  .commission-btn:hover:not(:disabled) {
    background: rgba(60, 100, 150, 0.7);
  }

  .sell-btn:disabled,
  .commission-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .disabled .label,
  .disabled .qty,
  .disabled .price {
    opacity: 0.4;
  }

  .shipyard-row {
    justify-content: space-between;
  }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }

  .upgrade-row {
    justify-content: space-between;
  }

  .upgrade-info {
    color: #cce0f0;
    font-size: 10px;
    flex: 1;
  }

  .upgrade-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .upgrade-btn:hover:not(:disabled) {
    background: rgba(60, 100, 150, 0.7);
  }

  .upgrade-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .max-label {
    color: #44aaff;
    font-size: 10px;
    padding: 2px 6px;
  }

  .fee-row {
    justify-content: space-between;
  }

  .fee-value {
    color: #6a8a9a;
    font-size: 10px;
  }
</style>
