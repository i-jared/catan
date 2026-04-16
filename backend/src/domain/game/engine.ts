import { BASE_4P_TOPOLOGY } from '../topology/base4p.js'
import { RuleError } from '../../util/errors.js'
import { makeId, nextInt, sample, shuffle, type RandomSource } from '../../util/random.js'
import {
  addHand,
  buildCosts,
  cloneHand,
  emptyHand,
  handFrom,
  hasHand,
  onlyResource,
  portTypes,
  resourceFromTerrain,
  resources,
  subtractHand,
  totalCards,
  type DevCardType,
  type PortType,
  type Resource,
  type ResourceHand,
  type Terrain,
} from './resources.js'
import type {
  AwardsState,
  BankState,
  BoardState,
  DevCardInstance,
  EdgeState,
  GameAggregate,
  GameCommand,
  GameEvent,
  IntersectionState,
  SeatState,
  TradeOfferState,
  TurnState,
} from './types.js'

const SEAT_COLORS = ['red', 'blue', 'white', 'orange'] as const

const TERRAIN_POOL: Terrain[] = [
  'desert',
  'forest',
  'forest',
  'forest',
  'forest',
  'hills',
  'hills',
  'hills',
  'pasture',
  'pasture',
  'pasture',
  'pasture',
  'fields',
  'fields',
  'fields',
  'fields',
  'mountains',
  'mountains',
  'mountains',
]

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12] as const

const DEV_DECK_POOL: DevCardType[] = [
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'knight',
  'victory_point',
  'victory_point',
  'victory_point',
  'victory_point',
  'victory_point',
  'road_building',
  'road_building',
  'year_of_plenty',
  'year_of_plenty',
  'monopoly',
  'monopoly',
]

const PORT_POOL: PortType[] = [
  'generic',
  'generic',
  'generic',
  'generic',
  'wood',
  'brick',
  'sheep',
  'wheat',
  'ore',
]

export interface DecideContext {
  now(): string
  random: RandomSource
}

interface GeneratedStart {
  board: BoardState
  devDeck: DevCardType[]
  turnOrder: string[]
  firstSeatId: string
}

export function createLobbyGame(
  gameId: string,
  ownerUserId: string,
  ownerDisplayName: string,
  now: string,
): GameAggregate {
  return createLobbyGameResult(gameId, ownerUserId, ownerDisplayName, now).game
}

export function createLobbyGameResult(
  gameId: string,
  ownerUserId: string,
  ownerDisplayName: string,
  now: string,
): { game: GameAggregate; events: GameEvent[] } {
  const base = createEmptyGame(gameId, now)
  const events: GameEvent[] = [
    {
      type: 'LobbyCreated',
      ownerSeatId: 'S1',
      timestamp: now,
    },
    {
      type: 'SeatJoined',
      seatId: 'S1',
      userId: ownerUserId,
      displayName: ownerDisplayName,
      timestamp: now,
    },
  ]
  return {
    game: applyEvents(base, events),
    events,
  }
}

export function createEmptyGame(gameId: string, now: string): GameAggregate {
  return {
    id: gameId,
    ruleset: 'base-4p',
    status: 'lobby',
    version: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    ownerSeatId: null,
    seats: SEAT_COLORS.map((color, index) => ({
      seatId: `S${index + 1}`,
      userId: null,
      displayName: `Player ${index + 1}`,
      color,
      isConnected: false,
      isReady: false,
      resources: emptyHand(),
      devCards: [],
      playedKnights: 0,
      roadsRemaining: 15,
      settlementsRemaining: 5,
      citiesRemaining: 4,
    })),
    board: null,
    bank: null,
    devDeck: [],
    turn: { type: 'lobby' },
    awards: {
      longestRoadSeatId: null,
      longestRoadLength: 4,
      largestArmySeatId: null,
      largestArmySize: 2,
    },
    trade: null,
    turnOrder: [],
    turnIndex: 0,
    turnNumber: 0,
    lastRoll: null,
    setup: null,
    winnerSeatId: null,
  }
}

