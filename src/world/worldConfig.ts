export type ResourceType = 'iron' | 'ice' | 'silicates' | 'rare-metals'
export type SizeCategory = 'small' | 'medium' | 'large'

export interface ZoneConfig {
  innerRadius: number
  outerRadius: number
  resourceWeights: Record<ResourceType, number>
}

export interface SizeConfig {
  chance: number
  scale: number
  quantityMin: number
  quantityMax: number
}

export const FIELD_COUNT = 7
export const ASTEROIDS_PER_FIELD_MIN = 6
export const ASTEROIDS_PER_FIELD_MAX = 12
export const FIELD_SPREAD_RADIUS = 120

export const ZONES: ZoneConfig[] = [
  {
    innerRadius: 300,
    outerRadius: 700,
    resourceWeights: { iron: 0.70, ice: 0.10, silicates: 0.15, 'rare-metals': 0.05 },
  },
  {
    innerRadius: 700,
    outerRadius: 1200,
    resourceWeights: { iron: 0.40, ice: 0.20, silicates: 0.30, 'rare-metals': 0.10 },
  },
  {
    innerRadius: 1200,
    outerRadius: 1800,
    resourceWeights: { iron: 0.20, ice: 0.40, silicates: 0.25, 'rare-metals': 0.15 },
  },
  {
    innerRadius: 1800,
    outerRadius: 2500,
    resourceWeights: { iron: 0.05, ice: 0.45, silicates: 0.15, 'rare-metals': 0.35 },
  },
]

export const SIZE_CONFIGS: Record<SizeCategory, SizeConfig> = {
  small:  { chance: 0.50, scale: 0.5, quantityMin: 50,  quantityMax: 150  },
  medium: { chance: 0.35, scale: 1.0, quantityMin: 150, quantityMax: 400  },
  large:  { chance: 0.15, scale: 1.6, quantityMin: 400, quantityMax: 1000 },
}

export const SIZE_WEIGHTS: Record<SizeCategory, number> = {
  small:  SIZE_CONFIGS.small.chance,
  medium: SIZE_CONFIGS.medium.chance,
  large:  SIZE_CONFIGS.large.chance,
}

export const ASTEROID_TEXTURE_SIZE = 32

export const RESOURCE_COLORS: Record<ResourceType, number> = {
  iron:          0xb06030,
  ice:           0x99ddff,
  silicates:     0xc8b870,
  'rare-metals': 0xcc99ff,
}
