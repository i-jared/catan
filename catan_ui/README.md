# Catan with AI Agents

A Catan board game implementation with support for human players and LLM-powered AI agents. **AI execution happens server-side** with support for multiple LLM providers.

## Features

- **Human + AI Gameplay**: Play against LLM agents that use tools to make decisions
- **Server-Side AI Execution**: All AI logic runs on the server - secure and consistent
- **Multiple LLM Providers**: Switch between Anthropic (Claude), OpenAI (GPT), or mock AI
- **Automatic AI Turns**: When a human ends their turn, AI players automatically take their turns
- **Real-time Updates**: Server-Sent Events (SSE) for instant AI action updates

## Architecture

### Backend (C++)

The server handles all game logic and AI execution:

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
  POST /games/{id}/end-turn       - End your turn (auto-triggers AI)

SERVER-SIDE AI (auto-runs when AI player's turn):
  POST /games/{id}/ai/start       - Manually start AI processing
  POST /games/{id}/ai/stop        - Stop AI processing
  GET  /games/{id}/ai/status      - Get AI processing status + action log
  GET  /games/{id}/ai/log         - Get full AI action log

REAL-TIME EVENTS (SSE):
  GET  /games/{id}/events         - Subscribe to game events (SSE stream)

LLM CONFIGURATION:
  GET  /llm/config                - Get current LLM config
  POST /llm/config                - Set LLM config (provider, apiKey, model)
```

### LLM Providers

The server supports multiple LLM providers:

| Provider | Models | Setup |
|----------|--------|-------|
| `mock` | N/A | Default, no API key needed |
| `anthropic` | claude-sonnet-4-20250514, etc | Set `ANTHROPIC_API_KEY` env var |
| `openai` | gpt-4, gpt-4-turbo, etc | Set `OPENAI_API_KEY` env var |

**Configuration methods:**
1. Environment variables (auto-detected on startup)
2. POST to `/llm/config` with `{provider, apiKey, model}`
3. UI configuration panel in the lobby

### Frontend (React + TypeScript)

The UI handles:
- Game lobby (create/join game, add AI players, configure LLM)
- Game board display with resources and actions
- **Server-Sent Events (SSE)** for real-time AI action updates
- Action log showing all game events as they happen

The frontend **does not** execute AI logic - it receives real-time updates via SSE.

## Getting Started

### Build Backend

```bash
cd catan_api
g++ -std=c++17 -c -o catan_game.o catan_game.cpp
g++ -std=c++17 -c -o ai_agent.o ai_agent.cpp
g++ -std=c++17 -c -o llm_provider.o llm_provider.cpp
g++ -std=c++17 -c -o sse_handler.o sse_handler.cpp
g++ -std=c++17 -c -o server.o server.cpp
g++ -std=c++17 -o catan_server server.o catan_game.o ai_agent.o llm_provider.o sse_handler.o -lpthread
./catan_server
```

### Build Frontend

```bash
cd catan_ui
npm install
npm run dev  # Development
npm run build  # Production
```

### Using Real LLM Providers

**Option 1: Environment Variables**
```bash
# For Anthropic Claude
export ANTHROPIC_API_KEY=your_key_here
./catan_server

# For OpenAI GPT
export OPENAI_API_KEY=your_key_here
./catan_server
```

**Option 2: API Configuration**
```bash
# Set provider via API
curl -X POST http://localhost:8080/llm/config \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","apiKey":"your_key","model":"claude-sonnet-4-20250514"}'
```

**Option 3: UI Configuration**
Use the LLM configuration panel in the game lobby.

## How it Works

1. Human creates a game and joins
2. Configure LLM provider (or use mock for testing)
3. Click "Fill with AI Players" to add 3 AI players
4. Start the game (frontend automatically subscribes to SSE events)
5. Human takes their turn (roll dice, build, trade, etc.)
6. When human clicks "End Turn":
   - Server automatically starts AI turn processing
   - Each AI player calls the configured LLM for decisions
   - LLM returns tool calls (roll_dice, build_road, end_turn, etc.)
   - Server executes the tools and advances the game
   - **AI actions stream to frontend in real-time via SSE**
   - Control returns to human when all AI turns complete

## AI Tool System

The AI uses a tool-based system similar to function calling:

**Available Tools:**
- `roll_dice` - Roll dice to start turn
- `build_road` - Build a road (1 wood + 1 brick)
- `build_settlement` - Build a settlement (1 each wood/brick/wheat/sheep)
- `build_city` - Upgrade to city (2 wheat + 3 ore)
- `buy_dev_card` - Buy development card (1 each wheat/sheep/ore)
- `bank_trade` - Trade 4:1 with bank
- `move_robber` - Move robber after rolling 7
- `play_knight` - Play Knight card
- `end_turn` - End current turn

## Extending for Multiple Humans

The system is designed for easy extension to multiple human players:

1. **Player Type Tracking**: Each player has a `PlayerType` (Human/AI)
2. **Session Tokens**: Each player (human or AI) has their own auth token
3. **Turn Detection**: Server identifies which players are AI vs human
4. **Automatic Processing**: AI turns process automatically after any human ends their turn
5. **SSE Support**: Real-time event streaming already in place

To add multiple human support:
1. Allow multiple browser sessions to join the same game
2. Each human gets their own session token
3. SSE events already broadcast to all connected clients
4. AI turn processing triggers after any human ends their turn

## SSE Event Types

The `/games/{id}/events` endpoint streams the following events:

| Event | Description |
|-------|-------------|
| `connected` | Connection established |
| `ai_thinking` | AI player is processing their turn |
| `ai_action` | AI player took an action (with details) |
| `ai_turn_complete` | All AI turns finished |
| `ai_error` | Error during AI processing |
| `turn_changed` | Current player changed |
| `game_state_changed` | Game state updated |
