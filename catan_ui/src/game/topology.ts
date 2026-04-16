import type { BoardGeometry } from './types'

const LAND_COORDS = [
  [0, 0],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [2, -2],
  [2, -1],
  [2, 0],
  [1, 1],
  [0, 2],
  [-1, 2],
  [-2, 2],
  [-2, 1],
  [-2, 0],
  [-1, -1],
  [0, -2],
  [1, -2],
] as const

const SQRT_3 = Math.sqrt(3)
const SCALE = 84
const PADDING = 140

function pointKey(x: number, y: number): string {
  return `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
}

function axialToCartesian(q: number, r: number) {
  return {
    x: SQRT_3 * (q + r / 2) * SCALE,
    y: 1.5 * r * SCALE,
  }
}

function cornerPoint(cx: number, cy: number, index: number) {
  const angle = ((60 * index) - 30) * (Math.PI / 180)
  return {
    x: cx + Math.cos(angle) * SCALE,
    y: cy + Math.sin(angle) * SCALE,
  }
}

export function buildBoardGeometry(): BoardGeometry {
  const hexes: BoardGeometry['hexes'] = {}
  const intersections: BoardGeometry['intersections'] = {}
  const edges: BoardGeometry['edges'] = {}
  const pointIdByKey = new Map<string, string>()
  const pointById = new Map<string, { x: number; y: number }>()
  const edgeIdByKey = new Map<string, string>()

  let intersectionCount = 0
  let edgeCount = 0

  for (const [q, r] of LAND_COORDS) {
    const hexId = `H_${q}_${r}`
    const center = axialToCartesian(q, r)
    hexes[hexId] = {
      x: center.x,
      y: center.y,
      q,
      r,
    }

    const cornerIds: string[] = []

    for (let index = 0; index < 6; index += 1) {
      const point = cornerPoint(center.x, center.y, index)
      const key = pointKey(point.x, point.y)
      let intersectionId = pointIdByKey.get(key)
      if (!intersectionId) {
        intersectionCount += 1
        intersectionId = `I${intersectionCount}`
        pointIdByKey.set(key, intersectionId)
        pointById.set(intersectionId, point)
        intersections[intersectionId] = point
      }
      cornerIds.push(intersectionId)
    }

    for (let index = 0; index < 6; index += 1) {
      const leftId = cornerIds[index]!
      const rightId = cornerIds[(index + 1) % 6]!
      const edgeKey = [leftId, rightId].sort().join(':')

      if (edgeIdByKey.has(edgeKey)) {
        continue
      }

      edgeCount += 1
      const edgeId = `E${edgeCount}`
      edgeIdByKey.set(edgeKey, edgeId)

      const leftPoint = pointById.get(leftId)!
      const rightPoint = pointById.get(rightId)!
      const mx = (leftPoint.x + rightPoint.x) / 2
      const my = (leftPoint.y + rightPoint.y) / 2
      const angle = Math.atan2(rightPoint.y - leftPoint.y, rightPoint.x - leftPoint.x) * (180 / Math.PI)
      edges[edgeId] = {
        x1: leftPoint.x,
        y1: leftPoint.y,
        x2: rightPoint.x,
        y2: rightPoint.y,
        mx,
        my,
        angle,
        intersectionIds: [leftId, rightId],
      }
    }
  }

  const points = [
    ...Object.values(hexes).flatMap((hex) => [
      { x: hex.x - SCALE, y: hex.y - SCALE },
      { x: hex.x + SCALE, y: hex.y + SCALE },
    ]),
    ...Object.values(intersections),
  ]

  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))

  for (const hex of Object.values(hexes)) {
    hex.x = hex.x - minX + PADDING
    hex.y = hex.y - minY + PADDING
  }

  for (const intersection of Object.values(intersections)) {
    intersection.x = intersection.x - minX + PADDING
    intersection.y = intersection.y - minY + PADDING
  }

  for (const edge of Object.values(edges)) {
    edge.x1 = edge.x1 - minX + PADDING
    edge.x2 = edge.x2 - minX + PADDING
    edge.mx = edge.mx - minX + PADDING
    edge.y1 = edge.y1 - minY + PADDING
    edge.y2 = edge.y2 - minY + PADDING
    edge.my = edge.my - minY + PADDING
  }

  const ports: BoardGeometry['ports'] = {}
  const boundaryEdges = Object.entries(edges)
    .filter(([edgeId]) => {
      let count = 0
      for (const [q, r] of LAND_COORDS) {
        const edgeIdsForHex = []
        const center = axialToCartesian(q, r)
        const cornerIds: string[] = []
        for (let index = 0; index < 6; index += 1) {
          const point = cornerPoint(center.x, center.y, index)
          cornerIds.push(pointIdByKey.get(pointKey(point.x, point.y))!)
        }
        for (let index = 0; index < 6; index += 1) {
          edgeIdsForHex.push(edgeIdByKey.get([cornerIds[index]!, cornerIds[(index + 1) % 6]!].sort().join(':')))
        }
        if (edgeIdsForHex.includes(edgeId)) {
          count += 1
        }
      }
      return count === 1
    })
    .map(([edgeId, edge]) => ({
      edgeId,
      mx: edge.mx,
      my: edge.my,
      angle: Math.atan2(edge.my - (maxY - minY) / 2, edge.mx - (maxX - minX) / 2),
    }))
    .sort((left, right) => left.angle - right.angle)

  const portIndexes = Array.from(new Set(Array.from({ length: 9 }, (_, index) => Math.round((index * boundaryEdges.length) / 9) % boundaryEdges.length)))
  portIndexes.forEach((boundaryIndex, index) => {
    const edge = boundaryEdges[boundaryIndex]
    if (!edge) {
      return
    }
    const distance = 64
    ports[`P${index + 1}`] = {
      x: edge.mx + Math.cos(edge.angle) * distance,
      y: edge.my + Math.sin(edge.angle) * distance,
      angle: edge.angle * (180 / Math.PI),
    }
  })

  return {
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
    hexes,
    intersections,
    edges,
    ports,
  }
}

export const boardGeometry = buildBoardGeometry()
