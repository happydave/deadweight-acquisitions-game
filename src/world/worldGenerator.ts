import { nanoid } from 'nanoid'
import { createRng, rngInt, rngFloat, rngWeighted } from './rng'
import {
  FIELD_COUNT,
  ASTEROIDS_PER_FIELD_MIN,
  ASTEROIDS_PER_FIELD_MAX,
  FIELD_SPREAD_RADIUS,
  ZONES,
  SIZE_CONFIGS,
  SIZE_WEIGHTS,
  type ResourceType,
  type SizeCategory,
} from './worldConfig'

export interface AsteroidData {
  id: string
  x: number
  y: number
  resourceType: ResourceType
  sizeCategory: SizeCategory
  currentQuantity: number
  maxQuantity: number
}

export function generateWorld(seed: number): AsteroidData[] {
  const rng = createRng(seed)
  const asteroids: AsteroidData[] = []

  const fieldsPerZone = Math.floor(FIELD_COUNT / ZONES.length)
  const remainder = FIELD_COUNT % ZONES.length

  for (let zoneIdx = 0; zoneIdx < ZONES.length; zoneIdx++) {
    const zone = ZONES[zoneIdx]
    if (zone.innerRadius >= zone.outerRadius) {
      console.warn(`worldGenerator: zone ${zoneIdx} has invalid radii, skipping`)
      continue
    }
    const fieldCount = fieldsPerZone + (zoneIdx < remainder ? 1 : 0)

    for (let f = 0; f < fieldCount; f++) {
      const fieldAngle = rngFloat(rng, 0, Math.PI * 2)
      const fieldRadius = rngFloat(rng, zone.innerRadius, zone.outerRadius)
      const fieldX = Math.cos(fieldAngle) * fieldRadius
      const fieldY = Math.sin(fieldAngle) * fieldRadius

      const asteroidCount = rngInt(rng, ASTEROIDS_PER_FIELD_MIN, ASTEROIDS_PER_FIELD_MAX)
      for (let a = 0; a < asteroidCount; a++) {
        const offsetAngle = rngFloat(rng, 0, Math.PI * 2)
        const offsetRadius = rngFloat(rng, 0, FIELD_SPREAD_RADIUS)
        const x = fieldX + Math.cos(offsetAngle) * offsetRadius
        const y = fieldY + Math.sin(offsetAngle) * offsetRadius

        const resourceType = rngWeighted(rng, zone.resourceWeights)
        const sizeCategory = rngWeighted(rng, SIZE_WEIGHTS)
        const sizeConfig = SIZE_CONFIGS[sizeCategory]
        const maxQuantity = rngInt(rng, sizeConfig.quantityMin, sizeConfig.quantityMax)

        asteroids.push({ id: nanoid(), x, y, resourceType, sizeCategory, currentQuantity: maxQuantity, maxQuantity })
      }
    }
  }

  return asteroids
}
