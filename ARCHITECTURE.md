## Version Context

- TypeScript: ^5 (strict mode)
- Phaser: ^3 (arcade physics)
- Svelte: ^5
- Vite: ^8 (build + dev server, polling mode)
- Vitest: ^3 (unit tests, node environment)
- nanoid: ID generation for all game entities

---

## Architectural Boundaries

```
Forbidden: /src/ui/ Svelte components holding references to Phaser objects — all data routes through Svelte writable stores
Forbidden: /src/scenes/dispatchLogic.ts importing from Phaser — pure functions with structural interfaces only
Forbidden: /src/services/GameSaveService.ts importing from Phaser — operates on plain SaveState objects only
Required:  all persistence routes through GameSaveService → localStorage (key: 'dwa-save')
Required:  all UI→game commands route through commandQueue writable store; drained each frame by SpaceScene.drainCommandQueue()
Required:  all entity→UI data routes through Svelte writable stores via each entity's pushToStore() method
Required:  save schema migrations use a fallthrough switch in GameSaveService.migrate() — every version must fall through to the next
```

---

## Component Index

- **Entry Point** `/src/main.ts`
  - Inputs: browser DOM, `#hud` element
  - Outputs: Phaser.Game instance (canvas), three mounted Svelte components (Hud, EntityPanel, BasePanel)
  - Creates Phaser.Game with scenes [BootScene, MainMenuScene, SpaceScene] and RESIZE scale mode; mounts Svelte UI overlay onto `#hud`

- **BootScene** `/src/scenes/BootScene.ts`
  - Inputs: none (no assets to preload in current build)
  - Outputs: transitions to MainMenuScene

- **MainMenuScene** `/src/scenes/MainMenuScene.ts`
  - Inputs: `GameSaveService.hasSave()` (determines whether CONTINUE button appears)
  - Outputs: `GameSaveService.clear()` on NEW GAME; transitions to SpaceScene

- **SpaceScene** `/src/scenes/SpaceScene.ts` (1691 lines — primary game orchestrator)
  - Inputs: commandQueue store (UI commands), keyboard/mouse/pointer events
  - Outputs: all Svelte writable stores; `GameSaveService.save()` every 10s and on `beforeunload`
  - Owns: entity lifecycle (spawn, update, destroy), camera, minimap, starfield, autoDispatch loop, save/load coordination
  - Key responsibilities: `create()` → load or generate world; `update(time, delta)` → per-frame state machine ticks; `autoDispatch()` → runs every `AUTO_DISPATCH_INTERVAL` (4s) via accumulator; `drainCommandQueue()` → translates UI commands to entity mutations; `buildSaveState()` / `loadFromSave()` → serialization boundary

- **dispatchLogic** `/src/scenes/dispatchLogic.ts`
  - Inputs: `SlottedShip[]`, `LocatedAsteroid[]`, `Set<string>` (occupied asteroid IDs)
  - Outputs: nearest eligible ship or asteroid (pure return values, no side effects)
  - Exports: `shipHasFreeMediumSlot(ship)`, `selectDispatchTarget(ships, target)`, `selectDeployTarget(asteroids, ship, occupiedIds)`
  - No Phaser dependency — uses structural interfaces `SlottedShip` and `LocatedAsteroid`; tested independently via Vitest

- **Asteroid** `/src/entities/Asteroid.ts`
  - Inputs: `AsteroidData` (from worldGenerator), per-frame orbital angle update from SpaceScene
  - Outputs: `selectedAsteroid` store (when selected); emits `'asteroid-selected'` event; `currentQuantity` consumed by AutoMiner
  - Maintains Keplerian orbit: `angle += ORBITAL_K / radius^1.5 * dt`

- **Ship** `/src/entities/Ship.ts` — `Phaser.Physics.Arcade.Sprite`
  - Inputs: per-frame `update(dt)` call from SpaceScene, state mutations from SpaceScene methods
  - Outputs: `selectedShip` store via `pushToStore()`; emits `'begin-unloading'`, `'unload-complete'` events
  - State machine: `idle` → `traveling-to-asteroid` → `deploying-miner` → `waiting-at-asteroid` → `collecting-nets` → `traveling-to-base` → `unloading` → `idle`; also `responding-to-beacon` → `loading-miner`; `resupplying-miner`
  - Key fields: `attachmentPoints: AttachmentPoint[]` (1 small net-store + 1 small empty + 2 medium empty by default), `collectSlotProgress: Map<number, number>` (per-slot 0→1 progress during net collection), dual unload timers (`unloadTimer` for cargo bay, `attachUnloadTimer` for attachment nets)
  - Constants: `SHIP_SPEED=180`, `UNLOAD_DURATION=3s`, `ATTACHMENT_UNLOAD_DURATION=1.5s`, `CARGO_CAPACITY_TIERS=[200,350,550,800]`

