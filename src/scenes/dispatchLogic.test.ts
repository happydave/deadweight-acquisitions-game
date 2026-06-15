import { describe, it, expect } from 'vitest'
import { shipHasFreeMediumSlot, selectDispatchTarget, selectDeployTarget, selectHaulerForDesignation } from './dispatchLogic'
import type { AttachmentPoint } from '../state/attachmentTypes'

let _shipSeq = 0
function slot(size: 'small' | 'medium', occupied: boolean): AttachmentPoint {
  return {
    id: 'id',
    size,
    payload: occupied ? { kind: 'net-store', maxNets: 12, currentNets: 12 } : null,
  }
}

function minerSlot(): AttachmentPoint {
  return {
    id: 'id',
    size: 'medium',
    payload: { kind: 'auto-miner', minerId: 'miner-1' },
  }
}

function ship(
  shipState: string,
  x: number,
  y: number,
  slots: AttachmentPoint[],
  id?: string,
) {
  return { id: id ?? `ship-${++_shipSeq}`, shipState, x, y, attachmentPoints: slots }
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

// ── selectHaulerForDesignation ────────────────────────────────────────────

describe('selectHaulerForDesignation', () => {
  it('returns null when no ships exist', () => {
    expect(selectHaulerForDesignation([], false)).toBeNull()
    expect(selectHaulerForDesignation([], true)).toBeNull()
  })

  it('returns null when no idle ships exist', () => {
    const busy = ship('traveling-to-asteroid', 0, 0, [minerSlot()])
    expect(selectHaulerForDesignation([busy], true)).toBeNull()
  })

  it('prefers idle ship with miner over idle ship without', () => {
    const withMiner = ship('idle', 0, 0, [minerSlot()])
    const noMiner   = ship('idle', 0, 0, [slot('medium', false)])
    expect(selectHaulerForDesignation([withMiner, noMiner], true)).toBe(withMiner)
    expect(selectHaulerForDesignation([noMiner, withMiner], true)).toBe(withMiner)
  })

  it('returns ship with miner even when hasStoredMiner is false', () => {
    const withMiner = ship('idle', 0, 0, [minerSlot()])
    expect(selectHaulerForDesignation([withMiner], false)).toBe(withMiner)
  })

  it('returns ship without miner when hasStoredMiner is true and no miner-carrier exists', () => {
    const noMiner = ship('idle', 0, 0, [slot('medium', false)])
    expect(selectHaulerForDesignation([noMiner], true)).toBe(noMiner)
  })

  it('returns null when hasStoredMiner is false and only ships without miners exist', () => {
    const noMiner = ship('idle', 0, 0, [slot('medium', false)])
    expect(selectHaulerForDesignation([noMiner], false)).toBeNull()
  })

  it('returns null when idle ships have no medium slot at all', () => {
    const smallOnly = ship('idle', 0, 0, [slot('small', false)])
    expect(selectHaulerForDesignation([smallOnly], true)).toBeNull()
  })

  it('returns null when all medium slots are occupied and no miner carrier', () => {
    const fullSlots = ship('idle', 0, 0, [slot('medium', true)])
    expect(selectHaulerForDesignation([fullSlots], true)).toBeNull()
  })
})
