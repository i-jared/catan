import test from 'node:test'
import assert from 'node:assert/strict'
import { createLobbyGame, decide, applyEvents } from '../src/domain/game/engine.js'
import { BASE_4P_TOPOLOGY } from '../src/domain/topology/base4p.js'
import { emptyHand, handFrom } from '../src/domain/game/resources.js'
import { toPrivateView, toPublicView, filterHistoryEvents } from '../src/domain/game/views.js'
import { RuleError } from '../src/util/errors.js'
import type { GameAggregate, GameCommand, GameEvent } from '../src/domain/game/types.js'
import type { RandomSource } from '../src/util/random.js'
import { CatanService } from '../src/app/service.js'
import { InMemoryStore } from '../src/infra/store.js'

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

function startedGame(): GameAggregate {
  let game = createLobbyGame('game_started', 'user_1', 'Alice', '2026-01-01T00:00:00.000Z')
  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_2', displayName: 'Bob' })
  game = applyCommand(game, { type: 'JoinLobby', userId: 'user_3', displayName: 'Cara' })
  game = applyCommand(game, { type: 'SetReady', seatId: 'S1', ready: true })
  game = applyCommand(game, { type: 'SetReady', seatId: 'S2', ready: true })
  game = applyCommand(game, { type: 'SetReady', seatId: 'S3', ready: true })
  return applyCommand(game, { type: 'StartGame', seatId: 'S1' }, new Array(128).fill(0.2))
}

function emptyStartedGame(): GameAggregate {
  const game = startedGame()
  if (!game.board || !game.bank) {
    throw new Error('Expected initialized game')
  }
  for (const edge of Object.values(game.board.edges)) {
    edge.ownerSeatId = null
  }
  for (const intersection of Object.values(game.board.intersections)) {
    intersection.ownerSeatId = null
    intersection.building = 'none'
  }
  for (const seat of game.seats) {
    if (!seat.userId) {
      continue
    }
    seat.resources = emptyHand()
    seat.devCards = []
    seat.playedKnights = 0
    seat.roadsRemaining = 15
    seat.settlementsRemaining = 5
    seat.citiesRemaining = 4
  }
  game.awards.longestRoadSeatId = null
  game.awards.longestRoadLength = 4
  game.awards.largestArmySeatId = null
  game.awards.largestArmySize = 2
  game.trade = null
  game.turn = {
    type: 'main_turn',
    seatId: 'S1',
    turnNumber: 1,
    devCardPlayed: false,
  }
  game.turnOrder = ['S1', 'S2', 'S3']
  game.turnIndex = 0
  game.turnNumber = 1
  game.lastRoll = null
  return game
}

function findChainOfEdges(length: number): { edgeIds: string[]; intersectionIds: string[] } {
  const visited = new Set<string>()

  const walk = (edgeId: string, edgePath: string[], intersectionPath: string[]): { edgeIds: string[]; intersectionIds: string[] } | null => {
    if (edgePath.length === length) {
      return {
        edgeIds: [...edgePath],
        intersectionIds: [...intersectionPath],
      }
    }

    const currentEdge = BASE_4P_TOPOLOGY.edges[edgeId]!
    const tipIntersectionId = intersectionPath[intersectionPath.length - 1]
    if (!tipIntersectionId) {
      return null
    }
    const nextEdges = BASE_4P_TOPOLOGY.intersections[tipIntersectionId]!.adjacentEdgeIds
      .filter((candidateEdgeId) => candidateEdgeId !== edgeId && !visited.has(candidateEdgeId))

    for (const nextEdgeId of nextEdges) {
      const nextEdge = BASE_4P_TOPOLOGY.edges[nextEdgeId]!
      const nextIntersectionId = nextEdge.intersectionIds[0] === tipIntersectionId
        ? nextEdge.intersectionIds[1]
        : nextEdge.intersectionIds[0]
      visited.add(nextEdgeId)
      const result = walk(
        nextEdgeId,
        [...edgePath, nextEdgeId],
        [...intersectionPath, nextIntersectionId],
      )
      visited.delete(nextEdgeId)
      if (result) {
        return result
      }
    }
    return null
  }

  for (const [edgeId, edge] of Object.entries(BASE_4P_TOPOLOGY.edges)) {
    for (const startIntersectionId of edge.intersectionIds) {
      const otherIntersectionId = edge.intersectionIds[0] === startIntersectionId
        ? edge.intersectionIds[1]
        : edge.intersectionIds[0]
      visited.add(edgeId)
      const result = walk(edgeId, [edgeId], [startIntersectionId, otherIntersectionId])
      visited.delete(edgeId)
      if (result) {
        return result
      }
    }
  }

  throw new Error(`Unable to find chain of ${length} edges`)
}

function findExtraEdgeAtIntersection(intersectionId: string, excludedEdgeIds: string[]): string {
  const edgeId = BASE_4P_TOPOLOGY.intersections[intersectionId]!.adjacentEdgeIds.find(
    (candidateEdgeId) => !excludedEdgeIds.includes(candidateEdgeId),
  )
  if (!edgeId) {
    throw new Error('Unable to find extra edge')
  }
  return edgeId
}