- **AutoMiner** `/src/entities/AutoMiner.ts` — `Phaser.GameObjects.Image`
  - Inputs: `updateMining(dt, asteroid)` call from SpaceScene when state is `'mining'`
  - Outputs: `selectedAutoMiner` store; emits `'net-ejected'` (CargoNet instance), `'beacon-emitted'` ({id, x, y})
  - State machine: `in-transit` → `deploying` → `attaching` → `mining` → `ejecting-net` → `mining` | `net-starved`; also `standby-beaconing` (asteroid depleted), `drifting` (attach retry), `stuck` (exhausted retries, no slot — still beaconing, recoverable via beacon), `dark` (battery exhaustion — beacon silent, recoverable by manual dispatch)
  - Constants: `MINER_RATE=5` units/s, `NET_CAPACITY=50` units, `MINER_INITIAL_NETS=3`, `ATTACH_FAILURE_PROB=0.25`, `ATTACH_MAX_RETRIES=3`, `BEACON_INTERVAL_MS=3000`
  - Free-orbit fields: `freeOrbitalRadius`, `freeOrbitalAngle` — used when asteroid depletes and miner drifts unattached

- **CargoNet** `/src/entities/CargoNet.ts` — `Phaser.GameObjects.Image`
  - Inputs: created by `AutoMiner.ejectNet()` or restored from save
  - Outputs: `selectedCargoNet` store; `quantity` and `resourceType` transferred to Base on unload
  - States: `full-tethered` (at asteroid, visible), `in-transit` (being collected via tween), `unloading` (at base)
  - Constants: `NET_LEAKAGE_FRACTION=0.05` (quantity loss on collection), `NET_COLLECT_DURATION_MS=2000`

- **Base** `/src/entities/Base.ts` — `Phaser.GameObjects.Image`
  - Inputs: `acceptCargo()`, `acceptMiner()`, `sellResource()`, `commissionShip()` calls from SpaceScene
  - Outputs: `baseState` store via `pushToStore()`
  - Constants: `BASE_STORAGE_CAPACITY=2000`, `STARTING_CREDITS=750`, `SHIP_COMMISSION_COST=500`

- **Planet** `/src/entities/Planet.ts`
  - Visual-only; procedurally textured; at world origin; no game logic

- **GameSaveService** `/src/services/GameSaveService.ts`
  - Inputs: `SaveState` plain objects; localStorage
  - Outputs: `SaveState | null` from `load()`; persists to localStorage on `save()`
  - Schema version: 11 (current); `migrate()` uses fallthrough switch from v1→v11; each case upgrades one field and falls through
  - Key migrations: v4 removed direct-mining fields + added attachment points; v6 split tetheredNets into top-level cargoNets array; v11 clears legacy `cargoContents`

- **gameState** `/src/state/gameState.ts`
  - Type definitions only: `SaveState`, `ShipSnapshot`, `AutoMinerSnapshot`, `CargoNetSnapshot`, `AsteroidSnapshot`, `BaseSnapshot`
  - Not a Svelte store — holds the initial/default plain object for save state construction

- **attachmentTypes** `/src/state/attachmentTypes.ts`
  - Types: `AttachmentPoint`, `AttachmentPointSize`, `NetStorePayload`, `AutoMinerPayload`, `CargoNetPayload`, `AttachmentPayload`
  - `makeDefaultLoadout()`: returns `[small/net-store, small/empty, medium/empty, medium/empty]`
  - `NET_STORE_MAX_NETS=12`

- **shipStore** `/src/state/shipStore.ts`
  - Writable stores: `selectedShip: SelectedShipData | null`, `selectedAsteroid: SelectedAsteroidData | null`
  - `SelectedShipData` includes `collectSlotProgress: Record<number, number>` (keyed by attachment point array index)
  - Exports `ShipState` union type used by Ship entity and SpaceScene

- **autoMinerStore** `/src/state/autoMinerStore.ts`
  - Writable stores: `selectedAutoMiner`, `activeBeacons: BeaconData[]`, `autoMinerSummary: AutoMinerSummary`, `attachNotifications: AttachNotification[]`

- **cargoNetStore** `/src/state/cargoNetStore.ts`
  - Writable store: `selectedCargoNet: SelectedCargoNetData | null`

- **baseStore** `/src/state/baseStore.ts`
  - Writable stores: `baseState: BaseState`, `basePanelOpen: boolean`

- **commandStore** `/src/state/commandStore.ts`
  - Writable store: `commandQueue: GameCommand[]`
  - `GameCommand` union: `sellResource`, `commissionShip`, `manualSave`, `upgradeShip`, `deployMiner`, `resupplyMiner`, `respondToBeacon`, `purchaseMiner`, `collectNets`

