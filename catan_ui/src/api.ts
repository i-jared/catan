import type {
  JoinGameResponse,
  StartGameResponse,
  GameState,
  AIGameState,
  EndTurnResponse,
  AddAIResponse,
  RollDiceResponse,
  AIToolResult,
  AIToolDefinition,
  PendingAITurnsInfo,
} from './types';

const API_BASE = 'http://localhost:8080';

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

  async addAIPlayers(gameId: string, count?: number): Promise<AddAIResponse> {
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

  async buyRoad(gameId: string): Promise<{ success: boolean; roadsRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/road`);
  }

  async buySettlement(gameId: string): Promise<{ success: boolean; settlementsRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/settlement`);
  }

  async buyCity(gameId: string): Promise<{ success: boolean; citiesRemaining: number }> {
    return this.request('POST', `/games/${gameId}/buy/city`);
  }

  async buyDevCard(gameId: string): Promise<{ success: boolean; card: string; cardsInDeck: number }> {
    return this.request('POST', `/games/${gameId}/buy/devcard`);
  }

  async bankTrade(
    gameId: string,
    give: string,
    receive: string
  ): Promise<{ success: boolean; traded: object }> {
    return this.request('POST', `/games/${gameId}/trade/bank`, { give, receive });
  }

  async endTurn(gameId: string): Promise<EndTurnResponse> {
    return this.request('POST', `/games/${gameId}/end-turn`);
  }

  // ============================================================================
  // AI ENDPOINTS
  // ============================================================================

  async getAITools(): Promise<{ tools: AIToolDefinition[] }> {
    return this.request('GET', '/ai/tools', undefined, false);
  }

  async getAIState(gameId: string): Promise<AIGameState> {
    return this.request('GET', `/games/${gameId}/ai/state`);
  }

  async executeAITool(
    gameId: string,
    tool: string,
    params?: object
  ): Promise<AIToolResult> {
    return this.request('POST', `/games/${gameId}/ai/execute`, {
      tool,
      ...params,
    });
  }

  async getPendingAITurns(gameId: string): Promise<PendingAITurnsInfo> {
    return this.request('GET', `/games/${gameId}/ai/pending`, undefined, false);
  }
}

// Singleton instance
export const api = new CatanAPI();
