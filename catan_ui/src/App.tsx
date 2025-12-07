import { useState, useCallback, useEffect } from 'react';
import { api, type LLMConfig } from './api';
import { useGameEvents } from './useGameEvents';
import type { GameState, StartGameResponse, ResourceHand, PlayerType } from './types';
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

  const addToLog = useCallback((message: string) => {
    setActionLog(prev => [...prev.slice(-49), message]);
  }, []);

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