- **fleetStore** `/src/state/fleetStore.ts`
  - Writable store: `fleetSummary: { idle, active, returning }`

- **worldConfig** `/src/world/worldConfig.ts`
  - Constants: orbit radii, company arrival intervals, asteroid size configs, resource weights and sell prices
  - Types: `ResourceType` (`'iron' | 'ice' | 'silicates' | 'rare-metals'`), `SizeCategory` (`'small' | 'medium' | 'large'`)

- **worldGenerator** `/src/world/worldGenerator.ts`
  - Inputs: numeric seed
  - Outputs: `AsteroidData[]` (moon debris field + company asteroids)
  - `generateWorld(seed)`: moon debris cluster at `MOON_ORBIT_RADIUS=2200` + 4–8 company asteroids
  - `generateCompanyAsteroid(seed)`: single company asteroid for dynamic arrival events

- **rng** `/src/world/rng.ts`
  - Seeded RNG utilities: `createRng(seed)`, `rngInt()`, `rngFloat()`, `rngWeighted()`
  - Tested independently: `/src/world/rng.test.ts`

- **Hud** `/src/ui/Hud.svelte`
  - Reads: `baseState`, `fleetSummary`, `autoMinerSummary`, `activeBeacons`, `attachNotifications`
  - Writes: `commandQueue` (manualSave)
  - Displays: resource storage, credits, fleet counts (idle/active/returning), miner counts (mining/net-starved/beaconing/dark), beacon list, attach notifications

- **EntityPanel** `/src/ui/EntityPanel.svelte`
  - Reads: `selectedShip`, `selectedAsteroid`, `selectedAutoMiner`, `selectedCargoNet`
  - Writes: `commandQueue` (deployMiner, resupplyMiner, respondToBeacon, purchaseMiner, collectNets, upgradeShip)
  - Displays: ship detail (state, cargo, attachment slots with per-slot progress bars), asteroid detail, miner detail, net detail

- **BasePanel** `/src/ui/BasePanel.svelte`
  - Reads: `baseState`, `basePanelOpen`, `selectedShip`
  - Writes: `commandQueue` (sellResource, commissionShip, upgradeShip)
  - Displays: market (sell resources), ship commission, cargo upgrades

---

## Dependency Chains

```
/src/main.ts
  → /src/scenes/BootScene.ts, MainMenuScene.ts, SpaceScene.ts
  → /src/ui/Hud.svelte, EntityPanel.svelte, BasePanel.svelte

/src/scenes/SpaceScene.ts
  → /src/entities/Asteroid.ts, Ship.ts, AutoMiner.ts, CargoNet.ts, Base.ts, Planet.ts
  → /src/scenes/dispatchLogic.ts
  → /src/services/GameSaveService.ts
  → /src/state/ (all stores)
  → /src/world/worldConfig.ts, worldGenerator.ts

/src/entities/Ship.ts
  → /src/entities/Base.ts (constructor ref for base position)
  → /src/state/shipStore.ts, attachmentTypes.ts
  → /src/world/worldConfig.ts (ResourceType)

/src/entities/AutoMiner.ts
  → /src/entities/CargoNet.ts (ejectNet creates instance)
  → /src/entities/Asteroid.ts (updateMining accepts Asteroid)
  → /src/state/autoMinerStore.ts

/src/entities/CargoNet.ts
  → /src/state/cargoNetStore.ts
  → /src/world/worldConfig.ts (ResourceType)

/src/entities/Base.ts
  → /src/state/baseStore.ts
  → /src/world/worldConfig.ts (ResourceType, RESOURCE_SELL_PRICES)
  → /src/entities/AutoMiner.ts (AUTOMINER_PURCHASE_COST)

/src/scenes/dispatchLogic.ts
  → /src/state/attachmentTypes.ts (AttachmentPoint interface only)

/src/services/GameSaveService.ts
  → /src/state/gameState.ts (SaveState type)
  → /src/state/attachmentTypes.ts (makeDefaultLoadout — used in v4→v5 migration)

/src/ui/*.svelte
  → /src/state/ (all stores)
  → /src/world/worldConfig.ts (ResourceType, RESOURCE_SELL_PRICES)
  → /src/entities/AutoMiner.ts, Ship.ts, Base.ts (exported constants only — no class refs)

/src/world/worldGenerator.ts
  → /src/world/worldConfig.ts
  → /src/world/rng.ts
```

---

## Linear Data Flow

### Game boot and world initialization
```
1. main.ts: Phaser.Game constructed with scene list; Svelte components mounted on #hud
2. BootScene.create(): immediately starts MainMenuScene
3. MainMenuScene.create(): GameSaveService.hasSave() determines button layout
4. Player clicks CONTINUE or NEW GAME → SpaceScene starts
5. SpaceScene.create():
   a. Textures generated (asteroids, ship, miner, net, base — all procedural via Graphics)
   b. GameSaveService.load() → if save exists: loadFromSave(save); else: spawnWorld() using worldGenerator.generateWorld(worldSeed)
   c. Camera configured; input handlers attached; beforeunload handler registered
```

