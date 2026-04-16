import test from 'node:test'
import assert from 'node:assert/strict'
import { BASE_4P_TOPOLOGY } from '../src/domain/topology/base4p.js'

test('base topology has expected Catan counts', () => {
  assert.equal(Object.keys(BASE_4P_TOPOLOGY.hexes).length, 19)
  assert.equal(Object.keys(BASE_4P_TOPOLOGY.intersections).length, 54)
  assert.equal(Object.keys(BASE_4P_TOPOLOGY.edges).length, 72)
  assert.equal(Object.keys(BASE_4P_TOPOLOGY.ports).length, 9)
})

test('all intersections and edges are bidirectionally linked', () => {
  for (const intersection of Object.values(BASE_4P_TOPOLOGY.intersections)) {
    for (const adjacentIntersectionId of intersection.adjacentIntersectionIds) {
      assert.ok(
        BASE_4P_TOPOLOGY.intersections[adjacentIntersectionId]?.adjacentIntersectionIds.includes(intersection.id),
      )
    }
    for (const edgeId of intersection.adjacentEdgeIds) {
      assert.ok(BASE_4P_TOPOLOGY.edges[edgeId]?.intersectionIds.includes(intersection.id))
    }
  }
})
