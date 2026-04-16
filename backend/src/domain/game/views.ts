import type { GameAggregate, TurnState } from './types.js'
import { totalCards } from './resources.js'
import { BASE_4P_TOPOLOGY } from '../topology/base4p.js'

function visibleScoreForSeat(game: GameAggregate, seatId: string): number {
  const board = game.board
  if (!board) {
    return 0
  }

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
  return points
}

function totalScoreForSeat(game: GameAggregate, seatId: string): number {
  let points = visibleScoreForSeat(game, seatId)
  points += game.seats
    .find((seat) => seat.seatId === seatId)
    ?.devCards.filter((card) => card.type === 'victory_point').length ?? 0
  return points
}

function legalActions(game: GameAggregate, seatId: string): string[] {
  const seat = game.seats.find((candidate) => candidate.seatId === seatId)
  if (!seat?.userId) {
    return []
  }

  switch (game.turn.type) {
    case 'lobby':
      return game.ownerSeatId === seatId
        ? ['SetReady', 'LeaveLobby', 'StartGame']
        : ['SetReady', 'LeaveLobby']
    case 'setup_place_settlement':
      return game.turn.seatId === seatId ? ['PlaceSetupSettlement'] : []
    case 'setup_place_road':
      return game.turn.seatId === seatId ? ['PlaceSetupRoad'] : []
    case 'await_roll':
      return game.turn.seatId === seatId ? ['RollDice'] : []
    case 'await_discards':
      return game.turn.pendingSeatIds.includes(seatId) ? ['DiscardCards'] : []
    case 'await_robber_move':
      return game.turn.seatId === seatId ? ['MoveRobber'] : []
    case 'await_robber_steal':
      return game.turn.seatId === seatId ? ['StealRandomCard'] : []
    case 'resolving_road_building':
      return game.turn.seatId === seatId ? ['BuildRoad'] : []
    case 'await_trade_responses':
      if (game.turn.seatId === seatId) {
        return ['FinalizeTrade', 'CancelTrade']
      }
      return game.turn.pendingSeatIds.includes(seatId) ? ['RespondToTrade'] : []
    case 'main_turn':
      if (game.turn.seatId !== seatId) {
        return []
      }
      return [
        'BuildRoad',
        'BuildSettlement',
        'BuildCity',
        'BuyDevelopmentCard',
        'PlayKnight',
        'PlayRoadBuilding',
        'PlayYearOfPlenty',
        'PlayMonopoly',
        'TradeWithBank',
        'OfferTrade',
        'EndTurn',
      ]
    case 'resolving_year_of_plenty':
      return []
    case 'finished':
      return []
  }
}

function turnSummary(turn: TurnState): Record<string, unknown> {
  switch (turn.type) {
    case 'lobby':
      return { type: turn.type }
    case 'finished':
      return { type: turn.type, winnerSeatId: turn.winnerSeatId }
    case 'setup_place_settlement':
      return { type: turn.type, seatId: turn.seatId, round: turn.round }
    case 'setup_place_road':
      return { type: turn.type, seatId: turn.seatId, round: turn.round, originIntersectionId: turn.originIntersectionId }
    case 'await_roll':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber }
    case 'await_discards':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber, pendingSeatIds: turn.pendingSeatIds }
    case 'await_robber_move':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber, source: turn.source }
    case 'await_robber_steal':
      return {
        type: turn.type,
        seatId: turn.seatId,
        turnNumber: turn.turnNumber,
        robberHexId: turn.robberHexId,
        eligibleVictimSeatIds: turn.eligibleVictimSeatIds,
      }
    case 'main_turn':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber }
    case 'resolving_road_building':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber, roadsLeftToPlace: turn.roadsLeftToPlace }
    case 'resolving_year_of_plenty':
      return { type: turn.type, seatId: turn.seatId, turnNumber: turn.turnNumber, picksLeft: turn.picksLeft }
    case 'await_trade_responses':
      return {
        type: turn.type,
        seatId: turn.seatId,
        turnNumber: turn.turnNumber,
        offerId: turn.offerId,
        pendingSeatIds: turn.pendingSeatIds,
      }
  }
}

export function toPublicView(game: GameAggregate) {
  return {
    gameId: game.id,
    status: game.status,
    version: game.version,
    ownerSeatId: game.ownerSeatId,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    turn: turnSummary(game.turn),
    turnOrder: game.turnOrder,
    awards: game.awards,
    lastRoll: game.lastRoll,
    winnerSeatId: game.winnerSeatId,
    board: game.board
      ? {
          robberHexId: game.board.robberHexId,
          hexes: Object.values(game.board.hexes),
          intersections: game.board.intersections,
          edges: game.board.edges,
          ports: Object.values(game.board.ports),
          topology: {
            ports: BASE_4P_TOPOLOGY.ports,
          },
        }
      : null,
    seats: game.seats
      .filter((seat) => seat.userId !== null)
      .map((seat) => ({
        seatId: seat.seatId,
        displayName: seat.displayName,
        color: seat.color,
        isConnected: seat.isConnected,
        isReady: seat.isReady,
        resourceCardCount: totalCards(seat.resources),
        developmentCardCount: seat.devCards.filter((card) => !card.played).length,
        playedKnightCount: seat.playedKnights,
        roadsRemaining: seat.roadsRemaining,
        settlementsRemaining: seat.settlementsRemaining,
        citiesRemaining: seat.citiesRemaining,
        publicVictoryPoints: visibleScoreForSeat(game, seat.seatId),
      })),
    trade: game.trade
      ? {
          offerId: game.trade.offerId,
          fromSeatId: game.trade.fromSeatId,
          targetSeatIds: game.trade.targetSeatIds,
          offered: game.trade.offered,
          requested: game.trade.requested,
          acceptedSeatIds: game.trade.acceptedSeatIds,
          declinedSeatIds: game.trade.declinedSeatIds,
        }
      : null,
  }
}

export function toPrivateView(game: GameAggregate, seatId: string) {
  const seat = game.seats.find((candidate) => candidate.seatId === seatId)
  if (!seat?.userId) {
    return {
      ...toPublicView(game),
      me: null,
      legalActions: [],
    }
  }

  return {
    ...toPublicView(game),
    me: {
      seatId: seat.seatId,
      displayName: seat.displayName,
      color: seat.color,
      resources: seat.resources,
      devCards: seat.devCards,
      visibleVictoryPoints: visibleScoreForSeat(game, seat.seatId),
      score: totalScoreForSeat(game, seat.seatId),
    },
    legalActions: legalActions(game, seatId),
  }
}

export function filterHistoryEvents(game: GameAggregate, viewerSeatId: string | null, events: readonly unknown[]) {
  return events.map((event) => {
    if (!event || typeof event !== 'object' || !('type' in event)) {
      return event
    }

    const typedEvent = event as Record<string, unknown>
    if (typedEvent.type === 'DevelopmentCardPurchased' && typedEvent.seatId !== viewerSeatId) {
      return {
        ...typedEvent,
        cardId: null,
        cardType: 'unknown',
      }
    }

    if (
      typedEvent.type === 'ResourceStolen' &&
      typedEvent.fromSeatId !== viewerSeatId &&
      typedEvent.toSeatId !== viewerSeatId
    ) {
      return {
        ...typedEvent,
        resource: 'unknown',
      }
    }

    return typedEvent
  })
}
