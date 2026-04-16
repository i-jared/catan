import type {
  DevCardType,
  PortType,
  Resource,
  ResourceHand,
  Terrain,
} from './resources.js'

export type Color = 'red' | 'blue' | 'white' | 'orange'

export interface HexState {
  hexId: string
  terrain: Terrain
  numberToken: number | null
}

export interface IntersectionState {
  ownerSeatId: string | null
  building: 'none' | 'settlement' | 'city'
}

export interface EdgeState {
  ownerSeatId: string | null
}

export interface PortState {
  portId: string
  type: PortType
  edgeId: string
  intersectionIds: [string, string]
}

export interface BoardState {
  hexes: Record<string, HexState>
  intersections: Record<string, IntersectionState>
  edges: Record<string, EdgeState>
  ports: Record<string, PortState>
  robberHexId: string
}

export interface DevCardInstance {
  id: string
  type: DevCardType
  purchasedOnTurn: number
  revealed: boolean
  played: boolean
}

export interface SeatState {
  seatId: string
  userId: string | null
  displayName: string
  color: Color
  isConnected: boolean
  isReady: boolean
  resources: ResourceHand
  devCards: DevCardInstance[]
  playedKnights: number
  roadsRemaining: number
  settlementsRemaining: number
  citiesRemaining: number
}

export interface BankState {
  resources: ResourceHand
}

export interface TradeOfferState {
  offerId: string
  fromSeatId: string
  targetSeatIds: string[]
  offered: ResourceHand
  requested: ResourceHand
  acceptedSeatIds: string[]
  declinedSeatIds: string[]
}

export interface AwardsState {
  longestRoadSeatId: string | null
  longestRoadLength: number
  largestArmySeatId: string | null
  largestArmySize: number
}

export type TurnState =
  | { type: 'lobby' }
  | { type: 'setup_place_settlement'; seatId: string; round: 1 | 2 }
  | { type: 'setup_place_road'; seatId: string; round: 1 | 2; originIntersectionId: string }
  | { type: 'await_roll'; seatId: string; turnNumber: number; devCardPlayed: boolean }
  | { type: 'await_discards'; seatId: string; turnNumber: number; pendingSeatIds: string[] }
  | { type: 'await_robber_move'; seatId: string; turnNumber: number; source: 'rolled_7' | 'knight'; devCardPlayed: boolean }
  | {
      type: 'await_robber_steal'
      seatId: string
      turnNumber: number
      robberHexId: string
      eligibleVictimSeatIds: string[]
      source: 'rolled_7' | 'knight'
      devCardPlayed: boolean
    }
  | { type: 'main_turn'; seatId: string; turnNumber: number; devCardPlayed: boolean }
  | { type: 'resolving_road_building'; seatId: string; turnNumber: number; roadsLeftToPlace: 1 | 2; devCardPlayed: boolean }
  | { type: 'resolving_year_of_plenty'; seatId: string; turnNumber: number; picksLeft: 1 | 2; selected: Resource[]; devCardPlayed: boolean }
  | { type: 'await_trade_responses'; seatId: string; turnNumber: number; offerId: string; pendingSeatIds: string[]; devCardPlayed: boolean }
  | { type: 'finished'; winnerSeatId: string }

export interface SetupState {
  settlementPlacements: Record<string, string[]>
}

export interface GameAggregate {
  id: string
  ruleset: 'base-4p'
  status: 'lobby' | 'in_progress' | 'finished' | 'abandoned'
  version: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  ownerSeatId: string | null
  seats: SeatState[]
  board: BoardState | null
  bank: BankState | null
  devDeck: DevCardType[]
  turn: TurnState
  awards: AwardsState
  trade: TradeOfferState | null
  turnOrder: string[]
  turnIndex: number
  turnNumber: number
  lastRoll: { die1: number; die2: number; total: number } | null
  setup: SetupState | null
  winnerSeatId: string | null
}

