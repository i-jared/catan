import test from 'node:test'
import assert from 'node:assert/strict'
import { createLobbyGame, decide, applyEvents } from '../src/domain/game/engine.js'
import type { GameAggregate, GameCommand } from '../src/domain/game/types.js'
import type { RandomSource } from '../src/util/random.js'
import { BASE_4P_TOPOLOGY } from '../src/domain/topology/base4p.js'

class SequenceRandom implements RandomSource {
  constructor(private readonly values: number[]) {}

  next(): number {
    return this.values.length > 0 ? this.values.shift()! : 0
  }
}

function applyCommand(game: GameAggregate, command: GameCommand, randomValues: number[] = [0]): GameAggregate {
  const events = decide(game, command, {
    now: () => '2026-01-01T00:00:00.000Z',
    random: new SequenceRandom(randomValues),
  })
  return applyEvents(game, events)
}

function findLegalSetupSettlement(game: GameAggregate, seatId: string): string {
  for (const intersectionId of Object.keys(BASE_4P_TOPOLOGY.intersections)) {
    try {
      decide(game, {
        type: 'PlaceSetupSettlement',
        seatId,
        intersectionId,
      }, {
        now: () => '2026-01-01T00:00:00.000Z',
        random: new SequenceRandom([0]),
      })
      return intersectionId
    } catch {}
  }
  throw new Error('No legal setup settlement found')
}

function findLegalSetupRoad(game: GameAggregate, seatId: string, originIntersectionId: string): string {
  for (const edgeId of BASE_4P_TOPOLOGY.intersections[originIntersectionId]!.adjacentEdgeIds) {
    try {
      decide(game, {
        type: 'PlaceSetupRoad',
        seatId,
        edgeId,
      }, {
        now: () => '2026-01-01T00:00:00.000Z',
        random: new SequenceRandom([0]),
      })
      return edgeId
    } catch {}
  }
  throw new Error('No legal setup road found')
}

test('three players can create, join, start, and complete setup', () => {
  let game = createLobbyGame('game_1', 'user_1', 'Alice', '2026-01-01T00:00:00.000Z')

  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_2', displayName: 'Bob' })
  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_3', displayName: 'Cara' })

  game = applyCommand(game, { type: 'SetReady', seatId: 'S1', ready: true })
  game = applyCommand(game, { type: 'SetReady', seatId: 'S2', ready: true })
  game = applyCommand(game, { type: 'SetReady', seatId: 'S3', ready: true })

  game = applyCommand(game, { type: 'StartGame', seatId: 'S1' }, new Array(128).fill(0))

  assert.equal(game.status, 'in_progress')
  assert.equal(game.turn.type, 'setup_place_settlement')
  assert.equal(game.turnOrder.length, 3)
  assert.ok(game.board)

  for (let placements = 0; placements < 6; placements += 1) {
    assert.equal(game.turn.type, 'setup_place_settlement')
    const seatId = game.turn.seatId
    const intersectionId = findLegalSetupSettlement(game, seatId)
    game = applyCommand(game, { type: 'PlaceSetupSettlement', seatId, intersectionId })

    assert.equal(game.turn.type, 'setup_place_road')
    const edgeId = findLegalSetupRoad(game, seatId, intersectionId)
    game = applyCommand(game, { type: 'PlaceSetupRoad', seatId, edgeId })
  }

  assert.equal(game.turn.type, 'await_roll')
  assert.equal(game.turn.seatId, game.turnOrder[0])
})

test('rolling a seven transitions to robber movement when no discards are needed', () => {
  let game = createLobbyGame('game_2', 'user_1', 'Alice', '2026-01-01T00:00:00.000Z')

  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_2', displayName: 'Bob' })
  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_3', displayName: 'Cara' })

  for (const seatId of ['S1', 'S2', 'S3']) {
    game = applyCommand(game, { type: 'SetReady', seatId, ready: true })
  }
  game = applyCommand(game, { type: 'StartGame', seatId: 'S1' }, new Array(128).fill(0.1))

  for (let placements = 0; placements < 6; placements += 1) {
    const seatId = (game.turn.type === 'setup_place_settlement' ? game.turn.seatId : 'S1')
    const intersectionId = findLegalSetupSettlement(game, seatId)
    game = applyCommand(game, { type: 'PlaceSetupSettlement', seatId, intersectionId })
    const edgeId = findLegalSetupRoad(game, seatId, intersectionId)
    game = applyCommand(game, { type: 'PlaceSetupRoad', seatId, edgeId })
  }

  assert.equal(game.turn.type, 'await_roll')
  game = applyCommand(game, { type: 'RollDice', seatId: game.turn.seatId }, [0.4, 0.5])
  assert.equal(game.turn.type, 'await_robber_move')
})