export function decide(game: GameAggregate, command: GameCommand, context: DecideContext): GameEvent[] {
  const timestamp = context.now()
  const events: GameEvent[] = []
  let shadow = game

  const push = (event: GameEvent): void => {
    events.push(event)
    shadow = applyEvent(shadow, event)
  }

  switch (command.type) {
    case 'JoinLobby': {
      requireStatus(game, 'lobby')
      if (game.seats.some((seat) => seat.userId === command.userId)) {
        throw new RuleError('already_joined', 'User already joined this lobby')
      }
      const seat = game.seats.find((candidate) => candidate.userId === null)
      if (!seat) {
        throw new RuleError('lobby_full', 'No open seats')
      }
      push({
        type: 'SeatJoined',
        seatId: seat.seatId,
        userId: command.userId,
        displayName: command.displayName,
        timestamp,
      })
      return events
    }

    case 'LeaveLobby': {
      requireStatus(game, 'lobby')
      requireOccupiedSeat(game, command.seatId)
      push({
        type: 'SeatLeft',
        seatId: command.seatId,
        timestamp,
      })
      return events
    }

    case 'SetReady': {
      requireStatus(game, 'lobby')
      requireOccupiedSeat(game, command.seatId)
      push({
        type: 'SeatReadySet',
        seatId: command.seatId,
        ready: command.ready,
        timestamp,
      })
      return events
    }

    case 'StartGame': {
      requireStatus(game, 'lobby')
      const seat = requireOccupiedSeat(game, command.seatId)
      if (game.ownerSeatId !== seat.seatId) {
        throw new RuleError('forbidden', 'Only the lobby owner can start the game')
      }
      const occupied = occupiedSeats(game)
      if (occupied.length < 3 || occupied.length > 4) {
        throw new RuleError('invalid_player_count', 'Base Catan requires 3 or 4 players')
      }
      if (occupied.some((occupiedSeat) => !occupiedSeat.isReady)) {
        throw new RuleError('not_ready', 'All players must be ready')
      }
      const generated = generateStartState(game, context.random)
      push({
        type: 'GameStarted',
        timestamp,
        board: generated.board,
        devDeck: generated.devDeck,
        turnOrder: generated.turnOrder,
        firstSeatId: generated.firstSeatId,
      })
      return events
    }

    case 'PlaceSetupSettlement': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'setup_place_settlement')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const board = requireBoard(game)
      validateSetupSettlement(board, command.intersectionId)

      push({
        type: 'SetupSettlementPlaced',
        seatId: command.seatId,
        intersectionId: command.intersectionId,
        round: game.turn.round,
        timestamp,
      })

      if (game.turn.round === 2) {
        const startingResources = computeStartingResources(shadow, command.intersectionId)
        if (totalCards(startingResources) > 0) {
          push({
            type: 'InitialResourcesGranted',
            seatId: command.seatId,
            resources: startingResources,
            timestamp,
          })
        }
      }

      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'setup_place_road',
          seatId: command.seatId,
          round: game.turn.round,
          originIntersectionId: command.intersectionId,
        },
        timestamp,
      })

      return events
    }

    case 'PlaceSetupRoad': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'setup_place_road')
      assertActiveSeat(game.turn.seatId, command.seatId)
      validateSetupRoad(requireBoard(game), game.turn.originIntersectionId, command.edgeId)

      push({
        type: 'SetupRoadPlaced',
        seatId: command.seatId,
        edgeId: command.edgeId,
        round: game.turn.round,
        timestamp,
      })

      const nextTurn = computeNextSetupTurn(shadow, command.seatId, game.turn.round)
      if (nextTurn) {
        push({
          type: 'TurnStateChanged',
          turn: nextTurn,
          timestamp,
        })
      } else {
        const firstSeatId = shadow.turnOrder[0]
        if (!firstSeatId) {
          throw new Error('Missing first seat')
        }
        push({
          type: 'TurnStarted',
          seatId: firstSeatId,
          turnNumber: 1,
          timestamp,
        })
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_roll',
            seatId: firstSeatId,
            turnNumber: 1,
            devCardPlayed: false,
          },
          timestamp,
        })
      }

      return events
    }

    case 'RollDice': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_roll')
      assertActiveSeat(game.turn.seatId, command.seatId)

      const die1 = nextInt(context.random, 6) + 1
      const die2 = nextInt(context.random, 6) + 1
      const total = die1 + die2

      push({
        type: 'DiceRolled',
        seatId: command.seatId,
        die1,
        die2,
        total,
        timestamp,
      })

      if (total === 7) {
        const pendingSeatIds = shadow.seats
          .filter((seat) => seat.userId !== null && totalCards(seat.resources) > 7)
          .map((seat) => seat.seatId)

        if (pendingSeatIds.length > 0) {
          push({
            type: 'TurnStateChanged',
            turn: {
              type: 'await_discards',
              seatId: command.seatId,
              turnNumber: game.turn.turnNumber,
              pendingSeatIds,
            },
            timestamp,
          })
        } else {
          push({
            type: 'TurnStateChanged',
            turn: {
              type: 'await_robber_move',
              seatId: command.seatId,
              turnNumber: game.turn.turnNumber,
              source: 'rolled_7',
              devCardPlayed: false,
            },
            timestamp,
          })
        }
        return events
      }

      const payouts = computeProductionPayouts(shadow, total)
      push({
        type: 'ResourcesProduced',
        payouts,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: false,
        },
        timestamp,
      })
      return events
    }

    case 'DiscardCards': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_discards')
      const seat = requireOccupiedSeat(game, command.seatId)
      if (!game.turn.pendingSeatIds.includes(command.seatId)) {
        throw new RuleError('invalid_actor', 'This seat does not need to discard')
      }
      const expected = Math.floor(totalCards(seat.resources) / 2)
      if (totalCards(command.cards) !== expected) {
        throw new RuleError('invalid_discard_count', `Must discard exactly ${expected} cards`)
      }
      if (!hasHand(seat.resources, command.cards)) {
        throw new RuleError('insufficient_resources', 'Cannot discard cards you do not have')
      }

      push({
        type: 'CardsDiscarded',
        seatId: command.seatId,
        cards: command.cards,
        timestamp,
      })

      const remainingSeatIds = game.turn.pendingSeatIds.filter((seatId) => seatId !== command.seatId)
      if (remainingSeatIds.length > 0) {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_discards',
            seatId: game.turn.seatId,
            turnNumber: game.turn.turnNumber,
            pendingSeatIds: remainingSeatIds,
          },
          timestamp,
        })
      } else {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_robber_move',
            seatId: game.turn.seatId,
            turnNumber: game.turn.turnNumber,
            source: 'rolled_7',
            devCardPlayed: false,
          },
          timestamp,
        })
      }
      return events
    }

    case 'MoveRobber': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_robber_move')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const board = requireBoard(game)
      if (!board.hexes[command.hexId]) {
        throw new RuleError('invalid_hex', 'Unknown hex')
      }
      if (board.robberHexId === command.hexId) {
        throw new RuleError('same_hex', 'Robber must move to a different hex')
      }

      push({
        type: 'RobberMoved',
        seatId: command.seatId,
        hexId: command.hexId,
        source: game.turn.source,
        timestamp,
      })

      const eligibleVictimSeatIds = robberVictims(shadow, command.hexId, command.seatId)
      if (eligibleVictimSeatIds.length > 0) {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_robber_steal',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            robberHexId: command.hexId,
            eligibleVictimSeatIds,
            source: game.turn.source,
            devCardPlayed: game.turn.devCardPlayed,
          },
          timestamp,
        })
      } else {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'main_turn',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            devCardPlayed: game.turn.devCardPlayed,
          },
          timestamp,
        })
      }
      return events
    }

    case 'StealRandomCard': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_robber_steal')
      assertActiveSeat(game.turn.seatId, command.seatId)
      if (!game.turn.eligibleVictimSeatIds.includes(command.fromSeatId)) {
        throw new RuleError('invalid_victim', 'Seat cannot be stolen from')
      }
      const victim = requireOccupiedSeat(game, command.fromSeatId)
      const resource = randomResourceFromHand(context.random, victim.resources)
      if (!resource) {
        throw new RuleError('empty_hand', 'Victim has no resources')
      }

      push({
        type: 'ResourceStolen',
        fromSeatId: command.fromSeatId,
        toSeatId: command.seatId,
        resource,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: game.turn.devCardPlayed,
        },
        timestamp,
      })
      return events
    }

    case 'BuildRoad': {
      requireStatus(game, 'in_progress')
      const isFreeBuild = game.turn.type === 'resolving_road_building'
      if (game.turn.type === 'resolving_road_building') {
        const turn = game.turn
        assertActiveSeat(turn.seatId, command.seatId)
      } else {
        requireTurnType(game.turn, 'main_turn')
        assertActiveSeat(game.turn.seatId, command.seatId)
      }

      const seat = requireOccupiedSeat(shadow, command.seatId)
      if (seat.roadsRemaining <= 0) {
        throw new RuleError('no_pieces_remaining', 'No roads remaining')
      }
      if (!isLegalRoadPlacement(shadow, command.seatId, command.edgeId)) {
        throw new RuleError('illegal_road', 'Road placement is not legal')
      }
      if (!isFreeBuild && !hasHand(seat.resources, buildCosts.road)) {
        throw new RuleError('insufficient_resources', 'Not enough resources to build a road')
      }

      push({
        type: 'RoadBuilt',
        seatId: command.seatId,
        edgeId: command.edgeId,
        free: isFreeBuild,
        timestamp,
      })
      maybeUpdateLongestRoad(shadow, timestamp, push)
      maybeWinGame(shadow, command.seatId, timestamp, push)

      if (game.turn.type === 'resolving_road_building') {
        const turn = game.turn
        const roadsLeft = turn.roadsLeftToPlace - 1
        if (roadsLeft > 0 && listLegalRoadEdges(shadow, command.seatId).length > 0) {
          push({
            type: 'TurnStateChanged',
            turn: {
              type: 'resolving_road_building',
              seatId: command.seatId,
              turnNumber: turn.turnNumber,
              roadsLeftToPlace: roadsLeft as 1 | 2,
              devCardPlayed: true,
            },
            timestamp,
          })
        } else {
          push({
            type: 'TurnStateChanged',
            turn: {
              type: 'main_turn',
              seatId: command.seatId,
              turnNumber: turn.turnNumber,
              devCardPlayed: true,
            },
            timestamp,
          })
        }
      }
      return events
    }

    case 'BuildSettlement': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)

      const seat = requireOccupiedSeat(shadow, command.seatId)
      if (seat.settlementsRemaining <= 0) {
        throw new RuleError('no_pieces_remaining', 'No settlements remaining')
      }
      if (!hasHand(seat.resources, buildCosts.settlement)) {
        throw new RuleError('insufficient_resources', 'Not enough resources to build a settlement')
      }
      if (!isLegalSettlementPlacement(shadow, command.seatId, command.intersectionId, false)) {
        throw new RuleError('illegal_settlement', 'Settlement placement is not legal')
      }

      push({
        type: 'SettlementBuilt',
        seatId: command.seatId,
        intersectionId: command.intersectionId,
        setup: false,
        timestamp,
      })
      maybeUpdateLongestRoad(shadow, timestamp, push)
      maybeWinGame(shadow, command.seatId, timestamp, push)
      return events
    }

    case 'BuildCity': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const seat = requireOccupiedSeat(shadow, command.seatId)
      if (seat.citiesRemaining <= 0) {
        throw new RuleError('no_pieces_remaining', 'No cities remaining')
      }
      if (!hasHand(seat.resources, buildCosts.city)) {
        throw new RuleError('insufficient_resources', 'Not enough resources to build a city')
      }
      if (!isLegalCityPlacement(shadow, command.seatId, command.intersectionId)) {
        throw new RuleError('illegal_city', 'City placement is not legal')
      }

      push({
        type: 'CityBuilt',
        seatId: command.seatId,
        intersectionId: command.intersectionId,
        timestamp,
      })
      maybeWinGame(shadow, command.seatId, timestamp, push)
      return events
    }

    case 'BuyDevelopmentCard': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const seat = requireOccupiedSeat(shadow, command.seatId)
      if (!hasHand(seat.resources, buildCosts.developmentCard)) {
        throw new RuleError('insufficient_resources', 'Not enough resources to buy a development card')
      }
      const cardType = shadow.devDeck[0]
      if (!cardType) {
        throw new RuleError('deck_empty', 'No development cards remain')
      }

      push({
        type: 'DevelopmentCardPurchased',
        seatId: command.seatId,
        cardId: makeId('dev'),
        cardType,
        turnNumber: game.turn.turnNumber,
        timestamp,
      })
      maybeWinGame(shadow, command.seatId, timestamp, push)
      return events
    }

    case 'PlayKnight': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const card = requirePlayableDevCard(shadow, command.seatId, command.cardId, 'knight', game.turn)
      const board = requireBoard(shadow)
      if (!board.hexes[command.hexId]) {
        throw new RuleError('invalid_hex', 'Unknown hex')
      }
      if (board.robberHexId === command.hexId) {
        throw new RuleError('same_hex', 'Robber must move to a different hex')
      }

      push({
        type: 'DevelopmentCardPlayed',
        seatId: command.seatId,
        cardId: card.id,
        cardType: 'knight',
        timestamp,
      })
      maybeUpdateLargestArmy(shadow, timestamp, push)
      push({
        type: 'RobberMoved',
        seatId: command.seatId,
        hexId: command.hexId,
        source: 'knight',
        timestamp,
      })

      const eligibleVictimSeatIds = robberVictims(shadow, command.hexId, command.seatId)
      if (eligibleVictimSeatIds.length > 0) {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_robber_steal',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            robberHexId: command.hexId,
            eligibleVictimSeatIds,
            source: 'knight',
            devCardPlayed: true,
          },
          timestamp,
        })
      } else {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'main_turn',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            devCardPlayed: true,
          },
          timestamp,
        })
      }
      maybeWinGame(shadow, command.seatId, timestamp, push)
      return events
    }

    case 'PlayRoadBuilding': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      requirePlayableDevCard(shadow, command.seatId, command.cardId, 'road_building', game.turn)

      push({
        type: 'DevelopmentCardPlayed',
        seatId: command.seatId,
        cardId: command.cardId,
        cardType: 'road_building',
        timestamp,
      })
      const roadsAvailable = listLegalRoadEdges(shadow, command.seatId)
      if (roadsAvailable.length === 0) {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'main_turn',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            devCardPlayed: true,
          },
          timestamp,
        })
      } else {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'resolving_road_building',
            seatId: command.seatId,
            turnNumber: game.turn.turnNumber,
            roadsLeftToPlace: roadsAvailable.length === 1 ? 1 : 2,
            devCardPlayed: true,
          },
          timestamp,
        })
      }
      return events
    }

    case 'PlayYearOfPlenty': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      requirePlayableDevCard(shadow, command.seatId, command.cardId, 'year_of_plenty', game.turn)
      const bank = requireBank(shadow)
      const requestedCounts = command.resources.reduce<Record<Resource, number>>((counts, resource) => {
        counts[resource] += 1
        return counts
      }, {
        wood: 0,
        brick: 0,
        sheep: 0,
        wheat: 0,
        ore: 0,
      })
      if (resources.some((resource) => bank.resources[resource] < requestedCounts[resource])) {
        throw new RuleError('bank_insufficient', 'The bank cannot satisfy Year of Plenty')
      }

      push({
        type: 'DevelopmentCardPlayed',
        seatId: command.seatId,
        cardId: command.cardId,
        cardType: 'year_of_plenty',
        timestamp,
      })
      push({
        type: 'YearOfPlentyResolved',
        seatId: command.seatId,
        resources: command.resources,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: true,
        },
        timestamp,
      })
      return events
    }

    case 'PlayMonopoly': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      requirePlayableDevCard(shadow, command.seatId, command.cardId, 'monopoly', game.turn)

      const collected = shadow.seats
        .filter((seat) => seat.seatId !== command.seatId && seat.userId !== null)
        .map((seat) => ({
          fromSeatId: seat.seatId,
          amount: seat.resources[command.resource],
        }))
        .filter((entry) => entry.amount > 0)

      push({
        type: 'DevelopmentCardPlayed',
        seatId: command.seatId,
        cardId: command.cardId,
        cardType: 'monopoly',
        timestamp,
      })
      push({
        type: 'MonopolyResolved',
        seatId: command.seatId,
        resource: command.resource,
        collected,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: true,
        },
        timestamp,
      })
      return events
    }

    case 'TradeWithBank': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      if (command.give === command.receive) {
        throw new RuleError('invalid_trade', 'Trade resources must differ')
      }
      const bank = requireBank(shadow)
      const seat = requireOccupiedSeat(shadow, command.seatId)
      const ratio = bankTradeRatio(shadow, command.seatId, command.give)
      if (seat.resources[command.give] < ratio) {
        throw new RuleError('insufficient_resources', 'Not enough cards for bank trade')
      }
      if (bank.resources[command.receive] <= 0) {
        throw new RuleError('bank_insufficient', 'Bank has no matching resource card')
      }

      push({
        type: 'BankTradeCompleted',
        seatId: command.seatId,
        give: command.give,
        ratio,
        receive: command.receive,
        timestamp,
      })
      return events
    }

    case 'OfferTrade': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const seat = requireOccupiedSeat(shadow, command.seatId)
      if (shadow.trade) {
        throw new RuleError('trade_exists', 'A trade is already in progress')
      }
      if (command.targetSeatIds.length === 0) {
        throw new RuleError('invalid_trade', 'Trade must target at least one player')
      }
      if (!hasHand(seat.resources, command.offered)) {
        throw new RuleError('insufficient_resources', 'Cannot offer resources you do not have')
      }
      const uniqueTargets = Array.from(new Set(command.targetSeatIds))
      for (const targetSeatId of uniqueTargets) {
        const targetSeat = requireOccupiedSeat(shadow, targetSeatId)
        if (targetSeat.seatId === command.seatId) {
          throw new RuleError('invalid_trade', 'Cannot trade with yourself')
        }
      }

      const offer: TradeOfferState = {
        offerId: makeId('trade'),
        fromSeatId: command.seatId,
        targetSeatIds: uniqueTargets,
        offered: cloneHand(command.offered),
        requested: cloneHand(command.requested),
        acceptedSeatIds: [],
        declinedSeatIds: [],
      }
      push({
        type: 'TradeOffered',
        offer,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'await_trade_responses',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          offerId: offer.offerId,
          pendingSeatIds: uniqueTargets,
          devCardPlayed: game.turn.devCardPlayed,
        },
        timestamp,
      })
      return events
    }

    case 'RespondToTrade': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_trade_responses')
      const trade = shadow.trade
      if (!trade || trade.offerId !== command.offerId) {
        throw new RuleError('trade_not_found', 'Trade not found')
      }
      if (!game.turn.pendingSeatIds.includes(command.seatId)) {
        throw new RuleError('invalid_actor', 'Seat is not awaiting response')
      }
      if (command.accepted) {
        const seat = requireOccupiedSeat(shadow, command.seatId)
        if (!hasHand(seat.resources, trade.requested)) {
          throw new RuleError('insufficient_resources', 'Target seat no longer has requested resources')
        }
      }

      push({
        type: 'TradeResponseRecorded',
        seatId: command.seatId,
        offerId: command.offerId,
        accepted: command.accepted,
        timestamp,
      })

      const remaining = game.turn.pendingSeatIds.filter((seatId) => seatId !== command.seatId)
      const acceptedAfter = trade.acceptedSeatIds.concat(command.accepted ? [command.seatId] : [])
      if (remaining.length === 0 && acceptedAfter.length === 0) {
        push({
          type: 'TradeCanceled',
          offerId: command.offerId,
          timestamp,
        })
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'main_turn',
            seatId: game.turn.seatId,
            turnNumber: game.turn.turnNumber,
            devCardPlayed: game.turn.devCardPlayed,
          },
          timestamp,
        })
      } else {
        push({
          type: 'TurnStateChanged',
          turn: {
            type: 'await_trade_responses',
            seatId: game.turn.seatId,
            turnNumber: game.turn.turnNumber,
            offerId: command.offerId,
            pendingSeatIds: remaining,
            devCardPlayed: game.turn.devCardPlayed,
          },
          timestamp,
        })
      }
      return events
    }

    case 'FinalizeTrade': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_trade_responses')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const trade = shadow.trade
      if (!trade || trade.offerId !== command.offerId) {
        throw new RuleError('trade_not_found', 'Trade not found')
      }
      if (!trade.acceptedSeatIds.includes(command.targetSeatId)) {
        throw new RuleError('invalid_trade', 'Target seat did not accept')
      }
      const fromSeat = requireOccupiedSeat(shadow, command.seatId)
      const targetSeat = requireOccupiedSeat(shadow, command.targetSeatId)
      if (!hasHand(fromSeat.resources, trade.offered) || !hasHand(targetSeat.resources, trade.requested)) {
        throw new RuleError('insufficient_resources', 'Trade participants no longer hold required resources')
      }

      push({
        type: 'TradeCompleted',
        offerId: command.offerId,
        fromSeatId: command.seatId,
        toSeatId: command.targetSeatId,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: game.turn.devCardPlayed,
        },
        timestamp,
      })
      return events
    }

    case 'CancelTrade': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'await_trade_responses')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const trade = shadow.trade
      if (!trade || trade.offerId !== command.offerId) {
        throw new RuleError('trade_not_found', 'Trade not found')
      }
      push({
        type: 'TradeCanceled',
        offerId: command.offerId,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'main_turn',
          seatId: command.seatId,
          turnNumber: game.turn.turnNumber,
          devCardPlayed: game.turn.devCardPlayed,
        },
        timestamp,
      })
      return events
    }

    case 'EndTurn': {
      requireStatus(game, 'in_progress')
      requireTurnType(game.turn, 'main_turn')
      assertActiveSeat(game.turn.seatId, command.seatId)
      const nextIndex = (shadow.turnIndex + 1) % shadow.turnOrder.length
      const nextSeatId = shadow.turnOrder[nextIndex]
      if (!nextSeatId) {
        throw new Error('Missing next seat')
      }
      const nextTurnNumber = game.turn.turnNumber + 1
      push({
        type: 'TurnEnded',
        nextSeatId,
        turnNumber: nextTurnNumber,
        timestamp,
      })
      push({
        type: 'TurnStateChanged',
        turn: {
          type: 'await_roll',
          seatId: nextSeatId,
          turnNumber: nextTurnNumber,
          devCardPlayed: false,
        },
        timestamp,
      })
      return events
    }
  }
}

