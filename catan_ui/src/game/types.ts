export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore'
export type Terrain = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert'
export type PortType = 'generic' | Resource
export type Building = 'none' | 'settlement' | 'city'

export type ResourceHand = Record<Resource, number>

export interface SessionState {
  userId: string
  displayName: string
  accessToken: string
  reconnectToken: string
}

export type GuestAuthResponse = SessionState

export interface HexView {
  hexId: string
  terrain: Terrain
  numberToken: number | null
}

export interface IntersectionView {
  ownerSeatId: string | null
  building: Building
}

export interface EdgeView {
  ownerSeatId: string | null
}

export interface PortView {
  portId: string
  type: PortType
  edgeId: string
  intersectionIds: [string, string]
}

export interface SeatView {
  seatId: string
  displayName: string
  color: 'red' | 'blue' | 'white' | 'orange'
  isConnected: boolean
  isReady: boolean
  resourceCardCount: number
  developmentCardCount: number
  playedKnightCount: number
  roadsRemaining: number
  settlementsRemaining: number
  citiesRemaining: number
  publicVictoryPoints: number
}

export interface DevCardView {
  id: string
  type: 'knight' | 'victory_point' | 'road_building' | 'year_of_plenty' | 'monopoly'
  purchasedOnTurn: number
  revealed: boolean
  played: boolean
}

export type TurnView =
  | { type: 'lobby' }
  | { type: 'setup_place_settlement'; seatId: string; round: 1 | 2 }
  | { type: 'setup_place_road'; seatId: string; round: 1 | 2; originIntersectionId: string }
  | { type: 'await_roll'; seatId: string; turnNumber: number }
  | { type: 'await_discards'; seatId: string; turnNumber: number; pendingSeatIds: string[] }
  | { type: 'await_robber_move'; seatId: string; turnNumber: number; source: 'rolled_7' | 'knight' }
  | { type: 'await_robber_steal'; seatId: string; turnNumber: number; robberHexId: string; eligibleVictimSeatIds: string[] }
  | { type: 'main_turn'; seatId: string; turnNumber: number }
  | { type: 'resolving_road_building'; seatId: string; turnNumber: number; roadsLeftToPlace: 1 | 2 }
  | { type: 'resolving_year_of_plenty'; seatId: string; turnNumber: number; picksLeft: 1 | 2 }
  | { type: 'await_trade_responses'; seatId: string; turnNumber: number; offerId: string; pendingSeatIds: string[] }
  | { type: 'finished'; winnerSeatId: string }

export interface TradeView {
  offerId: string
  fromSeatId: string
  targetSeatIds: string[]
  offered: ResourceHand
  requested: ResourceHand
  acceptedSeatIds: string[]
  declinedSeatIds: string[]
}

export interface PrivateGameView {
  gameId: string
  status: 'lobby' | 'in_progress' | 'finished' | 'abandoned'
  version: number
  ownerSeatId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  turn: TurnView
  turnOrder: string[]
  awards: {
    longestRoadSeatId: string | null
    longestRoadLength: number
    largestArmySeatId: string | null
    largestArmySize: number
  }
  lastRoll: { die1: number; die2: number; total: number } | null
  winnerSeatId: string | null
  board: {
    robberHexId: string
    hexes: HexView[]
    intersections: Record<string, IntersectionView>
    edges: Record<string, EdgeView>
    ports: PortView[]
    topology: {
      ports: Record<string, { id: string; edgeId: string; intersectionIds: [string, string]; order: number }>
    }
  } | null
  seats: SeatView[]
  trade: TradeView | null
  me: {
    seatId: string
    displayName: string
    color: 'red' | 'blue' | 'white' | 'orange'
    resources: ResourceHand
    devCards: DevCardView[]
    visibleVictoryPoints: number
    score: number
  } | null
  legalActions: string[]
}

export interface CommandAcceptedResponse {
  type: 'command_accepted'
  events: unknown[]
  view: PrivateGameView
}

export interface BoardGeometry {
  width: number
  height: number
  hexes: Record<string, { x: number; y: number; q: number; r: number }>
  intersections: Record<string, { x: number; y: number }>
  edges: Record<string, {
    x1: number
    y1: number
    x2: number
    y2: number
    mx: number
    my: number
    angle: number
    intersectionIds: [string, string]
  }>
  ports: Record<string, { x: number; y: number; angle: number }>
}