export type GameEvent =
  | { type: 'LobbyCreated'; ownerSeatId: string; timestamp: string }
  | { type: 'SeatJoined'; seatId: string; userId: string; displayName: string; timestamp: string }
  | { type: 'SeatLeft'; seatId: string; timestamp: string }
  | { type: 'SeatReadySet'; seatId: string; ready: boolean; timestamp: string }
  | { type: 'PlayerConnected'; seatId: string; connected: boolean; timestamp: string }
  | {
      type: 'GameStarted'
      timestamp: string
      board: BoardState
      devDeck: DevCardType[]
      turnOrder: string[]
      firstSeatId: string
    }
  | { type: 'SetupSettlementPlaced'; seatId: string; intersectionId: string; round: 1 | 2; timestamp: string }
  | { type: 'SetupRoadPlaced'; seatId: string; edgeId: string; round: 1 | 2; timestamp: string }
  | { type: 'InitialResourcesGranted'; seatId: string; resources: ResourceHand; timestamp: string }
  | { type: 'TurnStateChanged'; turn: TurnState; timestamp: string }
  | { type: 'TurnStarted'; seatId: string; turnNumber: number; timestamp: string }
  | { type: 'DiceRolled'; seatId: string; die1: number; die2: number; total: number; timestamp: string }
  | { type: 'ResourcesProduced'; payouts: Array<{ seatId: string; resource: Resource; amount: number }>; timestamp: string }
  | { type: 'CardsDiscarded'; seatId: string; cards: ResourceHand; timestamp: string }
  | { type: 'RobberMoved'; seatId: string; hexId: string; source: 'rolled_7' | 'knight'; timestamp: string }
  | { type: 'ResourceStolen'; fromSeatId: string; toSeatId: string; resource: Resource; timestamp: string }
  | { type: 'RoadBuilt'; seatId: string; edgeId: string; free: boolean; timestamp: string }
  | { type: 'SettlementBuilt'; seatId: string; intersectionId: string; setup: boolean; timestamp: string }
  | { type: 'CityBuilt'; seatId: string; intersectionId: string; timestamp: string }
  | { type: 'DevelopmentCardPurchased'; seatId: string; cardId: string; cardType: DevCardType; turnNumber: number; timestamp: string }
  | { type: 'DevelopmentCardPlayed'; seatId: string; cardId: string; cardType: DevCardType; timestamp: string }
  | { type: 'YearOfPlentyResolved'; seatId: string; resources: [Resource, Resource]; timestamp: string }
  | { type: 'MonopolyResolved'; seatId: string; resource: Resource; collected: Array<{ fromSeatId: string; amount: number }>; timestamp: string }
  | { type: 'BankTradeCompleted'; seatId: string; give: Resource; ratio: number; receive: Resource; timestamp: string }
  | { type: 'TradeOffered'; offer: TradeOfferState; timestamp: string }
  | { type: 'TradeResponseRecorded'; seatId: string; offerId: string; accepted: boolean; timestamp: string }
  | { type: 'TradeCompleted'; offerId: string; fromSeatId: string; toSeatId: string; timestamp: string }
  | { type: 'TradeCanceled'; offerId: string; timestamp: string }
  | { type: 'LongestRoadUpdated'; seatId: string | null; length: number; timestamp: string }
  | { type: 'LargestArmyUpdated'; seatId: string | null; size: number; timestamp: string }
  | { type: 'TurnEnded'; nextSeatId: string; turnNumber: number; timestamp: string }
  | { type: 'GameWon'; seatId: string; timestamp: string }

export type GameCommand =
  | { type: 'JoinLobby'; userId: string; displayName: string }
  | { type: 'LeaveLobby'; seatId: string }
  | { type: 'SetReady'; seatId: string; ready: boolean }
  | { type: 'StartGame'; seatId: string }
  | { type: 'PlaceSetupSettlement'; seatId: string; intersectionId: string }
  | { type: 'PlaceSetupRoad'; seatId: string; edgeId: string }
  | { type: 'RollDice'; seatId: string }
  | { type: 'DiscardCards'; seatId: string; cards: ResourceHand }
  | { type: 'MoveRobber'; seatId: string; hexId: string }
  | { type: 'StealRandomCard'; seatId: string; fromSeatId: string }
  | { type: 'BuildRoad'; seatId: string; edgeId: string }
  | { type: 'BuildSettlement'; seatId: string; intersectionId: string }
  | { type: 'BuildCity'; seatId: string; intersectionId: string }
  | { type: 'BuyDevelopmentCard'; seatId: string }
  | { type: 'PlayKnight'; seatId: string; cardId: string; hexId: string }
  | { type: 'PlayRoadBuilding'; seatId: string; cardId: string }
  | { type: 'PlayYearOfPlenty'; seatId: string; cardId: string; resources: [Resource, Resource] }
  | { type: 'PlayMonopoly'; seatId: string; cardId: string; resource: Resource }
  | { type: 'TradeWithBank'; seatId: string; give: Resource; receive: Resource }
  | { type: 'OfferTrade'; seatId: string; targetSeatIds: string[]; offered: ResourceHand; requested: ResourceHand }
  | { type: 'RespondToTrade'; seatId: string; offerId: string; accepted: boolean }
  | { type: 'FinalizeTrade'; seatId: string; offerId: string; targetSeatId: string }
  | { type: 'CancelTrade'; seatId: string; offerId: string }
  | { type: 'EndTurn'; seatId: string }
