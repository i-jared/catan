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

export interface HexTopology {
  id: string
  axial: { q: number; r: number }
  adjacentHexIds: string[]
  intersectionIds: [string, string, string, string, string, string]
  edgeIds: [string, string, string, string, string, string]
}

export interface IntersectionTopology {
  id: string
  point: { x: number; y: number }
  adjacentIntersectionIds: string[]
  adjacentEdgeIds: string[]
  adjacentHexIds: string[]
  portId: string | null
}

export interface EdgeTopology {
  id: string
  intersectionIds: [string, string]
  adjacentHexIds: string[]
  midpoint: { x: number; y: number }
}

export interface PortTopology {
  id: string
  edgeId: string
  intersectionIds: [string, string]
  order: number
}

export interface BoardTopology {
  hexes: Record<string, HexTopology>
  intersections: Record<string, IntersectionTopology>
  edges: Record<string, EdgeTopology>
  ports: Record<string, PortTopology>
  orderedPortIds: string[]
}

type Point = { x: number; y: number }

const SQRT_3 = Math.sqrt(3)
const AXIAL_DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const

function pointKey(point: Point): string {
  return `${Math.round(point.x * 1_000_000)}:${Math.round(point.y * 1_000_000)}`
}

function axialToCartesian(q: number, r: number): Point {
  return {
    x: SQRT_3 * (q + r / 2),
    y: 1.5 * r,
  }
}

function cornerPoint(center: Point, index: number): Point {
  const angle = ((60 * index) - 30) * (Math.PI / 180)
  return {
    x: center.x + Math.cos(angle),
    y: center.y + Math.sin(angle),
  }
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function sortByAngle<T extends { midpoint: Point }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const a = Math.atan2(left.midpoint.y, left.midpoint.x)
    const b = Math.atan2(right.midpoint.y, right.midpoint.x)
    return a - b
  })
}

function pickPortEdgeIndexes(totalBoundaryEdges: number): number[] {
  const result: number[] = []
  for (let index = 0; index < 9; index += 1) {
    result.push(Math.round((index * totalBoundaryEdges) / 9) % totalBoundaryEdges)
  }
  return Array.from(new Set(result))
}

export function buildBase4pTopology(): BoardTopology {
  const hexes: Record<string, HexTopology> = {}
  const intersections: Record<string, IntersectionTopology> = {}
  const edges: Record<string, EdgeTopology> = {}

  const intersectionIdsByKey = new Map<string, string>()
  const intersectionPointsById = new Map<string, Point>()
  const edgeIdsByKey = new Map<string, string>()

  let intersectionCount = 0
  let edgeCount = 0

  for (const [q, r] of LAND_COORDS) {
    const hexId = `H_${q}_${r}`
    const center = axialToCartesian(q, r)
    const cornerIds: string[] = []
    const edgeIdsForHex: string[] = []

    for (let index = 0; index < 6; index += 1) {
      const point = cornerPoint(center, index)
      const key = pointKey(point)

      let intersectionId = intersectionIdsByKey.get(key)
      if (!intersectionId) {
        intersectionCount += 1
        intersectionId = `I${intersectionCount}`
        intersectionIdsByKey.set(key, intersectionId)
        intersectionPointsById.set(intersectionId, point)
        intersections[intersectionId] = {
          id: intersectionId,
          point,
          adjacentIntersectionIds: [],
          adjacentEdgeIds: [],
          adjacentHexIds: [],
          portId: null,
        }
      }

      cornerIds.push(intersectionId)
      intersections[intersectionId]!.adjacentHexIds.push(hexId)
    }

    for (let index = 0; index < 6; index += 1) {
      const leftId = cornerIds[index]!
      const rightId = cornerIds[(index + 1) % 6]!
      const edgeKey = [leftId, rightId].sort().join(':')

      let edgeId = edgeIdsByKey.get(edgeKey)
      if (!edgeId) {
        edgeCount += 1
        edgeId = `E${edgeCount}`
        edgeIdsByKey.set(edgeKey, edgeId)

        const leftPoint = intersectionPointsById.get(leftId)!
        const rightPoint = intersectionPointsById.get(rightId)!
        edges[edgeId] = {
          id: edgeId,
          intersectionIds: [leftId, rightId],
          adjacentHexIds: [hexId],
          midpoint: midpoint(leftPoint, rightPoint),
        }

        intersections[leftId]!.adjacentIntersectionIds.push(rightId)
        intersections[rightId]!.adjacentIntersectionIds.push(leftId)
        intersections[leftId]!.adjacentEdgeIds.push(edgeId)
        intersections[rightId]!.adjacentEdgeIds.push(edgeId)
      } else {
        edges[edgeId]!.adjacentHexIds.push(hexId)
      }

      edgeIdsForHex.push(edgeId)
    }

    const adjacentHexIds = AXIAL_DIRECTIONS
      .map(([dq, dr]) => `H_${q + dq}_${r + dr}`)
      .filter((candidateId) => LAND_COORDS.some(([otherQ, otherR]) => candidateId === `H_${otherQ}_${otherR}`))

    hexes[hexId] = {
      id: hexId,
      axial: { q, r },
      adjacentHexIds,
      intersectionIds: cornerIds as [string, string, string, string, string, string],
      edgeIds: edgeIdsForHex as [string, string, string, string, string, string],
    }
  }

  const boundaryEdges = sortByAngle(
    Object.values(edges).filter((edge) => edge.adjacentHexIds.length === 1),
  )
  const portIndexes = pickPortEdgeIndexes(boundaryEdges.length)
  const ports: Record<string, PortTopology> = {}

  portIndexes.forEach((boundaryIndex, portIndex) => {
    const edge = boundaryEdges[boundaryIndex]
    if (!edge) {
      return
    }
    const portId = `P${portIndex + 1}`
    ports[portId] = {
      id: portId,
      edgeId: edge.id,
      intersectionIds: edge.intersectionIds,
      order: portIndex,
    }
    for (const intersectionId of edge.intersectionIds) {
      intersections[intersectionId]!.portId = portId
    }
  })

  return {
    hexes,
    intersections,
    edges,
    ports,
    orderedPortIds: Object.values(ports)
      .sort((left, right) => left.order - right.order)
      .map((port) => port.id),
  }
}

export const BASE_4P_TOPOLOGY = buildBase4pTopology()
