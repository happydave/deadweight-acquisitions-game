import { describe, it, expect } from 'vitest'
import { createRng, rngInt, rngFloat, rngWeighted } from './rng'

describe('createRng', () => {
  it('is deterministic: same seed produces identical sequence', () => {
    const seed = 0xdeadbeef
    const a = createRng(seed)
    const b = createRng(seed)
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b())
    }
  })

  it('produces different sequences for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const valA = Array.from({ length: 20 }, () => a())
    const valB = Array.from({ length: 20 }, () => b())
    expect(valA).not.toEqual(valB)
  })

  it('produces values in [0, 1)', () => {
    const rng = createRng(42)
    for (let i = 0; i < 10000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('rngInt', () => {
  it('always returns values in [min, max] inclusive', () => {
    const rng = createRng(12345)
    for (let i = 0; i < 10000; i++) {
      const v = rngInt(rng, 3, 10)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(10)
    }
  })

  it('returns integer values', () => {
    const rng = createRng(99)
    for (let i = 0; i < 1000; i++) {
      expect(Number.isInteger(rngInt(rng, 0, 100))).toBe(true)
    }
  })
})

describe('rngFloat', () => {
  it('always returns values in [min, max)', () => {
    const rng = createRng(54321)
    for (let i = 0; i < 10000; i++) {
      const v = rngFloat(rng, 1.5, 7.5)
      expect(v).toBeGreaterThanOrEqual(1.5)
      expect(v).toBeLessThan(7.5)
    }
  })
})

describe('rngWeighted', () => {
  it('always returns a key from the weights object', () => {
    const rng = createRng(77777)
    const weights = { a: 0.5, b: 0.3, c: 0.2 }
    const keys = Object.keys(weights)
    for (let i = 0; i < 1000; i++) {
      expect(keys).toContain(rngWeighted(rng, weights))
    }
  })

  it('roughly respects weight distribution', () => {
    const rng = createRng(11111)
    const weights = { high: 0.9, low: 0.1 }
    let highCount = 0
    const draws = 10000
    for (let i = 0; i < draws; i++) {
      if (rngWeighted(rng, weights) === 'high') highCount++
    }
    const ratio = highCount / draws
    expect(ratio).toBeGreaterThan(0.85)
    expect(ratio).toBeLessThan(0.95)
  })
})
