# Catan with AI Agents

A Catan board game implementation with support for human players and LLM-powered AI agents.

## Features

- **Human + AI Gameplay**: Play against LLM agents that use tools to make decisions
- **Flexible Player Configuration**: Currently supports 1 human + 3 AI, but designed to easily extend to multiple humans
- **Automatic AI Turns**: When a human ends their turn, AI players automatically take their turns in sequence
- **Tool-based AI System**: AI agents interact with the game through a defined set of tools (roll dice, build, trade, etc.)

## Architecture

### Backend (C++)

The server provides a REST API for game management:

```
LOBBY:
  POST /games              - Create a new game
  GET  /games              - List all games
  POST /games/{id}/join    - Join a game (body: {name, isAI})
  POST /games/{id}/add-ai  - Add AI players to fill slots
  POST /games/{id}/start   - Start the game
  GET  /games/{id}         - Get game state

GAMEPLAY:
  POST /games/{id}/roll           - Roll dice
  POST /games/{id}/buy/road       - Buy a road
  POST /games/{id}/buy/settlement - Buy a settlement
  POST /games/{id}/buy/city       - Buy a city
  POST /games/{id}/buy/devcard    - Buy dev card
  POST /games/{id}/trade/bank     - Trade with bank (4:1)
  POST /games/{id}/end-turn       - End your turn

AI AGENT ENDPOINTS:
  GET  /ai/tools                 - Get AI tool definitions (JSON schema)
  GET  /games/{id}/ai/state      - Get game state formatted for AI decision making
  POST /games/{id}/ai/execute    - Execute an AI tool
  GET  /games/{id}/ai/pending    - Get pending AI turn info
```

### Frontend (React + TypeScript)

The UI handles:
- Game lobby (create/join game, add AI players)
- Game board display with resources and actions
- AI turn processing (calls LLM for decisions, executes tools)
- Action log showing all game events

### AI Agent System

AI players use a tool-based system similar to function calling:

**Available Tools:**
- `roll_dice` - Roll dice to start turn
- `build_road` - Build a road (1 wood + 1 brick)
- `build_settlement` - Build a settlement (1 each wood/brick/wheat/sheep)
- `build_city` - Upgrade to city (2 wheat + 3 ore)
- `buy_dev_card` - Buy development card (1 each wheat/sheep/ore)
- `bank_trade` - Trade 4:1 with bank
- `move_robber` - Move robber after rolling 7
- `play_knight` - Play Knight card
- `play_road_building` - Play Road Building card
- `play_year_of_plenty` - Play Year of Plenty card
- `play_monopoly` - Play Monopoly card
- `end_turn` - End current turn

## Getting Started

### Build Backend

```bash
cd catan_api
g++ -std=c++17 -c -o catan_game.o catan_game.cpp
g++ -std=c++17 -c -o ai_agent.o ai_agent.cpp
g++ -std=c++17 -c -o server.o server.cpp
g++ -std=c++17 -o catan_server server.o catan_game.o ai_agent.o -lpthread
./catan_server
```

### Build Frontend

```bash
cd catan_ui
npm install
npm run dev  # Development
npm run build  # Production
```

## Extending for Multiple Humans

The system is designed for easy extension to multiple human players:

1. **Player Type Tracking**: Each player has a `PlayerType` (Human/AI)
2. **Session Tokens**: Each player (human or AI) has their own auth token
3. **Turn Detection**: The `AIPlayerManager` identifies which players are AI vs human
4. **UI State**: The frontend tracks which players are human to show appropriate UI

To add multiple human support:
1. Allow multiple users to join the same game
2. Each human gets their own session token
3. Show turn notifications to all connected humans
4. AI turn processing happens after ANY human ends their turn (not just a specific one)

## LLM Integration

The current implementation uses a mock LLM (`aiAgent.ts`). To integrate a real LLM:

1. Implement the `getAIDecision()` method in `AIAgentProcessor`
2. Send the `AIGameState` to your LLM with the tool definitions
3. Parse the LLM's tool call response
4. Execute the tool via the API

Supported LLM providers can be configured via `LLMConfig`:
```typescript
{
  provider: 'anthropic' | 'openai' | 'mock',
  apiKey: string,
  model: string
}
```