export function applyEvents(game: GameAggregate, events: readonly GameEvent[]): GameAggregate {
  return events.reduce((current, event) => applyEvent(current, event), game)
}

export function applyEvent(game: GameAggregate, event: GameEvent): GameAggregate {
  const next = structuredClone(game)
  next.version += 1

  switch (event.type) {
    case 'LobbyCreated':
      next.ownerSeatId = event.ownerSeatId
      return next

    case 'SeatJoined': {
      const seat = requireSeat(next, event.seatId)
      seat.userId = event.userId
      seat.displayName = event.displayName
      seat.isConnected = true
      seat.isReady = false
      return next
    }

    case 'SeatLeft': {
      const seat = requireSeat(next, event.seatId)
      seat.userId = null
      seat.displayName = `Player ${event.seatId.slice(1)}`
      seat.isConnected = false
      seat.isReady = false
      seat.resources = emptyHand()
      seat.devCards = []
      seat.playedKnights = 0
      seat.roadsRemaining = 15
      seat.settlementsRemaining = 5
      seat.citiesRemaining = 4
      if (next.ownerSeatId === event.seatId) {
        next.ownerSeatId = occupiedSeats(next)[0]?.seatId ?? null
      }
      return next
    }

    case 'SeatReadySet':
      requireSeat(next, event.seatId).isReady = event.ready
      return next

    case 'PlayerConnected':
      requireSeat(next, event.seatId).isConnected = event.connected
      return next

    case 'GameStarted':
      next.status = 'in_progress'
      next.startedAt = event.timestamp
      next.board = event.board
      next.bank = {
        resources: handFrom({
          wood: 19,
          brick: 19,
          sheep: 19,
          wheat: 19,
          ore: 19,
        }),
      }
      next.devDeck = [...event.devDeck]
      next.turnOrder = [...event.turnOrder]
      next.turnIndex = event.turnOrder.indexOf(event.firstSeatId)
      next.turnNumber = 1
      next.setup = { settlementPlacements: {} }
      next.turn = {
        type: 'setup_place_settlement',
        seatId: event.firstSeatId,
        round: 1,
      }
      next.lastRoll = null
      return next

    case 'SetupSettlementPlaced': {
      const board = requireBoard(next)
      const seat = requireSeat(next, event.seatId)
      const intersection = board.intersections[event.intersectionId]
      if (!intersection) {
        throw new Error('Unknown intersection')
      }
      intersection.ownerSeatId = event.seatId
      intersection.building = 'settlement'
      seat.settlementsRemaining -= 1
      if (next.setup) {
        next.setup.settlementPlacements[event.seatId] ??= []
        next.setup.settlementPlacements[event.seatId]!.push(event.intersectionId)
      }
      return next
    }

    case 'SetupRoadPlaced': {
      const board = requireBoard(next)
      const seat = requireSeat(next, event.seatId)
      board.edges[event.edgeId]!.ownerSeatId = event.seatId
      seat.roadsRemaining -= 1
      return next
    }

    case 'InitialResourcesGranted': {
      const bank = requireBank(next)
      const seat = requireSeat(next, event.seatId)
      addHand(seat.resources, event.resources)
      subtractHand(bank.resources, event.resources)
      return next
    }

    case 'TurnStateChanged':
      next.turn = event.turn
      return next

    case 'TurnStarted':
      next.turnIndex = next.turnOrder.indexOf(event.seatId)
      next.turnNumber = event.turnNumber
      next.lastRoll = null
      next.trade = null
      return next

    case 'DiceRolled':
      next.lastRoll = {
        die1: event.die1,
        die2: event.die2,
        total: event.total,
      }
      return next

    case 'ResourcesProduced': {
      const bank = requireBank(next)
      for (const payout of event.payouts) {
        requireSeat(next, payout.seatId).resources[payout.resource] += payout.amount
        bank.resources[payout.resource] -= payout.amount
      }
      return next
    }

    case 'CardsDiscarded': {
      const bank = requireBank(next)
      const seat = requireSeat(next, event.seatId)
      subtractHand(seat.resources, event.cards)
      addHand(bank.resources, event.cards)
      return next
    }

    case 'RobberMoved':
      requireBoard(next).robberHexId = event.hexId
      return next

    case 'ResourceStolen': {
      const fromSeat = requireSeat(next, event.fromSeatId)
      const toSeat = requireSeat(next, event.toSeatId)
      fromSeat.resources[event.resource] -= 1
      toSeat.resources[event.resource] += 1
      return next
    }

    case 'RoadBuilt': {
      const board = requireBoard(next)
      const seat = requireSeat(next, event.seatId)
      board.edges[event.edgeId]!.ownerSeatId = event.seatId
      seat.roadsRemaining -= 1
      if (!event.free) {
        subtractHand(seat.resources, buildCosts.road)
        addHand(requireBank(next).resources, buildCosts.road)
      }
      return next
    }

    case 'SettlementBuilt': {
      const board = requireBoard(next)
      const seat = requireSeat(next, event.seatId)
      const intersection = board.intersections[event.intersectionId]!
      intersection.ownerSeatId = event.seatId
      intersection.building = 'settlement'
      seat.settlementsRemaining -= 1
      if (!event.setup) {
        subtractHand(seat.resources, buildCosts.settlement)
        addHand(requireBank(next).resources, buildCosts.settlement)
      }
      return next
    }

    case 'CityBuilt': {
      const board = requireBoard(next)
      const seat = requireSeat(next, event.seatId)
      const intersection = board.intersections[event.intersectionId]!
      intersection.building = 'city'
      seat.citiesRemaining -= 1
      seat.settlementsRemaining += 1
      subtractHand(seat.resources, buildCosts.city)
      addHand(requireBank(next).resources, buildCosts.city)
      return next
    }

    case 'DevelopmentCardPurchased': {
      const seat = requireSeat(next, event.seatId)
      const topCard = next.devDeck.shift()
      if (topCard !== event.cardType) {
        throw new Error('Development deck mismatch')
      }
      subtractHand(seat.resources, buildCosts.developmentCard)
      addHand(requireBank(next).resources, buildCosts.developmentCard)
      seat.devCards.push({
        id: event.cardId,
        type: event.cardType,
        purchasedOnTurn: event.turnNumber,
        revealed: false,
        played: false,
      })
      return next
    }

    case 'DevelopmentCardPlayed': {
      const seat = requireSeat(next, event.seatId)
      const card = seat.devCards.find((candidate) => candidate.id === event.cardId)
      if (!card) {
        throw new Error('Development card not found')
      }
      card.played = true
      card.revealed = true
      if (event.cardType === 'knight') {
        seat.playedKnights += 1
      }
      return next
    }

    case 'YearOfPlentyResolved': {
      const bank = requireBank(next)
      const seat = requireSeat(next, event.seatId)
      for (const resource of event.resources) {
        seat.resources[resource] += 1
        bank.resources[resource] -= 1
      }
      return next
    }

    case 'MonopolyResolved': {
      const seat = requireSeat(next, event.seatId)
      let total = 0
      for (const entry of event.collected) {
        requireSeat(next, entry.fromSeatId).resources[event.resource] -= entry.amount
        total += entry.amount
      }
      seat.resources[event.resource] += total
      return next
    }

    case 'BankTradeCompleted': {
      const bank = requireBank(next)
      const seat = requireSeat(next, event.seatId)
      seat.resources[event.give] -= event.ratio
      bank.resources[event.give] += event.ratio
      bank.resources[event.receive] -= 1
      seat.resources[event.receive] += 1
      return next
    }

    case 'TradeOffered':
      next.trade = structuredClone(event.offer)
      return next

    case 'TradeResponseRecorded': {
      if (!next.trade || next.trade.offerId !== event.offerId) {
        throw new Error('Trade missing')
      }
      next.trade.targetSeatIds = next.trade.targetSeatIds.filter((seatId) => seatId !== event.seatId)
      if (event.accepted) {
        next.trade.acceptedSeatIds.push(event.seatId)
      } else {
        next.trade.declinedSeatIds.push(event.seatId)
      }
      return next
    }

    case 'TradeCompleted': {
      if (!next.trade || next.trade.offerId !== event.offerId) {
        throw new Error('Trade missing')
      }
      const fromSeat = requireSeat(next, event.fromSeatId)
      const toSeat = requireSeat(next, event.toSeatId)
      subtractHand(fromSeat.resources, next.trade.offered)
      addHand(toSeat.resources, next.trade.offered)
      subtractHand(toSeat.resources, next.trade.requested)
      addHand(fromSeat.resources, next.trade.requested)
      next.trade = null
      return next
    }

    case 'TradeCanceled':
      next.trade = null
      return next

    case 'LongestRoadUpdated':
      next.awards.longestRoadSeatId = event.seatId
      next.awards.longestRoadLength = event.length
      return next

    case 'LargestArmyUpdated':
      next.awards.largestArmySeatId = event.seatId
      next.awards.largestArmySize = event.size
      return next

    case 'TurnEnded':
      next.turnIndex = next.turnOrder.indexOf(event.nextSeatId)
      next.turnNumber = event.turnNumber
      next.lastRoll = null
      next.trade = null
      return next

    case 'GameWon':
      next.status = 'finished'
      next.finishedAt = event.timestamp
      next.winnerSeatId = event.seatId
      next.turn = { type: 'finished', winnerSeatId: event.seatId }
      return next
  }
}

