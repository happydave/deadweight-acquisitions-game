import type { AttachmentPoint } from '../state/attachmentTypes'

export interface SlottedShip {
  readonly shipState: string
  readonly x: number
  readonly y: number
  readonly attachmentPoints: AttachmentPoint[]
}

export interface LocatedAsteroid {
  readonly id: string
  readonly x: number
  readonly y: number
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

export function shipHasFreeMediumSlot(ship: SlottedShip): boolean {
  return ship.attachmentPoints.some(ap => ap.size === 'medium' && ap.payload === null)
}

/** Returns the nearest idle ship that has at least one free medium slot, or null. */
export function selectDispatchTarget<S extends SlottedShip>(
  ships: S[],
  target: { x: number; y: number },
): S | null {
  return ships
    .filter(s => s.shipState === 'idle' && shipHasFreeMediumSlot(s))
    .reduce<S | null>((best, s) => {
      if (!best) return s
      return distSq(s.x, s.y, target.x, target.y) < distSq(best.x, best.y, target.x, target.y)
        ? s
        : best
    }, null)
}

/** Returns the nearest asteroid not in occupiedAsteroidIds, or null. */
export function selectDeployTarget<A extends LocatedAsteroid>(
  asteroids: A[],
  ship: { x: number; y: number },
  occupiedAsteroidIds: Set<string>,
): A | null {
  return asteroids
    .filter(a => !occupiedAsteroidIds.has(a.id))
    .reduce<A | null>((best, a) => {
      if (!best) return a
      return distSq(ship.x, ship.y, a.x, a.y) < distSq(ship.x, ship.y, best.x, best.y) ? a : best
    }, null)
}
