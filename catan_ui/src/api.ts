import type {
  JoinGameResponse,
  StartGameResponse,
  GameState,
  AIGameState,
  EndTurnResponse,
  RollDiceResponse,
  AIToolDefinition,
  PendingAITurnsInfo,
  ChatHistoryResponse,
  ActiveTradesResponse,
  ProposeTradeRequest,
} from './types';

const API_BASE = 'http://localhost:8080';

// ============================================================================
// AI STATUS TYPES
// ============================================================================

export interface AITurnStatus {
  status: 'idle' | 'processing' | 'completed' | 'error';
  currentAIPlayerId: number;
  error?: string;
  hasAIPendingTurns: boolean;
  llmProvider: string;
  recentActions: Array<{
    playerId: number;
    playerName: string;
    action: string;
    description: string;
    success: boolean;
    error?: string;
  }>;
}

export interface LLMConfig {
  provider: string;
  model: string;
  configured: boolean;
  availableProviders: string[];
}

// ============================================================================
// API CLIENT
// ============================================================================

class CatanAPI {
  private authToken: string | null = null;

  setAuthToken(token: string) {
    this.authToken = token;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object,
    requiresAuth = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth && this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data as T;
  }

  // ============================================================================
  // LOBBY ENDPOINTS
  // ============================================================================

  async createGame(): Promise<{ gameId: string; message: string }> {
    return this.request('POST', '/games', undefined, false);
  }

  async listGames(): Promise<{ games: string[] }> {
    return this.request('GET', '/games', undefined, false);
  }

  async joinGame(
    gameId: string,
    name?: string,
    isAI = false
  ): Promise<JoinGameResponse> {
    return this.request(
      'POST',
      `/games/${gameId}/join`,
      { name, isAI },
      false
    );
  }

  async addAIPlayers(gameId: string, count?: number): Promise<{
    success: boolean;
    addedCount: number;
    totalPlayers: number;
  }> {
    return this.request('POST', `/games/${gameId}/add-ai`, { count }, true);
  }

  async startGame(gameId: string): Promise<StartGameResponse> {
    return this.request('POST', `/games/${gameId}/start`);
  }

  async getGameState(gameId: string): Promise<GameState> {
    return this.request('GET', `/games/${gameId}`);
  }

  // ============================================================================
  // GAMEPLAY ENDPOINTS
  // ============================================================================

  async rollDice(gameId: string): Promise<RollDiceResponse> {
    return this.request('POST', `/games/${gameId}/roll`);
  }

