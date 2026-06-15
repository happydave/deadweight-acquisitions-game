import { describe, it, expect } from 'vitest'
import { shipHasFreeMediumSlot, selectDispatchTarget, selectDeployTarget } from './dispatchLogic'
import type { AttachmentPoint } from '../state/attachmentTypes'

function slot(size: 'small' | 'medium', occupied: boolean): AttachmentPoint {
  return {
    id: 'id',
    size,
    payload: occupied ? { kind: 'net-store', maxNets: 12, currentNets: 12 } : null,
  }
}

function ship(
  shipState: string,
  x: number,
  y: number,
  slots: AttachmentPoint[],
) {
  return { shipState, x, y, attachmentPoints: slots }
}

function asteroid(id: string, x: number, y: number) {
  return { id, x, y }
}

// ── shipHasFreeMediumSlot ──────────────────────────────────────────────────

describe('shipHasFreeMediumSlot', () => {
  it('returns true when a medium slot is empty', () => {
    const s = ship('idle', 0, 0, [slot('medium', false)])
    expect(shipHasFreeMediumSlot(s)).toBe(true)
  })

  it('returns false when all medium slots are occupied', () => {
    const s = ship('idle', 0, 0, [slot('medium', true), slot('medium', true)])
    expect(shipHasFreeMediumSlot(s)).toBe(false)
  })

  it('returns false when there are no medium slots', () => {
    const s = ship('idle', 0, 0, [slot('small', false)])
    expect(shipHasFreeMediumSlot(s)).toBe(false)
  })

  it('ignores small slots when checking medium capacity', () => {
    const s = ship('idle', 0, 0, [slot('small', false), slot('medium', true)])
    expect(shipHasFreeMediumSlot(s)).toBe(false)
  })
})

// ── selectDispatchTarget ───────────────────────────────────────────────────

describe('selectDispatchTarget', () => {
  it('returns null when no ships are present', () => {
    expect(selectDispatchTarget([], asteroid('a', 0, 0))).toBeNull()
  })

  it('returns null when no idle ships exist', () => {
    const s = ship('traveling-to-asteroid', 0, 0, [slot('medium', false)])
    expect(selectDispatchTarget([s], asteroid('a', 10, 0))).toBeNull()
  })

  it('returns null when all idle ships have no free medium slot', () => {
    const s = ship('idle', 0, 0, [slot('medium', true), slot('medium', true)])
    expect(selectDispatchTarget([s], asteroid('a', 10, 0))).toBeNull()
  })

  it('returns the only eligible ship', () => {
    const s = ship('idle', 0, 0, [slot('medium', false)])
    expect(selectDispatchTarget([s], asteroid('a', 10, 0))).toBe(s)
  })

  it('returns the nearest eligible ship', () => {
    const near = ship('idle', 1, 0, [slot('medium', false)])
    const far  = ship('idle', 9, 0, [slot('medium', false)])
    expect(selectDispatchTarget([near, far], asteroid('a', 0, 0))).toBe(near)
    expect(selectDispatchTarget([far, near], asteroid('a', 0, 0))).toBe(near)
  })

  it('skips non-idle ships when selecting nearest', () => {
    const busy = ship('unloading', 0, 0, [slot('medium', false)])
    const idle = ship('idle', 5, 0, [slot('medium', false)])
    expect(selectDispatchTarget([busy, idle], asteroid('a', 0, 0))).toBe(idle)
  })
})

// ── selectDeployTarget ────────────────────────────────────────────────────

describe('selectDeployTarget', () => {
  const src = { x: 0, y: 0 }

  it('returns null when no asteroids exist', () => {
    expect(selectDeployTarget([], src, new Set())).toBeNull()
  })

  it('returns null when all asteroids are occupied', () => {
    const a = asteroid('a', 5, 0)
    expect(selectDeployTarget([a], src, new Set(['a']))).toBeNull()
  })

  it('returns the only unoccupied asteroid', () => {
    const a = asteroid('a', 5, 0)
    expect(selectDeployTarget([a], src, new Set())).toBe(a)
  })

  it('skips occupied asteroids', () => {
    const a = asteroid('a', 1, 0)
    const b = asteroid('b', 3, 0)
    expect(selectDeployTarget([a, b], src, new Set(['a']))).toBe(b)
  })

  it('returns the nearest unoccupied asteroid', () => {
    const near = asteroid('near', 2, 0)
    const far  = asteroid('far',  8, 0)
    expect(selectDeployTarget([near, far], src, new Set())).toBe(near)
    expect(selectDeployTarget([far, near], src, new Set())).toBe(near)
  })
})
