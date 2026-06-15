export const HANGAR_BAY_COUNT = 3
export const HANGAR_BAY_RADIUS = 110
export const HANGAR_PRESSURIZED_FACTOR = 0.5

export interface HangarPosition { x: number; y: number }

export function computeHangarBays(baseX: number, baseY: number): HangarPosition[] {
  const bays: HangarPosition[] = []
  for (let i = 0; i < HANGAR_BAY_COUNT; i++) {
    const angle = (i / HANGAR_BAY_COUNT) * Math.PI * 2
    bays.push({
      x: baseX + Math.cos(angle) * HANGAR_BAY_RADIUS,
      y: baseY + Math.sin(angle) * HANGAR_BAY_RADIUS,
    })
  }
  return bays
}
