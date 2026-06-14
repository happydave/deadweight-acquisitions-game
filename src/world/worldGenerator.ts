import { nanoid } from 'nanoid'
import { createRng, rngInt, rngFloat, rngWeighted } from './rng'
import {
  MOON_ORBIT_RADIUS,
  MOON_DEBRIS_SPREAD_RADIUS,
  MOON_DEBRIS_COUNT_MIN,
  MOON_DEBRIS_COUNT_MAX,
  MOON_RESOURCE_WEIGHTS,
  COMPANY_COUNT_MIN,
  COMPANY_COUNT_MAX,
  COMPANY_DISTANCE_MIN,
  COMPANY_DISTANCE_MAX,
  COMPANY_RESOURCE_WEIGHTS,
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
  isCompany: boolean
}

export function generateWorld(seed: number): AsteroidData[] {
  const rng = createRng(seed)
  const asteroids: AsteroidData[] = []

  // --- Moon debris field ---
  const moonAngle = rngFloat(rng, 0, Math.PI * 2)
  const moonCenterX = Math.cos(moonAngle) * MOON_ORBIT_RADIUS
  const moonCenterY = Math.sin(moonAngle) * MOON_ORBIT_RADIUS

  const debrisCount = rngInt(rng, MOON_DEBRIS_COUNT_MIN, MOON_DEBRIS_COUNT_MAX)
  for (let i = 0; i < debrisCount; i++) {
    const spreadAngle = rngFloat(rng, 0, Math.PI * 2)
    const spreadRadius = rngFloat(rng, 0, MOON_DEBRIS_SPREAD_RADIUS)
    const x = moonCenterX + Math.cos(spreadAngle) * spreadRadius
    const y = moonCenterY + Math.sin(spreadAngle) * spreadRadius

    const resourceType = rngWeighted(rng, MOON_RESOURCE_WEIGHTS)
    const sizeCategory = rngWeighted(rng, SIZE_WEIGHTS)
    const sizeConfig = SIZE_CONFIGS[sizeCategory]
    const maxQuantity = rngInt(rng, sizeConfig.quantityMin, sizeConfig.quantityMax)

    asteroids.push({
      id: nanoid(),
      x,
      y,
      resourceType,
      sizeCategory,
      currentQuantity: maxQuantity,
      maxQuantity,
      isCompany: false,
    })
  }

  // --- Company asteroids ---
  const companyCount = rngInt(rng, COMPANY_COUNT_MIN, COMPANY_COUNT_MAX)
  for (let i = 0; i < companyCount; i++) {
    const angle = rngFloat(rng, 0, Math.PI * 2)
    const distance = rngFloat(rng, COMPANY_DISTANCE_MIN, COMPANY_DISTANCE_MAX)
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance

    const resourceType = rngWeighted(rng, COMPANY_RESOURCE_WEIGHTS)
    const sizeCategory = rngWeighted(rng, SIZE_WEIGHTS)
    const sizeConfig = SIZE_CONFIGS[sizeCategory]
    const maxQuantity = rngInt(rng, sizeConfig.quantityMin, sizeConfig.quantityMax)

    asteroids.push({
      id: nanoid(),
      x,
      y,
      resourceType,
      sizeCategory,
      currentQuantity: maxQuantity,
      maxQuantity,
      isCompany: true,
    })
  }

  return asteroids
}
