import { RuleError } from '../../util/errors.js'

export const resources = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
export type Resource = (typeof resources)[number]

export const terrains = [
  'forest',
  'hills',
  'pasture',
  'fields',
  'mountains',
  'desert',
] as const
export type Terrain = (typeof terrains)[number]

export const devCardTypes = [
  'knight',
  'victory_point',
  'road_building',
  'year_of_plenty',
  'monopoly',
] as const
export type DevCardType = (typeof devCardTypes)[number]

export const portTypes = ['generic', ...resources] as const
export type PortType = (typeof portTypes)[number]

export type ResourceHand = Record<Resource, number>

export const emptyHand = (): ResourceHand => ({
  wood: 0,
  brick: 0,
  sheep: 0,
  wheat: 0,
  ore: 0,
})

export function cloneHand(hand: ResourceHand): ResourceHand {
  return { ...hand }
}

export function handFrom(entries: Partial<ResourceHand>): ResourceHand {
  return {
    ...emptyHand(),
    ...entries,
  }
}

export function addHand(target: ResourceHand, delta: ResourceHand): void {
  for (const resource of resources) {
    target[resource] += delta[resource]
  }
}

export function subtractHand(target: ResourceHand, delta: ResourceHand): void {
  for (const resource of resources) {
    const nextValue = target[resource] - delta[resource]
    if (nextValue < 0) {
      throw new RuleError('insufficient_resources', `Not enough ${resource}`)
    }
    target[resource] = nextValue
  }
}

export function hasHand(target: ResourceHand, required: ResourceHand): boolean {
  return resources.every((resource) => target[resource] >= required[resource])
}

export function totalCards(hand: ResourceHand): number {
  return resources.reduce((sum, resource) => sum + hand[resource], 0)
}

export function onlyResource(resource: Resource, amount: number): ResourceHand {
  const hand = emptyHand()
  hand[resource] = amount
  return hand
}

export function resourceFromTerrain(terrain: Terrain): Resource | null {
  switch (terrain) {
    case 'forest':
      return 'wood'
    case 'hills':
      return 'brick'
    case 'pasture':
      return 'sheep'
    case 'fields':
      return 'wheat'
    case 'mountains':
      return 'ore'
    case 'desert':
      return null
  }
}

export const buildCosts = {
  road: handFrom({ wood: 1, brick: 1 }),
  settlement: handFrom({ wood: 1, brick: 1, sheep: 1, wheat: 1 }),
  city: handFrom({ wheat: 2, ore: 3 }),
  developmentCard: handFrom({ sheep: 1, wheat: 1, ore: 1 }),
} as const
