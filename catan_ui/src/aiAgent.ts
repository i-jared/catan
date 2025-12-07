import { api } from './api';
import type { AIGameState, AIToolResult } from './types';

// ============================================================================
// AI AGENT SERVICE
// Handles processing AI turns by calling an LLM and executing tools
// ============================================================================

export interface AITurnEvent {
  type: 'thinking' | 'action' | 'error' | 'turn_complete';
  playerId: number;
  playerName: string;
  message: string;
  data?: unknown;
}

export type AITurnEventHandler = (event: AITurnEvent) => void;

// Configuration for the LLM provider
export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'mock';
  apiKey?: string;
  model?: string;
}

// Tool call from LLM
interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// MOCK LLM - Simple AI for testing without a real LLM
// ============================================================================

function mockLLMDecision(state: AIGameState): ToolCall {
  // Simple decision logic for testing
  const { phase, availableTools, resources } = state;

  if (phase === 'rolling' && availableTools.includes('roll_dice')) {
    return { tool: 'roll_dice', arguments: {} };
  }

  if (phase === 'robber' && availableTools.includes('move_robber')) {
    // Move robber to a random non-robber hex
    const targetHex = state.hexes.find(h => !h.hasRobber && h.type !== 'desert');
    if (targetHex) {
      return {
        tool: 'move_robber',
        arguments: {
          hexQ: targetHex.q,
          hexR: targetHex.r,
          stealFromPlayerId: state.otherPlayers[0]?.id ?? -1,
        },
      };
    }
  }

  if (phase === 'main_turn') {
    // Try to buy a dev card if we can afford it
    if (
      availableTools.includes('buy_dev_card') &&
      resources.wheat >= 1 &&
      resources.sheep >= 1 &&
      resources.ore >= 1
    ) {
      return { tool: 'buy_dev_card', arguments: {} };
    }

    // Try bank trade if we have 4+ of any resource
    if (availableTools.includes('bank_trade')) {
      const resourceTypes: Array<keyof typeof resources> = ['wood', 'brick', 'wheat', 'sheep', 'ore'];
      for (const res of resourceTypes) {
        if (resources[res] >= 4) {
          // Trade for something we need
          const need = resourceTypes.find(r => r !== res && resources[r] < 2);
          if (need) {
            return {
              tool: 'bank_trade',
              arguments: { give: res, receive: need },
            };
          }
        }
      }
    }

    // End turn if nothing else to do
    if (availableTools.includes('end_turn')) {
      return { tool: 'end_turn', arguments: {} };
    }
  }

  // Fallback: end turn if available
  if (availableTools.includes('end_turn')) {
    return { tool: 'end_turn', arguments: {} };
  }

  // No valid action found
  return { tool: '', arguments: {} };
}

// ============================================================================
// AI AGENT PROCESSOR
// ============================================================================

export class AIAgentProcessor {
  private gameId: string;
  private llmConfig: LLMConfig;
  private onEvent: AITurnEventHandler;
  private isProcessing = false;
  private shouldStop = false;

  constructor(
    gameId: string,
    llmConfig: LLMConfig,
    onEvent: AITurnEventHandler
  ) {
    this.gameId = gameId;
    this.llmConfig = llmConfig;
    this.onEvent = onEvent;
  }

  // Store tokens for AI players
  private aiTokens: Map<number, string> = new Map();

  setAIToken(playerId: number, token: string) {
    this.aiTokens.set(playerId, token);
  }