function generateStartState(game: GameAggregate, random: RandomSource): GeneratedStart {
  const turnOrder = shuffle(
    random,
    occupiedSeats(game).map((seat) => seat.seatId),
  )
  const firstSeatId = turnOrder[0]
  if (!firstSeatId) {
    throw new Error('Missing first seat')
  }
  const board = generateBoardState(random)
  const devDeck = shuffle(random, DEV_DECK_POOL)
  return { board, devDeck, turnOrder, firstSeatId }
}

function generateBoardState(random: RandomSource): BoardState {
  const topology = BASE_4P_TOPOLOGY
  const terrainOrder = shuffle(random, TERRAIN_POOL)
  const hexIds = Object.keys(topology.hexes)
  const terrainByHexId = new Map<string, Terrain>()
  let robberHexId = ''

  for (const [index, hexId] of hexIds.entries()) {
    const terrain = terrainOrder[index]!
    terrainByHexId.set(hexId, terrain)
    if (terrain === 'desert') {
      robberHexId = hexId
    }
  }

  if (!robberHexId) {
    throw new Error('Unable to place desert')
  }

  const nonDesertHexIds = hexIds.filter((hexId) => terrainByHexId.get(hexId) !== 'desert')
  const assignedNumbers = assignNumberTokens(nonDesertHexIds, shuffle(random, NUMBER_POOL), {})

  if (!assignedNumbers) {
    throw new Error('Unable to generate a valid board')
  }

  const boardHexes: BoardState['hexes'] = {}
  for (const hexId of hexIds) {
    const terrain = terrainByHexId.get(hexId)!
    boardHexes[hexId] = {
      hexId,
      terrain,
      numberToken: terrain === 'desert' ? null : assignedNumbers[hexId] ?? null,
    }
  }

  const ports: BoardState['ports'] = {}
  const shuffledPorts = shuffle(random, PORT_POOL)
  for (const [index, portId] of topology.orderedPortIds.entries()) {
    const topoPort = topology.ports[portId]!
    ports[portId] = {
      portId,
      type: shuffledPorts[index]!,
      edgeId: topoPort.edgeId,
      intersectionIds: topoPort.intersectionIds,
    }
  }

  const intersections: Record<string, IntersectionState> = {}
  for (const intersectionId of Object.keys(topology.intersections)) {
    intersections[intersectionId] = {
      ownerSeatId: null,
      building: 'none',
    }
  }

  const edges: Record<string, EdgeState> = {}
  for (const edgeId of Object.keys(topology.edges)) {
    edges[edgeId] = {
      ownerSeatId: null,
    }
  }

  return {
    hexes: boardHexes,
    intersections,
    edges,
    ports,
    robberHexId,
  }
}