### AutoMiner mining lifecycle
```
1. SpaceScene.autoDispatch() runs every 4s (accumulated in update()):
   a. Iterates asteroids with tethered nets → selectDispatchTarget(ships, asteroid) → nearest idle Ship with free medium slot
   b. 'net-starved' AutoMiners → same dispatch path
   c. Ships with in-transit miners but no asteroidTarget → selectDeployTarget() → assign asteroid
2. Ship.shipState = 'traveling-to-asteroid'; Ship.pushToStore() → selectedShip store → EntityPanel updates
3. Ship arrives within MINER_DEPLOY_PROXIMITY → SpaceScene.performDeploy():
   a. Tween AutoMiner from ship position to asteroid; miner.setVisible(true)
   b. beginAttachAttempt() with ATTACH_FAILURE_PROB=0.25, up to ATTACH_MAX_RETRIES=3
   c. On success: miner.state = 'mining'; miner.asteroidId = asteroid.id
4. SpaceScene.update() per-frame: AutoMiner.updateMining(dt, asteroid):
   a. Extracts MINER_RATE=5 units/s from asteroid.currentQuantity
   b. When activeNetFill >= NET_CAPACITY=50: ejectNet() → new CargoNet created → tetheredNetIds updated
   c. If spareNetCount > 0: spareNetCount--; state = 'mining'; else: state = 'net-starved'; startBeacon()
   d. If asteroid.currentQuantity <= 0: state = 'standby-beaconing'; startBeacon()
5. AutoMiner.startBeacon(): fires 'beacon-emitted' event every BEACON_INTERVAL_MS=3000ms → SpaceScene adds to activeBeacons store
6. SpaceScene.autoDispatch() picks up 'net-starved' miner → dispatches hauler ship
7. Ship arrives at asteroid → shipState = 'collecting-nets' (SpaceScene.beginCollecting()):
   a. ship.beginCollecting() called (clears collectSlotProgress)
   b. collectSlotProgress entries initialized AFTER beginCollecting() for each net being collected
   c. Tween each CargoNet from asteroid toward ship over NET_COLLECT_DURATION_MS=2000ms
   d. onUpdate: ship.collectSlotProgress.set(slotIdx, progress) → ship.pushToStore() → EntityPanel amber bars
   e. onComplete: CargoNet.state = 'in-transit'; net attached to ship medium slot payload; net.setVisible(false)
8. Ship departs → shipState = 'traveling-to-base' → steers toward base position
9. Ship arrives at base → Ship.beginUnloading():
   a. Cargo bay timer (3s, blue bar): only if cargoContents has non-zero values
   b. Attachment net timer (1.5s, amber bar): only if any medium slot holds cargo-net payload
10. SpaceScene.processNetUnloading(): CargoNet.quantity → Base.acceptCargo() → base.storage updated
11. Base.pushToStore() → baseState store → Hud.svelte updates resource display
12. Ship.shipState = 'idle' when both timers complete
```

### UI command flow
```
1. User clicks action in EntityPanel or BasePanel → commandQueue.update(q => [...q, cmd])
2. SpaceScene.update() → drainCommandQueue(): commandQueue.update(q => []) → handleCommand(cmd) for each
3. handleCommand() dispatches to: initiateDeployMiner(), initiateCollectNets(), initiateResupplyMiner(),
   initiateRespondToBeacon(), performPurchaseMiner(), commissionNewShip(), applyShipUpgrade(), etc.
```

### Save / load cycle
```
1. SpaceScene.update(): autoSaveAccumulator += dt; when >= 10s → GameSaveService.save(buildSaveState())
2. buildSaveState(): snapshots all entities to plain SaveState object (schemaVersion=11)
3. GameSaveService.save(): JSON.stringify(SaveState) → localStorage['dwa-save']
4. On load: GameSaveService.load() → JSON.parse → migrate() fallthrough switch upgrades schema → return SaveState
5. SpaceScene.loadFromSave(): re-creates all entity instances from snapshot data; restores timers and states
```

---

## Known Gaps

- `Planet.ts` not traced — visual only; no inputs or outputs to document
- Minimap rendering (`drawMinimap()`) is fully internal to SpaceScene — no external interface
- `rng.ts` test file at `/src/world/rng.test.ts` covers seeded RNG; `dispatchLogic.test.ts` at `/src/scenes/dispatchLogic.test.ts` covers dispatch pure functions — no other test coverage
- Station orbiting is not yet implemented; `Base` is stationary at world origin
