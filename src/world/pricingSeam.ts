export type PriceKey =
  | 'dock-refuel'
  | 'dock-recharge'
  | 'dock-cargo-drop'
  | 'hangar-service'
  | 'repair-per-condition-point'
  | 'electricity-per-battery-unit'

const PRICES: Record<PriceKey, number> = {
  'dock-refuel':                  20,
  'dock-recharge':                15,
  'dock-cargo-drop':              10,
  'hangar-service':               50,
  'repair-per-condition-point':    5,
  'electricity-per-battery-unit':  2,
}

export function getPrice(key: PriceKey): number {
  return PRICES[key]
}
