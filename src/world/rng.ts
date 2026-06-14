export type Rng = () => number

export function createRng(seed: number): Rng {
  let s = seed >>> 0
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function rngFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function rngWeighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((sum, [, w]) => sum + (w as number), 0)
  let r = rng() * total
  for (const [key, w] of entries) {
    r -= w as number
    if (r <= 0) return key
  }
  return entries[entries.length - 1][0]
}
