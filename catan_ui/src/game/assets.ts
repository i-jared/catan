import type { PortType, Terrain } from './types'

export const terrainAssetMap: Record<Terrain, string> = {
  forest: '/game-assets/tiles/forest.svg',
  hills: '/game-assets/tiles/hills.svg',
  pasture: '/game-assets/tiles/pasture.svg',
  fields: '/game-assets/tiles/fields.svg',
  mountains: '/game-assets/tiles/mountains.svg',
  desert: '/game-assets/tiles/desert.svg',
}

export const portAssetMap: Record<PortType, string> = {
  generic: '/game-assets/ports/generic.svg',
  wood: '/game-assets/ports/wood.svg',
  brick: '/game-assets/ports/brick.svg',
  sheep: '/game-assets/ports/sheep.svg',
  wheat: '/game-assets/ports/wheat.svg',
  ore: '/game-assets/ports/ore.svg',
}

export const roadAssetMap = {
  red: '/game-assets/pieces/road-red.svg',
  blue: '/game-assets/pieces/road-blue.svg',
  white: '/game-assets/pieces/road-white.svg',
  orange: '/game-assets/pieces/road-orange.svg',
} as const

export const settlementAssetMap = {
  red: '/game-assets/pieces/settlement-red.svg',
  blue: '/game-assets/pieces/settlement-blue.svg',
  white: '/game-assets/pieces/settlement-white.svg',
  orange: '/game-assets/pieces/settlement-orange.svg',
} as const

export const cityAssetMap = {
  red: '/game-assets/pieces/city-red.svg',
  blue: '/game-assets/pieces/city-blue.svg',
  white: '/game-assets/pieces/city-white.svg',
  orange: '/game-assets/pieces/city-orange.svg',
} as const

export const chipAsset = '/game-assets/pieces/chip.svg'
export const robberAsset = '/game-assets/pieces/robber.svg'
