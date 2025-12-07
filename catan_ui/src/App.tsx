import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { initializeAIProcessor, type AITurnEvent, type AIAgentProcessor } from './aiAgent';
import type { GameState, StartGameResponse, ResourceHand, PlayerType } from './types';
import './App.css';

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
  const [aiTokens, setAiTokens] = useState<Map<number, string>>(new Map());

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
      const newAiTokens = new Map(aiTokens);
      const updatedPlayers = [...players];
      
      // AI player names
      const aiNames = ['Claude', 'GPT', 'Gemini', 'LLaMA', 'Mistral', 'Falcon', 'Cohere'];
      
      // Add AI players one by one to get their tokens
      const slotsToFill = 4 - players.length;
      for (let i = 0; i < slotsToFill; i++) {
        const aiName = aiNames[(players.length + i) % aiNames.length] + ' (AI)';
        
        // Join as AI player to get token
        const savedToken = api.getAuthToken();
        const aiJoinResult = await api.joinGame(gameId, aiName, true);
        newAiTokens.set(aiJoinResult.playerId, aiJoinResult.token);
        updatedPlayers.push({ id: aiJoinResult.playerId, name: aiJoinResult.playerName, type: 'ai' });
        
        // Restore human token
        if (savedToken) {
          api.setAuthToken(savedToken);
        }
      }
      
      setAiTokens(newAiTokens);
      setPlayers(updatedPlayers);
      setError(null);
      
      // Restore human token
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
      
      // Pass AI tokens to the game
      const gameInfo = {
        ...result,
        aiTokens,
      };
      
      onGameStarted(gameId, gameInfo as StartGameResponse & { aiTokens: Map<number, string> });
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
  aiTokens: Map<number, string>;
  onGameUpdate: () => void;
}

function GameBoard({ gameId, gameState, players, aiTokens, onGameUpdate }: GameBoardProps) {
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiProcessorRef = useRef<AIAgentProcessor | null>(null);

  const addToLog = useCallback((message: string) => {
    setActionLog(prev => [...prev.slice(-49), message]);
  }, []);

  // Initialize AI processor
  useEffect(() => {
    const handleAIEvent = (event: AITurnEvent) => {
      addToLog(`[${event.type.toUpperCase()}] ${event.message}`);
      
      if (event.type === 'turn_complete') {
        // Refresh game state after AI turn completes
        onGameUpdate();
      }
    };

    const processor = initializeAIProcessor(
      gameId,
      { provider: 'mock' },
      handleAIEvent
    );

    // Set AI tokens
    aiTokens.forEach((token, playerId) => {
      processor.setAIToken(playerId, token);
    });

    aiProcessorRef.current = processor;
  }, [gameId, aiTokens, addToLog, onGameUpdate]);

  const isMyTurn = gameState.currentPlayer === gameState.yourPlayerId;
  const currentPlayer = players.find(p => p.id === gameState.currentPlayer);
  const isCurrentPlayerAI = currentPlayer?.type === 'ai';

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
      
      // If next player is AI, start processing AI turns
      if (result.nextPlayerIsAI && aiProcessorRef.current) {
        setIsProcessingAI(true);
        addToLog('🤖 AI players are taking their turns...');
        
        try {
          await aiProcessorRef.current.processAllAITurns();
        } finally {
          setIsProcessingAI(false);
          onGameUpdate();
        }
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
                  {isProcessingAI && p.type === 'ai' ? '⏳ Thinking...' : '▶ Current Turn'}
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
            {isMyTurn && !isProcessingAI ? (
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
                {isProcessingAI ? (
                  <span>🤖 AI players are thinking...</span>
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
  const [aiTokens, setAiTokens] = useState<Map<number, string>>(new Map());

  const handleGameStarted = (
    id: string, 
    startInfo: StartGameResponse & { aiTokens?: Map<number, string> }
  ) => {
    setGameId(id);
    setPlayers(startInfo.players);
    if (startInfo.aiTokens) {
      setAiTokens(startInfo.aiTokens);
    }
    
    // Fetch initial game state
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
          aiTokens={aiTokens}
          onGameUpdate={handleGameUpdate}
        />
      )}
    </div>
  );
}

export default App;