  async buyRoad(gameId: string, hexQ: number, hexR: number, direction: number): Promise<{ success: boolean; roadsRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/road`, { hexQ, hexR, direction });
  }

  async buySettlement(gameId: string, hexQ: number, hexR: number, direction: number): Promise<{ success: boolean; settlementsRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/settlement`, { hexQ, hexR, direction });
  }

  async buyCity(gameId: string, hexQ: number, hexR: number, direction: number): Promise<{ success: boolean; citiesRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/city`, { hexQ, hexR, direction });
  }

  // ============================================================================
  // SETUP PHASE ENDPOINTS
  // ============================================================================

  async setupPlaceSettlement(gameId: string, hexQ: number, hexR: number, direction: number): Promise<{ success: boolean; needsRoad: boolean }> {
    return this.request('POST', `/games/${gameId}/setup/settlement`, { hexQ, hexR, direction });
  }

  async setupPlaceRoad(gameId: string, hexQ: number, hexR: number, direction: number): Promise<{ 
    success: boolean; 
    setupComplete: boolean; 
    phase: string;
    currentPlayer: number;
    currentPlayerIsAI?: boolean;
  }> {
    return this.request('POST', `/games/${gameId}/setup/road`, { hexQ, hexR, direction });
  }

  async buyDevCard(gameId: string): Promise<{ success: boolean; card: string; cardsInDeck: number }> {
    return this.request('POST', `/games/${gameId}/buy/devcard`);
  }

  async bankTrade(
    gameId: string,
    give: string,
    receive: string
  ): Promise<{ success: boolean; traded: { gave: string; gaveAmount: number; received: string; receivedAmount: number } }> {
    return this.request('POST', `/games/${gameId}/trade/bank`, { give, receive });
  }

  async endTurn(gameId: string): Promise<EndTurnResponse & { aiProcessingStarted?: boolean }> {
    return this.request('POST', `/games/${gameId}/end-turn`);
  }

  // ============================================================================
  // SERVER-SIDE AI ENDPOINTS
  // ============================================================================

  async startAITurns(gameId: string): Promise<{ started: boolean; status: string; llmProvider: string }> {
    return this.request('POST', `/games/${gameId}/ai/start`, undefined, false);
  }

  async stopAITurns(gameId: string): Promise<{ stopped: boolean }> {
    return this.request('POST', `/games/${gameId}/ai/stop`, undefined, false);
  }

  async getAIStatus(gameId: string): Promise<AITurnStatus> {
    return this.request('GET', `/games/${gameId}/ai/status`, undefined, false);
  }

  async getAILog(gameId: string): Promise<{ actions: AITurnStatus['recentActions'] }> {
    return this.request('GET', `/games/${gameId}/ai/log`, undefined, false);
  }

  async getAIState(gameId: string): Promise<AIGameState> {
    return this.request('GET', `/games/${gameId}/ai/state`);
  }

  async getPendingAITurns(gameId: string): Promise<PendingAITurnsInfo> {
    return this.request('GET', `/games/${gameId}/ai/pending`, undefined, false);
  }

  // ============================================================================
  // LLM CONFIGURATION
  // ============================================================================

  async getLLMConfig(): Promise<LLMConfig> {
    return this.request('GET', '/llm/config', undefined, false);
  }

  async setLLMConfig(config: {
    provider: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }): Promise<LLMConfig> {
    return this.request('POST', '/llm/config', config, false);
  }

  async getAITools(): Promise<{ tools: AIToolDefinition[] }> {
    return this.request('GET', '/ai/tools', undefined, false);
  }

  // ============================================================================
  // CHAT ENDPOINTS
  // ============================================================================

  async sendChat(gameId: string, toPlayerId: number, message: string): Promise<{ success: boolean; messageId: string }> {
    return this.request('POST', `/games/${gameId}/chat`, { toPlayerId, message });
  }

  async getChatHistory(gameId: string): Promise<ChatHistoryResponse> {
    return this.request('GET', `/games/${gameId}/chat`);
  }

  // ============================================================================
  // PLAYER TRADE ENDPOINTS
  // ============================================================================

  async proposeTrade(
    gameId: string,
    trade: ProposeTradeRequest
  ): Promise<{ success: boolean; tradeId: number; messageId: string }> {
    return this.request('POST', `/games/${gameId}/trade/propose`, trade);
  }

  async getActiveTrades(gameId: string): Promise<ActiveTradesResponse> {
    return this.request('GET', `/games/${gameId}/trades`);
  }

  async acceptTrade(gameId: string, tradeId: number): Promise<{ success: boolean; executed: boolean }> {
    return this.request('POST', `/games/${gameId}/trade/${tradeId}/accept`);
  }

  async rejectTrade(gameId: string, tradeId: number): Promise<{ success: boolean }> {
    return this.request('POST', `/games/${gameId}/trade/${tradeId}/reject`);
  }

  async counterTrade(
    gameId: string,
    originalTradeId: number,
    counter: Omit<ProposeTradeRequest, 'toPlayerId'>
  ): Promise<{ success: boolean; counterTradeId: number }> {
    return this.request('POST', `/games/${gameId}/trade/${originalTradeId}/counter`, counter);
  }

  async cancelTrade(gameId: string, tradeId: number): Promise<{ success: boolean }> {
    return this.request('POST', `/games/${gameId}/trade/${tradeId}/cancel`);
  }
}

// Singleton instance
export const api = new CatanAPI();