function assignNumberTokens(
  hexIds: readonly string[],
  remainingNumbers: readonly number[],
  assigned: Record<string, number>,
): Record<string, number> | null {
  if (hexIds.length === 0) {
    return assigned
  }

  const [hexId, ...restHexIds] = hexIds
  if (!hexId) {
    return assigned
  }

  const tried = new Set<number>()
  for (let index = 0; index < remainingNumbers.length; index += 1) {
    const number = remainingNumbers[index]!
    if (tried.has(number)) {
      continue
    }
    tried.add(number)
    if ((number === 6 || number === 8) && hasHotNeighbor(hexId, assigned)) {
      continue
    }
    const nextAssigned = {
      ...assigned,
      [hexId]: number,
    }
    const nextRemaining = [...remainingNumbers.slice(0, index), ...remainingNumbers.slice(index + 1)]
    const result = assignNumberTokens(restHexIds, nextRemaining, nextAssigned)
    if (result) {
      return result
    }
  }

  return null
}

function hasHotNeighbor(hexId: string, assigned: Record<string, number>): boolean {
  return BASE_4P_TOPOLOGY.hexes[hexId]!.adjacentHexIds.some((adjacentHexId) => {
    const token = assigned[adjacentHexId]
    return token === 6 || token === 8
  })
}

