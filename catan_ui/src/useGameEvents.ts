import { useEffect, useRef, useState } from 'react';

// ============================================================================
// SSE EVENT TYPES
// ============================================================================

export interface AIActionEvent {
  playerId: number;
  playerName: string;
  action: string;
  description: string;
  success: boolean;
}

export interface AIThinkingEvent {
  playerId: number;
  playerName: string;
}

export interface TurnChangedEvent {
  currentPlayerIndex: number;
  playerName: string;
  isAI: boolean;
}

export interface GameStateChangedEvent {
  // Full game state JSON
  [key: string]: unknown;
}

export interface ChatMessageEvent {
  messageId: string;
  fromPlayerId: number;
  fromPlayerName: string;
  toPlayerId: number;
  content: string;
  type: string;
}

export interface TradeProposedEvent {
  tradeId: number;
  fromPlayerId: number;
  fromPlayerName: string;
  toPlayerId: number;
  offering: {
    wood: number;
    brick: number;
    wheat: number;
    sheep: number;
    ore: number;
  };
  requesting: {
    wood: number;
    brick: number;
    wheat: number;
    sheep: number;
    ore: number;
  };
  message?: string;
}

export interface TradeResponseEvent {
  tradeId: number;
  responderId: number;
  responderName: string;
}

export interface TradeExecutedEvent {
  tradeId: number;
  player1Id: number;
  player1Name: string;
  player2Id: number;
  player2Name: string;
}

export type GameEventType = 
  | 'connected'
  | 'ai_thinking'
  | 'ai_action'
  | 'ai_turn_complete'
  | 'ai_error'
  | 'game_state_changed'
  | 'turn_changed'
  | 'player_joined'
  | 'game_started'
  | 'game_ended'
  | 'chat_message'
  | 'trade_proposed'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'trade_countered'
  | 'trade_executed'
  | 'trade_cancelled';

export interface GameEvent {
  type: GameEventType;
  data: unknown;
}

export interface UseGameEventsOptions {
  onAIAction?: (event: AIActionEvent) => void;
  onAIThinking?: (event: AIThinkingEvent) => void;
  onAITurnComplete?: () => void;
  onAIError?: (error: string) => void;
  onTurnChanged?: (event: TurnChangedEvent) => void;
  onGameStateChanged?: (state: GameStateChangedEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Event) => void;
  // Chat and trade events
  onChatMessage?: (event: ChatMessageEvent) => void;
  onTradeProposed?: (event: TradeProposedEvent) => void;
  onTradeAccepted?: (event: TradeResponseEvent) => void;
  onTradeRejected?: (event: TradeResponseEvent) => void;
  onTradeCountered?: (event: TradeResponseEvent) => void;
  onTradeExecuted?: (event: TradeExecutedEvent) => void;
  onTradeCancelled?: (tradeId: number) => void;
}

// ============================================================================
// USE GAME EVENTS HOOK
// ============================================================================

export function useGameEvents(
  gameId: string | null,
  options: UseGameEventsOptions = {}
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  // Store options in a ref to avoid stale closures
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Connect/disconnect based on gameId
  useEffect(() => {
    if (!gameId) {
      return;
    }

    // Create the EventSource connection
    const url = `http://localhost:8080/games/${gameId}/events`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      optionsRef.current.onConnected?.();
    };

    eventSource.onerror = (event) => {
      setIsConnected(false);
      optionsRef.current.onError?.(event);
      optionsRef.current.onDisconnected?.();
      
      // Try to reconnect after a delay
      reconnectTimeoutRef.current = setTimeout(() => {
        if (eventSourceRef.current === eventSource && gameId) {
          // Trigger reconnection by closing and re-opening
          eventSource.close();
          eventSourceRef.current = null;
        }
      }, 3000);
    };

    // Handle specific event types
    eventSource.addEventListener('connected', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log('SSE connected:', data);
        setLastEventId(event.lastEventId);
      } catch {
        console.error('Failed to parse connected event');
      }
    });

    eventSource.addEventListener('ai_thinking', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as AIThinkingEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onAIThinking?.(data);
      } catch {
        console.error('Failed to parse ai_thinking event');
      }
    });

    eventSource.addEventListener('ai_action', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as AIActionEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onAIAction?.(data);
      } catch {
        console.error('Failed to parse ai_action event');
      }
    });

    eventSource.addEventListener('ai_turn_complete', (event: MessageEvent) => {
      setLastEventId(event.lastEventId);
      optionsRef.current.onAITurnComplete?.();
    });

    eventSource.addEventListener('ai_error', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setLastEventId(event.lastEventId);
        optionsRef.current.onAIError?.(data.error || 'Unknown error');
      } catch {
        optionsRef.current.onAIError?.('Unknown error');
      }
    });

    eventSource.addEventListener('turn_changed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TurnChangedEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTurnChanged?.(data);
      } catch {
        console.error('Failed to parse turn_changed event');
      }
    });

    eventSource.addEventListener('game_state_changed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as GameStateChangedEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onGameStateChanged?.(data);
      } catch {
        console.error('Failed to parse game_state_changed event');
      }
    });

    // Chat and trade events
    eventSource.addEventListener('chat_message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as ChatMessageEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onChatMessage?.(data);
      } catch {
        console.error('Failed to parse chat_message event');
      }
    });

    eventSource.addEventListener('trade_proposed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TradeProposedEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeProposed?.(data);
      } catch {
        console.error('Failed to parse trade_proposed event');
      }
    });

    eventSource.addEventListener('trade_accepted', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TradeResponseEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeAccepted?.(data);
      } catch {
        console.error('Failed to parse trade_accepted event');
      }
    });

    eventSource.addEventListener('trade_rejected', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TradeResponseEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeRejected?.(data);
      } catch {
        console.error('Failed to parse trade_rejected event');
      }
    });

    eventSource.addEventListener('trade_countered', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TradeResponseEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeCountered?.(data);
      } catch {
        console.error('Failed to parse trade_countered event');
      }
    });

    eventSource.addEventListener('trade_executed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TradeExecutedEvent;
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeExecuted?.(data);
      } catch {
        console.error('Failed to parse trade_executed event');
      }
    });

    eventSource.addEventListener('trade_cancelled', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setLastEventId(event.lastEventId);
        optionsRef.current.onTradeCancelled?.(data.tradeId);
      } catch {
        console.error('Failed to parse trade_cancelled event');
      }
    });

    // Cleanup function
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      eventSource.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [gameId]);

  const reconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    // Trigger reconnection by re-running the effect
    // This requires the component to re-render, which happens when we setIsConnected
    setIsConnected(false);
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  };

  return {
    isConnected,
    lastEventId,
    reconnect,
    disconnect,
  };
}