test('Year of Plenty cannot overdraft the bank when taking the same resource twice', () => {
  const game = emptyStartedGame()
  game.turn = {
    type: 'main_turn',
    seatId: 'S1',
    turnNumber: 3,
    devCardPlayed: false,
  }
  game.bank!.resources.ore = 1
  game.seats[0]!.devCards.push({
    id: 'dev_1',
    type: 'year_of_plenty',
    purchasedOnTurn: 1,
    revealed: false,
    played: false,
  })

  assert.throws(
    () => decide(game, {
      type: 'PlayYearOfPlenty',
      seatId: 'S1',
      cardId: 'dev_1',
      resources: ['ore', 'ore'],
    }, {
      now: () => '2026-01-01T00:00:00.000Z',
      random: new SequenceRandom([0]),
    }),
    (error: unknown) => error instanceof RuleError && error.code === 'bank_insufficient',
  )
})

test('placing a settlement can revoke Longest Road when it splits an opponent chain', () => {
  const game = emptyStartedGame()
  const chain = findChainOfEdges(5)
  const blockingIntersectionId = chain.intersectionIds[2]!
  const supportEdgeId = findExtraEdgeAtIntersection(blockingIntersectionId, chain.edgeIds)

  for (const edgeId of chain.edgeIds) {
    game.board!.edges[edgeId]!.ownerSeatId = 'S1'
  }
  game.seats[0]!.roadsRemaining -= chain.edgeIds.length
  game.awards.longestRoadSeatId = 'S1'
  game.awards.longestRoadLength = 5

  game.board!.edges[supportEdgeId]!.ownerSeatId = 'S2'
  game.seats[1]!.roadsRemaining -= 1
  game.seats[1]!.resources = handFrom({ wood: 1, brick: 1, sheep: 1, wheat: 1 })
  game.turn = {
    type: 'main_turn',
    seatId: 'S2',
    turnNumber: 2,
    devCardPlayed: false,
  }

  const events = decide(game, {
    type: 'BuildSettlement',
    seatId: 'S2',
    intersectionId: blockingIntersectionId,
  }, {
    now: () => '2026-01-01T00:00:00.000Z',
    random: new SequenceRandom([0]),
  })

  assert.ok(events.some((event) => event.type === 'LongestRoadUpdated' && event.seatId === null))
})

test('public view does not leak hidden victory point cards', () => {
  const game = emptyStartedGame()
  game.board!.intersections.I1!.ownerSeatId = 'S1'
  game.board!.intersections.I1!.building = 'settlement'
  game.seats[0]!.devCards.push({
    id: 'dev_vp',
    type: 'victory_point',
    purchasedOnTurn: 1,
    revealed: false,
    played: false,
  })

  const publicView = toPublicView(game)
  const privateView = toPrivateView(game, 'S1')
  const publicSeat = publicView.seats.find((seat) => seat.seatId === 'S1')

  assert.equal(publicSeat?.publicVictoryPoints, 1)
  assert.equal(privateView.me?.score, 2)
})

test('history filtering hides hidden development cards and stolen resources from other players', () => {
  const game = emptyStartedGame()
  const history: GameEvent[] = [
    {
      type: 'DevelopmentCardPurchased',
      seatId: 'S1',
      cardId: 'dev_secret',
      cardType: 'victory_point',
      turnNumber: 2,
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    {
      type: 'ResourceStolen',
      fromSeatId: 'S2',
      toSeatId: 'S1',
      resource: 'ore',
      timestamp: '2026-01-01T00:00:01.000Z',
    },
  ]

  const filtered = filterHistoryEvents(game, 'S3', history) as Array<Record<string, unknown>>
  assert.equal(filtered[0]?.cardType, 'unknown')
  assert.equal(filtered[0]?.cardId, null)
  assert.equal(filtered[1]?.resource, 'unknown')

  const ownerFiltered = filterHistoryEvents(game, 'S1', history) as Array<Record<string, unknown>>
  assert.equal(ownerFiltered[0]?.cardType, 'victory_point')
  assert.equal(ownerFiltered[1]?.resource, 'ore')
})

test('service enforces command idempotency and optimistic version checks', async () => {
  const inMemoryService = new CatanService(new InMemoryStore())
  const session = await inMemoryService.createGuest('Alice')
  const game = await inMemoryService.createLobby(session.accessToken)

  const first = await inMemoryService.submitGameCommand(session.accessToken, game.id, {
    commandId: 'cmd_ready',
    expectedVersion: game.version,
    command: {
      type: 'SetReady',
      seatId: 'S1',
      ready: true,
    },
  })
  const duplicate = await inMemoryService.submitGameCommand(session.accessToken, game.id, {
    commandId: 'cmd_ready',
    expectedVersion: game.version,
    command: {
      type: 'SetReady',
      seatId: 'S1',
      ready: true,
    },
  })

  assert.equal(first.game.version, duplicate.game.version)
  assert.deepEqual(first.events, duplicate.events)

  await assert.rejects(
    inMemoryService.submitGameCommand(session.accessToken, game.id, {
      commandId: 'cmd_stale',
      expectedVersion: 0,
      command: {
        type: 'SetReady',
        seatId: 'S1',
        ready: false,
      },
    }),
    (error: unknown) => error instanceof RuleError && error.code === 'version_conflict',
  )
})

test('lobby creation persists initial history events', async () => {
  const service = new CatanService(new InMemoryStore())
  const session = await service.createGuest('Alice')
  const game = await service.createLobby(session.accessToken)
  const history = await service.getHistory(session.accessToken, game.id)

  const typedHistory = history as GameEvent[]
  assert.equal(typedHistory[0]?.type, 'LobbyCreated')
  assert.equal(typedHistory[1]?.type, 'SeatJoined')
})