function computeNextSetupTurn(
  game: GameAggregate,
  currentSeatId: string,
  round: 1 | 2,
): TurnState | null {
  const orderIndex = game.turnOrder.indexOf(currentSeatId)
  if (round === 1) {
    if (orderIndex === game.turnOrder.length - 1) {
      return {
        type: 'setup_place_settlement',
        seatId: currentSeatId,
        round: 2,
      }
    }
    return {
      type: 'setup_place_settlement',
      seatId: game.turnOrder[orderIndex + 1]!,
      round: 1,
    }
  }

  if (orderIndex === 0) {
    return null
  }

  return {
    type: 'setup_place_settlement',
    seatId: game.turnOrder[orderIndex - 1]!,
    round: 2,
  }
}

function computeStartingResources(game: GameAggregate, intersectionId: string): ResourceHand {
  const board = requireBoard(game)
  const hand = emptyHand()
  const adjacentHexIds = BASE_4P_TOPOLOGY.intersections[intersectionId]!.adjacentHexIds
  for (const hexId of adjacentHexIds) {
    const hex = board.hexes[hexId]
    if (!hex) {
      continue
    }
    const resource = resourceFromTerrain(hex.terrain)
    if (resource) {
      hand[resource] += 1
    }
  }
  return hand
}

function computeProductionPayouts(game: GameAggregate, total: number): Array<{ seatId: string; resource: Resource; amount: number }> {
  const board = requireBoard(game)
  const bank = requireBank(game)
  const pendingByResource = new Map<Resource, Map<string, number>>()

  for (const hex of Object.values(board.hexes)) {
    if (hex.numberToken !== total || board.robberHexId === hex.hexId) {
      continue
    }
    const resource = resourceFromTerrain(hex.terrain)
    if (!resource) {
      continue
    }
    const intersectionIds = BASE_4P_TOPOLOGY.hexes[hex.hexId]!.intersectionIds
    for (const intersectionId of intersectionIds) {
      const intersection = board.intersections[intersectionId]!
      if (!intersection.ownerSeatId) {
        continue
      }
      const amount = intersection.building === 'city' ? 2 : 1
      const current = pendingByResource.get(resource) ?? new Map<string, number>()
      current.set(
        intersection.ownerSeatId,
        (current.get(intersection.ownerSeatId) ?? 0) + amount,
      )
      pendingByResource.set(resource, current)
    }
  }

  const payouts: Array<{ seatId: string; resource: Resource; amount: number }> = []
  for (const resource of resources) {
    const seatAmounts = pendingByResource.get(resource)
    if (!seatAmounts) {
      continue
    }
    const totalRequested = Array.from(seatAmounts.values()).reduce((sum, amount) => sum + amount, 0)
    if (bank.resources[resource] < totalRequested) {
      continue
    }
    for (const [seatId, amount] of seatAmounts.entries()) {
      payouts.push({ seatId, resource, amount })
    }
  }
  return payouts
}

