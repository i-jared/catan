import { useState, useCallback, useEffect, useRef } from 'react';
import { api, type LLMConfig } from './api';
import { useGameEvents, type ChatMessageEvent, type TradeProposedEvent, type TradeExecutedEvent, type TradeResponseEvent } from './useGameEvents';
import type { GameState, StartGameResponse, ResourceHand, PlayerType, ChatMessage, TradeOffer } from './types';
import './App.css';

// ============================================================================
// LLM CONFIG COMPONENT
// ============================================================================

interface LLMConfigPanelProps {
  config: LLMConfig | null;
  onConfigChange: () => void;
}

function LLMConfigPanel({ config, onConfigChange }: LLMConfigPanelProps) {
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setLLMConfig({
        provider,
        apiKey: apiKey || undefined,
        model: model || undefined,
      });
      onConfigChange();
      setApiKey(''); // Clear API key from UI
    } catch (err) {
      console.error('Failed to save LLM config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return null;

  return (
    <div className="llm-config-panel">
      <h4>🤖 LLM Provider</h4>
      <div className="config-row">
        <label>Provider:</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {config.availableProviders.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      {provider !== 'mock' && (
        <>
          <div className="config-row">
            <label>API Key:</label>
            <input
              type="password"
              placeholder="Enter API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="config-row">
            <label>Model:</label>
            <input
              type="text"
              placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </>
      )}
      <button 
        onClick={handleSave} 
        disabled={saving}
        className="btn-secondary"
      >
        {saving ? 'Saving...' : 'Save Config'}
      </button>
      <div className="config-status">
        Status: {config.configured ? '✅ Configured' : '⚠️ Not configured'}
        {config.model && ` (${config.model})`}
      </div>
    </div>
  );
}

// ============================================================================
// GAME LOBBY COMPONENT
// ============================================================================

interface LobbyProps {
  onGameStarted: (gameId: string, gameState: StartGameResponse) => void;
}

function Lobby({ onGameStarted }: LobbyProps) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState<Array<{ id: number; name: string; type: PlayerType }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [llmConfig, setLLMConfig] = useState<LLMConfig | null>(null);

  useEffect(() => {
    // Load LLM config on mount
    api.getLLMConfig().then(setLLMConfig).catch(console.error);
  }, []);

  const refreshLLMConfig = () => {
    api.getLLMConfig().then(setLLMConfig).catch(console.error);
  };

  const createGame = async () => {
    try {
      const result = await api.createGame();
      setGameId(result.gameId);
      setError(null);
    } catch (err) {
      setError(`Failed to create game: ${err}`);
    }
  };

  const joinGame = async () => {
    if (!gameId || !playerName.trim()) return;
    try {
      const result = await api.joinGame(gameId, playerName.trim(), false);
      api.setAuthToken(result.token);
      setJoined(true);
      setPlayers([{ id: result.playerId, name: result.playerName, type: 'human' }]);
      setError(null);
    } catch (err) {
      setError(`Failed to join game: ${err}`);
    }
  };

  const addAIPlayers = async () => {
    if (!gameId) return;
    try {
      const humanToken = api.getAuthToken();
      
      // AI player names
      const aiNames = ['Claude', 'GPT', 'Gemini', 'LLaMA', 'Mistral', 'Falcon', 'Cohere'];
      const updatedPlayers = [...players];
      
      // Add AI players one by one
      const slotsToFill = 4 - players.length;
      for (let i = 0; i < slotsToFill; i++) {
        const aiName = aiNames[(players.length + i) % aiNames.length] + ' (AI)';
        
        const savedToken = api.getAuthToken();
        const aiJoinResult = await api.joinGame(gameId, aiName, true);
        updatedPlayers.push({ id: aiJoinResult.playerId, name: aiJoinResult.playerName, type: 'ai' });
        
        if (savedToken) {
          api.setAuthToken(savedToken);
        }
      }
      
      setPlayers(updatedPlayers);
      setError(null);
      
      if (humanToken) {
        api.setAuthToken(humanToken);
      }
    } catch (err) {
      setError(`Failed to add AI players: ${err}`);
    }
  };

  const startGame = async () => {
    if (!gameId) return;
    try {
      const result = await api.startGame(gameId);
      onGameStarted(gameId, result);
    } catch (err) {
      setError(`Failed to start game: ${err}`);
    }
  };

  return (
    <div className="lobby">
      <h1>🎲 Catan with AI Agents</h1>
      
      {error && <div className="error">{error}</div>}
      
      {!gameId ? (
        <div className="lobby-section">
          <h2>Create New Game</h2>
          <LLMConfigPanel config={llmConfig} onConfigChange={refreshLLMConfig} />
          <button onClick={createGame} className="btn-primary">Create Game</button>
        </div>
      ) : !joined ? (
        <div className="lobby-section">
          <h2>Join Game</h2>
          <p>Game ID: <code>{gameId}</code></p>
          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button onClick={joinGame} className="btn-primary" disabled={!playerName.trim()}>
            Join Game
          </button>
        </div>
      ) : (
        <div className="lobby-section">
          <h2>Game Lobby</h2>
          <p>Game ID: <code>{gameId}</code></p>
          
          <LLMConfigPanel config={llmConfig} onConfigChange={refreshLLMConfig} />
          
          <div className="players-list">
            <h3>Players ({players.length}/4)</h3>
            {players.map(p => (
              <div key={p.id} className={`player-item ${p.type}`}>
                <span className="player-icon">{p.type === 'ai' ? '🤖' : '👤'}</span>
                <span className="player-name">{p.name}</span>
                <span className="player-type">({p.type})</span>
              </div>
            ))}
          </div>
          
          {players.length < 4 && (
            <button onClick={addAIPlayers} className="btn-secondary">
              Fill with AI Players ({4 - players.length} slots)
            </button>
          )}
          
          {players.length >= 2 && (
            <button onClick={startGame} className="btn-primary">
              Start Game
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CHAT PANEL COMPONENT
// ============================================================================

interface ChatPanelProps {
  gameId: string;
  playerId: number;
  players: Array<{ id: number; name: string; type: PlayerType }>;
  messages: ChatMessage[];
  onNewMessage: (msg: ChatMessage) => void;
}

function ChatPanel({ gameId, playerId, players, messages, onNewMessage }: ChatPanelProps) {
  const [newMessage, setNewMessage] = useState('');
  const [targetPlayer, setTargetPlayer] = useState<number>(-1);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    
    setSending(true);
    try {
      const result = await api.sendChat(gameId, targetPlayer, newMessage.trim());
      // Message will come through SSE, but add locally for immediate feedback
      const senderName = players.find(p => p.id === playerId)?.name || 'You';
      onNewMessage({
        id: result.messageId,
        fromPlayerId: playerId,
        fromPlayerName: senderName,
        toPlayerId: targetPlayer,
        content: newMessage.trim(),
        type: 'normal',
      });
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getPlayerName = (id: number) => {
    if (id === -1) return 'Everyone';
    return players.find(p => p.id === id)?.name || `Player ${id}`;
  };

  const getMessageClass = (msg: ChatMessage) => {
    let classes = 'chat-message';
    if (msg.fromPlayerId === playerId) classes += ' own-message';
    if (msg.type === 'trade_proposal') classes += ' trade-message';
    if (msg.type === 'trade_accept') classes += ' trade-accept';
    if (msg.type === 'trade_reject') classes += ' trade-reject';
    if (msg.type === 'system') classes += ' system-message';
    if (msg.toPlayerId !== -1 && (msg.toPlayerId === playerId || msg.fromPlayerId === playerId)) {
      classes += ' private-message';
    }
    return classes;
  };

  return (
    <div className="chat-panel">
      <h3>💬 Chat</h3>
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={getMessageClass(msg)}>
            <div className="chat-header">
              <span className="chat-sender">{msg.fromPlayerName}</span>
              {msg.toPlayerId !== -1 && (
                <span className="chat-recipient">→ {getPlayerName(msg.toPlayerId)}</span>
              )}
            </div>
            <div className="chat-content">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <select 
          value={targetPlayer} 
          onChange={(e) => setTargetPlayer(parseInt(e.target.value))}
          className="chat-target"
        >
          <option value={-1}>📢 Everyone</option>
          {players.filter(p => p.id !== playerId).map(p => (
            <option key={p.id} value={p.id}>
              {p.type === 'ai' ? '🤖' : '👤'} {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Type a message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          className="chat-input"
          disabled={sending}
        />
        <button 
          onClick={handleSend} 
          disabled={!newMessage.trim() || sending}
          className="btn-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// TRADE PANEL COMPONENT
// ============================================================================

interface TradePanelProps {
  gameId: string;
  playerId: number;
  playerResources: ResourceHand;
  players: Array<{ id: number; name: string; type: PlayerType }>;
  activeTrades: TradeOffer[];
  onTradeUpdate: () => void;
}

function TradePanel({ gameId, playerId, playerResources, players, activeTrades, onTradeUpdate }: TradePanelProps) {
  const [showPropose, setShowPropose] = useState(false);
  const [targetPlayer, setTargetPlayer] = useState<number>(-1);
  const [offering, setOffering] = useState<ResourceHand>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const [requesting, setRequesting] = useState<ResourceHand>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const [tradeMessage, setTradeMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleProposeTrade = async () => {
    if (submitting) return;
    
    // Validate offer
    if (offering.wood > playerResources.wood ||
        offering.brick > playerResources.brick ||
        offering.wheat > playerResources.wheat ||
        offering.sheep > playerResources.sheep ||
        offering.ore > playerResources.ore) {
      alert("You don't have enough resources to offer!");
      return;
    }
    
    setSubmitting(true);
    try {
      await api.proposeTrade(gameId, {
        toPlayerId: targetPlayer,
        giveWood: offering.wood,
        giveBrick: offering.brick,
        giveWheat: offering.wheat,
        giveSheep: offering.sheep,
        giveOre: offering.ore,
        wantWood: requesting.wood,
        wantBrick: requesting.brick,
        wantWheat: requesting.wheat,
        wantSheep: requesting.sheep,
        wantOre: requesting.ore,
        message: tradeMessage,
      });
      setShowPropose(false);
      setOffering({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
      setRequesting({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
      setTradeMessage('');
      onTradeUpdate();
    } catch (err) {
      console.error('Failed to propose trade:', err);
      alert('Failed to propose trade');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptTrade = async (tradeId: number) => {
    try {
      await api.acceptTrade(gameId, tradeId);
      onTradeUpdate();
    } catch (err) {
      console.error('Failed to accept trade:', err);
      alert('Failed to accept trade');
    }
  };

  const handleRejectTrade = async (tradeId: number) => {
    try {
      await api.rejectTrade(gameId, tradeId);
      onTradeUpdate();
    } catch (err) {
      console.error('Failed to reject trade:', err);
    }
  };

  const handleCancelTrade = async (tradeId: number) => {
    try {
      await api.cancelTrade(gameId, tradeId);
      onTradeUpdate();
    } catch (err) {
      console.error('Failed to cancel trade:', err);
    }
  };

  const ResourceInput = ({ label, emoji, value, onChange, max }: { 
    label: string; emoji: string; value: number; onChange: (v: number) => void; max?: number 
  }) => (
    <div className="resource-input">
      <span className="emoji">{emoji}</span>
      <input 
        type="number" 
        min={0} 
        max={max}
        value={value} 
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      />
      <span className="label">{label}</span>
    </div>
  );

  const formatResources = (res: ResourceHand) => {
    const parts = [];
    if (res.wood > 0) parts.push(`${res.wood} 🪵`);
    if (res.brick > 0) parts.push(`${res.brick} 🧱`);
    if (res.wheat > 0) parts.push(`${res.wheat} 🌾`);
    if (res.sheep > 0) parts.push(`${res.sheep} 🐑`);
    if (res.ore > 0) parts.push(`${res.ore} 💎`);
    return parts.length > 0 ? parts.join(', ') : 'nothing';
  };

  // Filter trades visible to this player
  const visibleTrades = activeTrades.filter(t => 
    t.isActive && (t.toPlayerId === -1 || t.toPlayerId === playerId || t.fromPlayerId === playerId)
  );

  return (
    <div className="trade-panel">
      <h3>🤝 Trading</h3>
      
      {/* Active trades */}
      {visibleTrades.length > 0 && (
        <div className="active-trades">
          <h4>Active Trades</h4>
          {visibleTrades.map(trade => (
            <div key={trade.id} className={`trade-offer ${trade.fromPlayerId === playerId ? 'own-trade' : ''}`}>
              <div className="trade-header">
                <span className="trade-from">{trade.fromPlayerName}</span>
                <span className="trade-arrow">→</span>
                <span className="trade-to">
                  {trade.toPlayerId === -1 ? 'Anyone' : players.find(p => p.id === trade.toPlayerId)?.name || 'Unknown'}
                </span>
              </div>
              <div className="trade-details">
                <div className="trade-offering">
                  <strong>Offering:</strong> {formatResources(trade.offering)}
                </div>
                <div className="trade-requesting">
                  <strong>Wants:</strong> {formatResources(trade.requesting)}
                </div>
              </div>
              <div className="trade-actions">
                {trade.fromPlayerId === playerId ? (
                  <button onClick={() => handleCancelTrade(trade.id)} className="btn-cancel">
                    Cancel
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => handleAcceptTrade(trade.id)} 
                      className="btn-accept"
                      disabled={
                        playerResources.wood < trade.requesting.wood ||
                        playerResources.brick < trade.requesting.brick ||
                        playerResources.wheat < trade.requesting.wheat ||
                        playerResources.sheep < trade.requesting.sheep ||
                        playerResources.ore < trade.requesting.ore
                      }
                    >
                      ✅ Accept
                    </button>
                    <button onClick={() => handleRejectTrade(trade.id)} className="btn-reject">
                      ❌ Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Propose new trade */}
      {!showPropose ? (
        <button onClick={() => setShowPropose(true)} className="btn-propose">
          + Propose Trade
        </button>
      ) : (
        <div className="propose-trade-form">
          <h4>New Trade Proposal</h4>
          
          <div className="trade-target">
            <label>Trade with:</label>
            <select value={targetPlayer} onChange={(e) => setTargetPlayer(parseInt(e.target.value))}>
              <option value={-1}>📢 Open to all</option>
              {players.filter(p => p.id !== playerId).map(p => (
                <option key={p.id} value={p.id}>
                  {p.type === 'ai' ? '🤖' : '👤'} {p.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="trade-resources">
            <div className="offering-section">
              <h5>I'll Give:</h5>
              <ResourceInput label="Wood" emoji="🪵" value={offering.wood} 
                onChange={(v) => setOffering({...offering, wood: v})} max={playerResources.wood} />
              <ResourceInput label="Brick" emoji="🧱" value={offering.brick} 
                onChange={(v) => setOffering({...offering, brick: v})} max={playerResources.brick} />
              <ResourceInput label="Wheat" emoji="🌾" value={offering.wheat} 
                onChange={(v) => setOffering({...offering, wheat: v})} max={playerResources.wheat} />
              <ResourceInput label="Sheep" emoji="🐑" value={offering.sheep} 
                onChange={(v) => setOffering({...offering, sheep: v})} max={playerResources.sheep} />
              <ResourceInput label="Ore" emoji="💎" value={offering.ore} 
                onChange={(v) => setOffering({...offering, ore: v})} max={playerResources.ore} />
            </div>
            
            <div className="requesting-section">
              <h5>I Want:</h5>
              <ResourceInput label="Wood" emoji="🪵" value={requesting.wood} 
                onChange={(v) => setRequesting({...requesting, wood: v})} />
              <ResourceInput label="Brick" emoji="🧱" value={requesting.brick} 
                onChange={(v) => setRequesting({...requesting, brick: v})} />
              <ResourceInput label="Wheat" emoji="🌾" value={requesting.wheat} 
                onChange={(v) => setRequesting({...requesting, wheat: v})} />
              <ResourceInput label="Sheep" emoji="🐑" value={requesting.sheep} 
                onChange={(v) => setRequesting({...requesting, sheep: v})} />
              <ResourceInput label="Ore" emoji="💎" value={requesting.ore} 
                onChange={(v) => setRequesting({...requesting, ore: v})} />
            </div>
          </div>
          
          <div className="trade-message">
            <input
              type="text"
              placeholder="Add a message (optional)"
              value={tradeMessage}
              onChange={(e) => setTradeMessage(e.target.value)}
            />
          </div>
          
          <div className="trade-form-actions">
            <button onClick={handleProposeTrade} className="btn-primary" disabled={submitting}>
              {submitting ? 'Proposing...' : '📦 Propose Trade'}
            </button>
            <button onClick={() => setShowPropose(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// GAME BOARD COMPONENT
// ============================================================================

interface GameBoardProps {
  gameId: string;
  gameState: GameState;
  players: Array<{ id: number; name: string; type: PlayerType }>;
  onGameUpdate: () => void;
}

function GameBoard({ gameId, gameState, players, onGameUpdate }: GameBoardProps) {
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [aiThinking, setAIThinking] = useState<{ playerId: number; playerName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llmProvider, setLLMProvider] = useState<string>('mock');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeTrades, setActiveTrades] = useState<TradeOffer[]>([]);

  const addToLog = useCallback((message: string) => {
    setActionLog(prev => [...prev.slice(-49), message]);
  }, []);

  const handleNewChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages(prev => {
      // Avoid duplicates
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const refreshTrades = useCallback(async () => {
    try {
      const result = await api.getActiveTrades(gameId);
      setActiveTrades(result.trades);
    } catch (err) {
      console.error('Failed to load trades:', err);
    }
  }, [gameId]);

  // Load initial chat history and trades
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const chatResult = await api.getChatHistory(gameId);
        setChatMessages(chatResult.messages);
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
      
      await refreshTrades();
    };
    loadInitialData();
  }, [gameId, refreshTrades]);

  // Use SSE for real-time updates
  const { isConnected } = useGameEvents(gameId, {
    onConnected: () => {
      addToLog('📡 Connected to game events');
    },
    onDisconnected: () => {
      addToLog('📡 Disconnected from game events');
    },
    onAIThinking: (event) => {
      setAIThinking({ playerId: event.playerId, playerName: event.playerName });
      addToLog(`🤔 ${event.playerName} is thinking...`);
    },
    onAIAction: (event) => {
      addToLog(`🤖 ${event.playerName}: ${event.description}`);
    },
    onAITurnComplete: () => {
      setAIThinking(null);
      addToLog('✅ AI turns completed');
      onGameUpdate();
    },
    onAIError: (errorMsg) => {
      setAIThinking(null);
      addToLog(`❌ AI Error: ${errorMsg}`);
      setError(errorMsg);
    },
    onTurnChanged: (event) => {
      addToLog(`🔄 Turn changed to ${event.playerName}`);
      onGameUpdate();
    },
    // Chat events
    onChatMessage: (event: ChatMessageEvent) => {
      handleNewChatMessage({
        id: event.messageId,
        fromPlayerId: event.fromPlayerId,
        fromPlayerName: event.fromPlayerName,
        toPlayerId: event.toPlayerId,
        content: event.content,
        type: event.type as ChatMessage['type'],
      });
    },
    // Trade events
    onTradeProposed: (event: TradeProposedEvent) => {
      setActiveTrades(prev => [...prev, {
        id: event.tradeId,
        fromPlayerId: event.fromPlayerId,
        fromPlayerName: event.fromPlayerName,
        toPlayerId: event.toPlayerId,
        offering: event.offering,
        requesting: event.requesting,
        isActive: true,
        message: event.message,
      }]);
      addToLog(`📦 ${event.fromPlayerName} proposed a trade`);
    },
    onTradeAccepted: (event: TradeResponseEvent) => {
      addToLog(`✅ ${event.responderName} accepted trade #${event.tradeId}`);
    },
    onTradeRejected: (event: TradeResponseEvent) => {
      addToLog(`❌ ${event.responderName} rejected trade #${event.tradeId}`);
    },
    onTradeExecuted: (event: TradeExecutedEvent) => {
      setActiveTrades(prev => prev.filter(t => t.id !== event.tradeId));
      addToLog(`🤝 Trade completed between ${event.player1Name} and ${event.player2Name}`);
      onGameUpdate();
    },
    onTradeCancelled: (tradeId: number) => {
      setActiveTrades(prev => prev.filter(t => t.id !== tradeId));
      addToLog(`🚫 Trade #${tradeId} was cancelled`);
    },
  });

  // Load LLM provider info
  useEffect(() => {
    api.getLLMConfig().then(config => {
      setLLMProvider(config.provider);
    }).catch(console.error);
  }, []);

  const isMyTurn = gameState.currentPlayer === gameState.yourPlayerId;
  const currentPlayer = players.find(p => p.id === gameState.currentPlayer);
  const isCurrentPlayerAI = currentPlayer?.type === 'ai';
  const isAIProcessing = aiThinking !== null;

  const handleRollDice = async () => {
    try {
      const result = await api.rollDice(gameId);
      addToLog(`You rolled ${result.total} (${result.die1} + ${result.die2})`);
      if (result.robber) {
        addToLog('⚠️ Rolled a 7! Move the robber.');
      }
      onGameUpdate();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const handleEndTurn = async () => {
    try {
      const result = await api.endTurn(gameId);
      addToLog(`You ended your turn. Next: ${result.nextPlayerName}`);
      
      // If AI processing started, the SSE events will handle updates
      if (result.nextPlayerIsAI) {
        addToLog('🤖 AI players are taking their turns...');
      } else {
        onGameUpdate();
      }
    } catch (err) {
      setError(`${err}`);
    }
  };

  const handleBuyDevCard = async () => {
    try {
      const result = await api.buyDevCard(gameId);
      addToLog(`Bought a ${result.card} card!`);
      onGameUpdate();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const handleBankTrade = async (give: string, receive: string) => {
    try {
      await api.bankTrade(gameId, give, receive);
      addToLog(`Traded 4 ${give} for 1 ${receive}`);
      onGameUpdate();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const resources: ResourceHand = gameState.resources || {
    wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0
  };

  const phaseDisplay: Record<string, string> = {
    'rolling': '🎲 Roll Dice',
    'main_turn': '🏗️ Main Phase',
    'robber': '🦹 Move Robber',
    'trading': '🤝 Trading',
    'finished': '🏆 Game Over',
  };

  return (
    <div className="game-board">
      <div className="game-header">
        <h2>Catan</h2>
        <div className="game-info">
          <span>Game: <code>{gameId}</code></span>
          <span>Phase: {phaseDisplay[gameState.phase] || gameState.phase}</span>
          <span>LLM: {llmProvider}</span>
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Live' : '🔴 Offline'}
          </span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="game-content">
        {/* Left Sidebar - Players and Trade */}
        <div className="left-sidebar">
          {/* Players Panel */}
          <div className="players-panel">
            <h3>Players</h3>
            {players.map(p => (
              <div 
                key={p.id} 
                className={`player-card ${p.id === gameState.currentPlayer ? 'active' : ''} ${p.type}`}
              >
                <div className="player-header">
                  <span>{p.type === 'ai' ? '🤖' : '👤'}</span>
                  <span className="player-name">{p.name}</span>
                  {p.id === gameState.yourPlayerId && <span className="you-badge">You</span>}
                </div>
                {p.id === gameState.currentPlayer && (
                  <div className="turn-indicator">
                    {aiThinking?.playerId === p.id ? '⏳ Thinking...' : '▶ Current Turn'}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Trade Panel */}
          <TradePanel
            gameId={gameId}
            playerId={gameState.yourPlayerId}
            playerResources={resources}
            players={players}
            activeTrades={activeTrades}
            onTradeUpdate={refreshTrades}
          />
        </div>

        {/* Main Game Area */}
        <div className="main-area">
          {/* Resources */}
          <div className="resources-panel">
            <h3>Your Resources</h3>
            <div className="resources-grid">
              <div className="resource wood">
                <span className="emoji">🪵</span>
                <span className="count">{resources.wood}</span>
                <span className="name">Wood</span>
              </div>
              <div className="resource brick">
                <span className="emoji">🧱</span>
                <span className="count">{resources.brick}</span>
                <span className="name">Brick</span>
              </div>
              <div className="resource wheat">
                <span className="emoji">🌾</span>
                <span className="count">{resources.wheat}</span>
                <span className="name">Wheat</span>
              </div>
              <div className="resource sheep">
                <span className="emoji">🐑</span>
                <span className="count">{resources.sheep}</span>
                <span className="name">Sheep</span>
              </div>
              <div className="resource ore">
                <span className="emoji">💎</span>
                <span className="count">{resources.ore}</span>
                <span className="name">Ore</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="actions-panel">
            <h3>Actions</h3>
            {isMyTurn && !isAIProcessing ? (
              <div className="action-buttons">
                {gameState.phase === 'rolling' && (
                  <button onClick={handleRollDice} className="btn-action">
                    🎲 Roll Dice
                  </button>
                )}
                {gameState.phase === 'main_turn' && (
                  <>
                    <button 
                      onClick={handleBuyDevCard} 
                      className="btn-action"
                      disabled={resources.wheat < 1 || resources.sheep < 1 || resources.ore < 1}
                    >
                      🃏 Buy Dev Card
                    </button>
                    <div className="trade-section">
                      <span className="trade-label">Bank Trade (4:1):</span>
                      {(['wood', 'brick', 'wheat', 'sheep', 'ore'] as const).map(res => (
                        resources[res] >= 4 && (
                          <select 
                            key={res}
                            onChange={(e) => e.target.value && handleBankTrade(res, e.target.value)}
                            defaultValue=""
                          >
                            <option value="">Trade {res}...</option>
                            {(['wood', 'brick', 'wheat', 'sheep', 'ore'] as const)
                              .filter(r => r !== res)
                              .map(r => (
                                <option key={r} value={r}>Get {r}</option>
                              ))
                            }
                          </select>
                        )
                      ))}
                    </div>
                    <button onClick={handleEndTurn} className="btn-action end-turn">
                      ⏭️ End Turn
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="waiting-message">
                {isAIProcessing ? (
                  <div>
                    <span>🤖 AI players are thinking...</span>
                    {aiThinking && (
                      <div className="ai-current">
                        Current: {aiThinking.playerName}
                      </div>
                    )}
                  </div>
                ) : isCurrentPlayerAI ? (
                  <span>Waiting for {currentPlayer?.name}...</span>
                ) : (
                  <span>Waiting for {currentPlayer?.name}'s turn...</span>
                )}
              </div>
            )}
          </div>

          {/* Action Log */}
          <div className="log-panel">
            <h3>Game Log</h3>
            <div className="log-entries">
              {actionLog.map((entry, i) => (
                <div key={i} className="log-entry">{entry}</div>
              ))}
              {actionLog.length === 0 && (
                <div className="log-empty">Game started! Roll the dice to begin.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Chat */}
        <div className="right-sidebar">
          <ChatPanel
            gameId={gameId}
            playerId={gameState.yourPlayerId}
            players={players}
            messages={chatMessages}
            onNewMessage={handleNewChatMessage}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

function App() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Array<{ id: number; name: string; type: PlayerType }>>([]);

  const handleGameStarted = (id: string, startInfo: StartGameResponse) => {
    setGameId(id);
    setPlayers(startInfo.players);
    refreshGameState(id);
  };

  const refreshGameState = async (id: string) => {
    try {
      const state = await api.getGameState(id);
      setGameState(state);
    } catch (err) {
      console.error('Failed to fetch game state:', err);
    }
  };

  const handleGameUpdate = () => {
    if (gameId) {
      refreshGameState(gameId);
    }
  };

  return (
    <div className="app">
      {!gameId || !gameState ? (
        <Lobby onGameStarted={handleGameStarted} />
      ) : (
        <GameBoard
          gameId={gameId}
          gameState={gameState}
          players={players}
          onGameUpdate={handleGameUpdate}
        />
      )}
    </div>
  );
}

export default App;