  // Process all pending AI turns until it's a human's turn
  async processAllAITurns(): Promise<void> {
    if (this.isProcessing) {
      console.log('Already processing AI turns');
      return;
    }

    this.isProcessing = true;
    this.shouldStop = false;

    try {
      let pendingInfo = await api.getPendingAITurns(this.gameId);

      while (pendingInfo.currentPlayerIsAI && !this.shouldStop) {
        const aiPlayerId = pendingInfo.currentAIPlayer!.id;
        const aiPlayerName = pendingInfo.currentAIPlayer!.name;

        // Set the auth token for this AI player
        const aiToken = this.aiTokens.get(aiPlayerId);
        if (aiToken) {
          api.setAuthToken(aiToken);
        }

        await this.processAITurn(aiPlayerId, aiPlayerName);

        // Check if there are more AI turns
        pendingInfo = await api.getPendingAITurns(this.gameId);
      }
    } catch (error) {
      this.onEvent({
        type: 'error',
        playerId: -1,
        playerName: 'System',
        message: `Error processing AI turns: ${error}`,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  // Process a single AI player's turn
  private async processAITurn(playerId: number, playerName: string): Promise<void> {
    this.onEvent({
      type: 'thinking',
      playerId,
      playerName,
      message: `${playerName} is thinking...`,
    });

    let turnEnded = false;
    let actionCount = 0;
    const maxActions = 20; // Safety limit

    while (!turnEnded && actionCount < maxActions && !this.shouldStop) {
      actionCount++;

      // Get current game state for AI
      const state = await api.getAIState(this.gameId);

      if (!state.isMyTurn) {
        // Not our turn anymore
        break;
      }

      // Get AI decision
      const toolCall = await this.getAIDecision(state);

      if (!toolCall.tool) {
        this.onEvent({
          type: 'error',
          playerId,
          playerName,
          message: `${playerName} couldn't decide on an action`,
        });
        break;
      }

      // Execute the tool
      try {
        const result = await api.executeAITool(
          this.gameId,
          toolCall.tool,
          toolCall.arguments
        );

        this.onEvent({
          type: 'action',
          playerId,
          playerName,
          message: this.describeAction(playerName, toolCall, result),
          data: result,
        });

        if (toolCall.tool === 'end_turn') {
          turnEnded = true;
        }

        // Small delay between actions for UX
        await this.delay(500);
      } catch (error) {
        this.onEvent({
          type: 'error',
          playerId,
          playerName,
          message: `${playerName} failed to execute ${toolCall.tool}: ${error}`,
        });
        break;
      }
    }

    this.onEvent({
      type: 'turn_complete',
      playerId,
      playerName,
      message: `${playerName}'s turn is complete`,
    });
  }

  // Get AI's decision on what action to take
  private async getAIDecision(state: AIGameState): Promise<ToolCall> {
    if (this.llmConfig.provider === 'mock') {
      // Add a small delay to simulate thinking
      await this.delay(300);
      return mockLLMDecision(state);
    }

    // For real LLM providers, this would call the appropriate API
    // For now, fall back to mock
    console.warn(`LLM provider ${this.llmConfig.provider} not implemented, using mock`);
    return mockLLMDecision(state);
  }

  // Create human-readable description of an action
  private describeAction(
    playerName: string,
    toolCall: ToolCall,
    result: AIToolResult
  ): string {
    switch (toolCall.tool) {
      case 'roll_dice':
        return `${playerName} rolled a ${(result as { total?: number }).total ?? '?'}`;
      case 'end_turn':
        return `${playerName} ended their turn`;
      case 'build_road':
        return `${playerName} built a road`;
      case 'build_settlement':
        return `${playerName} built a settlement`;
      case 'build_city':
        return `${playerName} upgraded to a city`;
      case 'buy_dev_card':
        return `${playerName} bought a development card`;
      case 'bank_trade':
        return `${playerName} traded with the bank`;
      case 'move_robber':
        return `${playerName} moved the robber`;
      case 'play_knight':
        return `${playerName} played a Knight`;
      default:
        return `${playerName} used ${toolCall.tool}`;
    }
  }

  // Stop processing AI turns
  stop() {
    this.shouldStop = true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let aiProcessor: AIAgentProcessor | null = null;

export function initializeAIProcessor(
  gameId: string,
  config: LLMConfig,
  onEvent: AITurnEventHandler
): AIAgentProcessor {
  aiProcessor = new AIAgentProcessor(gameId, config, onEvent);
  return aiProcessor;
}

export function getAIProcessor(): AIAgentProcessor | null {
  return aiProcessor;
}