function validateSetupSettlement(board: BoardState, intersectionId: string): void {
  const intersection = board.intersections[intersectionId]
  if (!intersection) {
    throw new RuleError('invalid_intersection', 'Unknown intersection')
  }
  if (intersection.building !== 'none') {
    throw new RuleError('intersection_occupied', 'Intersection already occupied')
  }
  const topology = BASE_4P_TOPOLOGY.intersections[intersectionId]!
  if (topology.adjacentIntersectionIds.some((candidateId) => board.intersections[candidateId]!.building !== 'none')) {
    throw new RuleError('intersection_too_close', 'Adjacent intersection is occupied')
  }
}

function validateSetupRoad(board: BoardState, originIntersectionId: string, edgeId: string): void {
  const edge = board.edges[edgeId]
  if (!edge) {
    throw new RuleError('invalid_edge', 'Unknown edge')
  }
  if (edge.ownerSeatId) {
    throw new RuleError('edge_occupied', 'Edge already contains a road')
  }
  const endpoints = BASE_4P_TOPOLOGY.edges[edgeId]!.intersectionIds
  if (!endpoints.includes(originIntersectionId)) {
    throw new RuleError('illegal_road', 'Setup road must touch the new settlement')
  }
}

function isLegalSettlementPlacement(
  game: GameAggregate,
  seatId: string,
  intersectionId: string,
  setup: boolean,
): boolean {
  const board = requireBoard(game)
  const intersection = board.intersections[intersectionId]
  if (!intersection || intersection.building !== 'none') {
    return false
  }
  const topology = BASE_4P_TOPOLOGY.intersections[intersectionId]
  if (!topology) {
    return false
  }
  if (topology.adjacentIntersectionIds.some((candidateId) => board.intersections[candidateId]!.building !== 'none')) {
    return false
  }
  if (setup) {
    return true
  }
  return topology.adjacentEdgeIds.some((edgeId) => board.edges[edgeId]!.ownerSeatId === seatId)
}

function isLegalCityPlacement(game: GameAggregate, seatId: string, intersectionId: string): boolean {
  const intersection = requireBoard(game).intersections[intersectionId]
  return Boolean(intersection && intersection.ownerSeatId === seatId && intersection.building === 'settlement')
}

function isLegalRoadPlacement(game: GameAggregate, seatId: string, edgeId: string): boolean {
  const board = requireBoard(game)
  const edge = board.edges[edgeId]
  if (!edge || edge.ownerSeatId) {
    return false
  }
  const topologyEdge = BASE_4P_TOPOLOGY.edges[edgeId]
  if (!topologyEdge) {
    return false
  }

  return topologyEdge.intersectionIds.some((intersectionId) => {
    const intersection = board.intersections[intersectionId]!
    if (intersection.ownerSeatId && intersection.ownerSeatId !== seatId) {
      return false
    }
    if (intersection.ownerSeatId === seatId) {
      return true
    }
    return BASE_4P_TOPOLOGY.intersections[intersectionId]!.adjacentEdgeIds.some((adjacentEdgeId) => {
      if (adjacentEdgeId === edgeId) {
        return false
      }
      return board.edges[adjacentEdgeId]!.ownerSeatId === seatId
    })
  })
}

function listLegalRoadEdges(game: GameAggregate, seatId: string): string[] {
  const board = requireBoard(game)
  return Object.keys(board.edges).filter((edgeId) => isLegalRoadPlacement(game, seatId, edgeId))
}

function robberVictims(game: GameAggregate, robberHexId: string, activeSeatId: string): string[] {
  const board = requireBoard(game)
  const result = new Set<string>()
  for (const intersectionId of BASE_4P_TOPOLOGY.hexes[robberHexId]!.intersectionIds) {
    const intersection = board.intersections[intersectionId]!
    if (
      intersection.ownerSeatId &&
      intersection.ownerSeatId !== activeSeatId &&
      totalCards(requireSeat(game, intersection.ownerSeatId).resources) > 0
    ) {
      result.add(intersection.ownerSeatId)
    }
  }
  return [...result]
}

function randomResourceFromHand(random: RandomSource, hand: ResourceHand): Resource | null {
  const bag: Resource[] = []
  for (const resource of resources) {
    for (let count = 0; count < hand[resource]; count += 1) {
      bag.push(resource)
    }
  }
  return bag.length === 0 ? null : sample(random, bag)
}

function requirePlayableDevCard(
  game: GameAggregate,
  seatId: string,
  cardId: string,
  expectedType: DevCardType,
  turn: Extract<TurnState, { type: 'main_turn' }>,
): DevCardInstance {
  if (turn.devCardPlayed) {
    throw new RuleError('dev_card_already_played', 'Only one development card can be played per turn')
  }
  const seat = requireOccupiedSeat(game, seatId)
  const card = seat.devCards.find((candidate) => candidate.id === cardId)
  if (!card) {
    throw new RuleError('card_not_found', 'Development card not found')
  }
  if (card.type !== expectedType) {
    throw new RuleError('wrong_card_type', 'Selected development card has the wrong type')
  }
  if (card.played) {
    throw new RuleError('card_already_played', 'Development card already played')
  }
  if (card.purchasedOnTurn === turn.turnNumber) {
    throw new RuleError('card_too_new', 'Cannot play a development card on the turn it was purchased')
  }
  return card
}

