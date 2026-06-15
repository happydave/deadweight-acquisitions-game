export const SERVICE_SLOT_COUNT = 6
export const SERVICE_SLOT_RADIUS = 65

export interface SlotPosition {
  x: number
  y: number
}

export function computeServiceSlots(baseX: number, baseY: number): SlotPosition[] {
  const slots: SlotPosition[] = []
  for (let i = 0; i < SERVICE_SLOT_COUNT; i++) {
    const angle = (i / SERVICE_SLOT_COUNT) * Math.PI * 2
    slots.push({
      x: baseX + Math.cos(angle) * SERVICE_SLOT_RADIUS,
      y: baseY + Math.sin(angle) * SERVICE_SLOT_RADIUS,
    })
  }
  return slots
}
