// ============================================================================
// GAME TYPES
// ============================================================================

export type Resource = 'wood' | 'brick' | 'wheat' | 'sheep' | 'ore' | 'none';
export type HexType = 'desert' | 'forest' | 'hills' | 'fields' | 'pasture' | 'mountains' | 'ocean';
export type Building = 'none' | 'settlement' | 'city';
export type DevCardType = 'knight' | 'victory_point' | 'road_building' | 'year_of_plenty' | 'monopoly';
export type GamePhase = 'waiting_for_players' | 'setup' | 'setup_reverse' | 'rolling' | 'robber' | 'stealing' | 'main_turn' | 'trading' | 'finished';
export type PlayerType = 'human' | 'ai';
export type PortType = 'generic' | 'wood' | 'brick' | 'wheat' | 'sheep' | 'ore';

export interface ResourceHand {
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
}

export interface Player {
  id: number;
  name: string;
  type: PlayerType;
  resources?: ResourceHand;  // Only visible for own player
  devCardCount?: number;
  resourceCount?: number;
  knightsPlayed: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  victoryPoints: number;
  settlementsRemaining: number;
  citiesRemaining: number;
  roadsRemaining: number;
}

export interface HexInfo {
  q: number;
  r: number;
  type: HexType;
  numberToken: number;
  hasRobber: boolean;
}

export interface VertexInfo {
  hexQ: number;
  hexR: number;
  direction: number;
  building: Building;
  playerId: number;
}

export interface EdgeInfo {
  hexQ: number;
  hexR: number;
  direction: number;
  playerId: number;
}

export interface PortInfo {
  type: PortType;
  v1q: number;
  v1r: number;
  v1d: number;
  v2q: number;
  v2r: number;
  v2d: number;
}

export interface BoardLocation {
  hexQ: number;
  hexR: number;
  direction: number;
}

export interface LastRoll {
  die1: number;
  die2: number;
  total: number;
}

export interface GameState {
  gameId: string;
  phase: GamePhase;
  currentPlayer: number;
  playerCount: number;
  yourPlayerId: number;
  setupRound?: number;
  resources?: ResourceHand;
  devCards?: DevCardType[];
  settlementsRemaining?: number;
  citiesRemaining?: number;
  roadsRemaining?: number;
  lastRoll?: LastRoll;
  players?: Player[];
  hexes?: HexInfo[];
  vertices?: VertexInfo[];
  edges?: EdgeInfo[];
  ports?: PortInfo[];
  robberLocation?: { q: number; r: number };
  winner?: number;
  validSettlementLocations?: BoardLocation[];
  validRoadLocations?: BoardLocation[];
  validCityLocations?: BoardLocation[];
}

// ============================================================================
// AI STATE TYPES
// ============================================================================

export interface OtherPlayer {
  id: number;
  name: string;
  resourceCount: number;
  devCardCount: number;
  knightsPlayed: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  visibleVictoryPoints: number;
}

export interface AIGameState {
  playerId: number;
  playerName: string;
  resources: ResourceHand;
  devCards: DevCardType[];
  settlementsRemaining: number;
  citiesRemaining: number;
  roadsRemaining: number;
  knightsPlayed: number;
  phase: GamePhase;
  isMyTurn: boolean;
  lastRoll?: {
    die1: number;
    die2: number;
    total: number;
  };
  otherPlayers: OtherPlayer[];
  hexes: HexInfo[];
  buildings: VertexInfo[];
  roads: EdgeInfo[];
  availableTools: string[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface JoinGameResponse {
  token: string;
  playerId: number;
  playerName: string;
  playerType: PlayerType;
}

export interface StartGameResponse {
  success: boolean;
  message: string;
  currentPlayer: number;
  phase: string;
  currentPlayerIsAI: boolean;
  players: Array<{
    id: number;
    name: string;
    type: PlayerType;
  }>;
}

export interface EndTurnResponse {
  success: boolean;
  nextPlayer: number;
  nextPlayerName: string;
  nextPlayerIsAI: boolean;
  pendingAITurns?: boolean;
  nextHumanPlayerIndex?: number;
  nextHumanPlayerName?: string;
}

export interface AddAIResponse {
  success: boolean;
  addedCount: number;
  addedPlayerIds: number[];
  totalPlayers: number;
}

export interface RollDiceResponse {
  die1: number;
  die2: number;
  total: number;
  robber?: boolean;
  production?: Record<string, number>;
}

export interface AIToolResult {
  success: boolean;
  tool: string;
  [key: string]: unknown;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: object;
}

export interface PendingAITurnsInfo {
  currentPlayerIndex: number;
  currentPlayerIsAI: boolean;
  phase: string;
  currentAIPlayer?: {
    id: number;
    name: string;
  };
  nextHumanPlayerIndex?: number;
  nextHumanPlayerName?: string;
  humanCount: number;
  aiCount: number;
}

// ============================================================================
// CHAT AND TRADE TYPES
// ============================================================================

export type ChatMessageType = 'normal' | 'trade_proposal' | 'trade_accept' | 'trade_reject' | 'trade_counter' | 'system';

export interface ChatMessage {
  id: string;
  fromPlayerId: number;
  fromPlayerName: string;
  toPlayerId: number;  // -1 for public
  content: string;
  type: ChatMessageType;
  relatedTradeId?: number;
}

export interface TradeOffer {
  id: number;
  fromPlayerId: number;
  fromPlayerName: string;
  toPlayerId: number;  // -1 for open trade
  offering: ResourceHand;
  requesting: ResourceHand;
  isActive: boolean;
  acceptedBy?: number[];
  rejectedBy?: number[];
  message?: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

export interface ActiveTradesResponse {
  trades: TradeOffer[];
}

export interface ProposeTradeRequest {
  toPlayerId: number;
  giveWood: number;
  giveBrick: number;
  giveWheat: number;
  giveSheep: number;
  giveOre: number;
  wantWood: number;
  wantBrick: number;
  wantWheat: number;
  wantSheep: number;
  wantOre: number;
  message?: string;
}

export interface SendChatRequest {
  toPlayerId: number;
  message: string;
}
