export type PriceKey =
  | 'dock-refuel'
  | 'dock-recharge'
  | 'dock-cargo-drop'
  | 'hangar-service'
  | 'repair-per-condition-point'
  | 'electricity-per-battery-unit'
  | 'station-miner-slot'
  | 'owned-dock-purchase'
  | 'owned-hangar-purchase'
  | 'pressurization-upgrade'
  | 'silo-capacity-upgrade'

const PRICES: Record<PriceKey, number> = {
  'dock-refuel':                  20,
  'dock-recharge':                15,
  'dock-cargo-drop':              10,
  'hangar-service':               50,
  'repair-per-condition-point':    5,
  'electricity-per-battery-unit':  2,
  'station-miner-slot':          200,
  'owned-dock-purchase':         100,
  'owned-hangar-purchase':       300,
  'pressurization-upgrade':      500,
  'silo-capacity-upgrade':       300,
}

export function getPrice(key: PriceKey): number {
  return PRICES[key]
}