function bankTradeRatio(game: GameAggregate, seatId: string, give: Resource): number {
  const board = requireBoard(game)
  let ratio = 4
  for (const port of Object.values(board.ports)) {
    const hasAccess = port.intersectionIds.some((intersectionId) => board.intersections[intersectionId]!.ownerSeatId === seatId)
    if (!hasAccess) {
      continue
    }
    if (port.type === give) {
      ratio = Math.min(ratio, 2)
    } else if (port.type === 'generic') {
      ratio = Math.min(ratio, 3)
    }
  }
  return ratio
}

function maybeUpdateLongestRoad(
  game: GameAggregate,
  timestamp: string,
  push: (event: GameEvent) => void,
): void {
  let bestSeatId: string | null = null
  let bestLength = 4

  for (const seat of occupiedSeats(game)) {
    const length = longestRoadLength(game, seat.seatId)
    if (length >= 5 && length > bestLength) {
      bestSeatId = seat.seatId
      bestLength = length
    } else if (length >= 5 && length === bestLength) {
      if (game.awards.longestRoadSeatId !== seat.seatId) {
        bestSeatId = game.awards.longestRoadSeatId
      }
    }
  }

  if (
    game.awards.longestRoadSeatId !== bestSeatId ||
    game.awards.longestRoadLength !== bestLength
  ) {
    push({
      type: 'LongestRoadUpdated',
      seatId: bestSeatId,
      length: bestLength,
      timestamp,
    })
  }
}

function maybeUpdateLargestArmy(
  game: GameAggregate,
  timestamp: string,
  push: (event: GameEvent) => void,
): void {
  let bestSeatId: string | null = null
  let bestSize = 2

  for (const seat of occupiedSeats(game)) {
    if (seat.playedKnights >= 3 && seat.playedKnights > bestSize) {
      bestSeatId = seat.seatId
      bestSize = seat.playedKnights
    } else if (seat.playedKnights >= 3 && seat.playedKnights === bestSize) {
      if (game.awards.largestArmySeatId !== seat.seatId) {
        bestSeatId = game.awards.largestArmySeatId
      }
    }
  }

  if (
    game.awards.largestArmySeatId !== bestSeatId ||
    game.awards.largestArmySize !== bestSize
  ) {
    push({
      type: 'LargestArmyUpdated',
      seatId: bestSeatId,
      size: bestSize,
      timestamp,
    })
  }
}

function maybeWinGame(
  game: GameAggregate,
  seatId: string,
  timestamp: string,
  push: (event: GameEvent) => void,
): void {
  if (game.status === 'finished') {
    return
  }
  if (victoryPoints(game, seatId) >= 10) {
    push({
      type: 'GameWon',
      seatId,
      timestamp,
    })
  }
}

function victoryPoints(game: GameAggregate, seatId: string): number {
  const board = requireBoard(game)
  const seat = requireSeat(game, seatId)
  let points = 0
  for (const intersection of Object.values(board.intersections)) {
    if (intersection.ownerSeatId !== seatId) {
      continue
    }
    points += intersection.building === 'city' ? 2 : 1
  }
  if (game.awards.longestRoadSeatId === seatId) {
    points += 2
  }
  if (game.awards.largestArmySeatId === seatId) {
    points += 2
  }
  points += seat.devCards.filter((card) => card.type === 'victory_point').length
  return points
}

function longestRoadLength(game: GameAggregate, seatId: string): number {
  const board = requireBoard(game)
  const playerEdges = Object.entries(board.edges)
    .filter(([, edge]) => edge.ownerSeatId === seatId)
    .map(([edgeId]) => edgeId)

  if (playerEdges.length === 0) {
    return 0
  }

  const adjacency = new Map<string, string[]>()
  for (const edgeId of playerEdges) {
    adjacency.set(edgeId, [])
  }

  for (const edgeId of playerEdges) {
    const endpoints = BASE_4P_TOPOLOGY.edges[edgeId]!.intersectionIds
    for (const intersectionId of endpoints) {
      const intersection = board.intersections[intersectionId]!
      if (intersection.ownerSeatId && intersection.ownerSeatId !== seatId) {
        continue
      }
      for (const adjacentEdgeId of BASE_4P_TOPOLOGY.intersections[intersectionId]!.adjacentEdgeIds) {
        if (adjacentEdgeId === edgeId || board.edges[adjacentEdgeId]!.ownerSeatId !== seatId) {
          continue
        }
        adjacency.get(edgeId)!.push(adjacentEdgeId)
      }
    }
  }

  let best = 0
  const visit = (edgeId: string, visited: Set<string>): number => {
    let localBest = visited.size
    for (const nextEdgeId of adjacency.get(edgeId) ?? []) {
      if (visited.has(nextEdgeId)) {
        continue
      }
      visited.add(nextEdgeId)
      localBest = Math.max(localBest, visit(nextEdgeId, visited))
      visited.delete(nextEdgeId)
    }
    return localBest
  }

  for (const edgeId of playerEdges) {
    const visited = new Set([edgeId])
    best = Math.max(best, visit(edgeId, visited))
  }
  return best
}

function occupiedSeats(game: GameAggregate): SeatState[] {
  return game.seats.filter((seat) => seat.userId !== null)
}

function requireStatus(game: GameAggregate, status: GameAggregate['status']): void {
  if (game.status !== status) {
    throw new RuleError('invalid_status', `Game must be ${status}`)
  }
}

function requireTurnType<TType extends TurnState['type']>(
  turn: TurnState,
  type: TType,
): asserts turn is Extract<TurnState, { type: TType }> {
  if (turn.type !== type) {
    throw new RuleError('invalid_phase', `Expected ${type}, got ${turn.type}`)
  }
}

function assertActiveSeat(expectedSeatId: string, actualSeatId: string): void {
  if (expectedSeatId !== actualSeatId) {
    throw new RuleError('not_your_turn', 'It is not this seat’s turn')
  }
}

function requireSeat(game: GameAggregate, seatId: string): SeatState {
  const seat = game.seats.find((candidate) => candidate.seatId === seatId)
  if (!seat) {
    throw new RuleError('seat_not_found', 'Seat not found')
  }
  return seat
}

function requireOccupiedSeat(game: GameAggregate, seatId: string): SeatState {
  const seat = requireSeat(game, seatId)
  if (!seat.userId) {
    throw new RuleError('seat_empty', 'Seat is empty')
  }
  return seat
}

function requireBoard(game: GameAggregate): BoardState {
  if (!game.board) {
    throw new RuleError('board_missing', 'Game board is not initialized')
  }
  return game.board
}

function requireBank(game: GameAggregate): BankState {
  if (!game.bank) {
    throw new RuleError('bank_missing', 'Bank is not initialized')
  }
  return game.bank
}
