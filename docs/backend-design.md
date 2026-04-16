# Catan Backend Design

## Goal

Design a complete backend for the base 3-4 player Settlers of Catan game.

This design assumes:

- Base game only. No Seafarers, Cities and Knights, or custom house rules.
- Human players only. No AI bots in the first version.
- Web client as the primary consumer.
- The server is fully authoritative. Clients never decide game outcomes.

This is intentionally not an extension of the current raw-socket C++ prototype. That code is a useful spike, but a complete game backend needs a deterministic rules engine, durable persistence, filtered player views, replay/resync support, and a transport layer that can support reconnecting clients.

## Recommended Direction

Build the backend as a modular TypeScript monolith:

- Runtime: Node 22+
- Language: TypeScript
- HTTP API: Fastify
- Realtime transport: WebSocket
- Validation: Zod
- Database: PostgreSQL
- Cache/pubsub: Redis
- Deploy shape: single service process at first, horizontally scalable later

Why this direction:

- Catan is rules-heavy, not compute-heavy.
- The hard problem is correctness and state management, not raw performance.
- TypeScript gives faster iteration, stronger API ergonomics, and a much better testing/tooling story for this project than the current hand-rolled C++ server.

If C++ is a hard requirement later, keep the same domain boundaries from this document and move only the pure game engine into C++. Do not keep the current custom HTTP server architecture.

## Product Scope

The backend fully implements:

- Lobby creation and seat management
- Private or public games
- Snake-order setup placement
- Dice rolling and resource production
- Bank resource limits
- Robber discard, move, and steal flow
- Road, settlement, and city placement validation
- Development card purchase and play rules
- Longest Road and Largest Army
- Player-to-player trade offers and responses
- Bank and port trading
- Victory detection at 10 points
- Session recovery and reconnect
- Replayable event history
- Hidden-information-safe state projections

The backend does not need, in v1:

- Matchmaking
- Ranked play
- Spectators
- Expansions
- AI bots
- In-game chat moderation

## High-Level Architecture

Use a modular monolith with clear internal boundaries:

1. `api`
   - REST endpoints for auth, lobby creation, join, reconnect, and initial state fetch
   - WebSocket for realtime game state and command submission

2. `application`
   - Command handlers
   - Game actor registry
   - Idempotency handling
   - Projection orchestration

3. `domain`
   - Game aggregate
   - Rules engine
   - Board topology
   - Deterministic validation and state transitions
   - Public/private view filtering

4. `infrastructure`
   - Postgres repositories
   - Redis pubsub and distributed coordination
   - WebSocket connection manager
   - Snapshot storage

5. `observability`
   - Metrics
   - Structured logs
   - Audit trail and replay tooling

### Runtime Shape

- Every active game is processed as a single-writer actor.
- Commands for the same `game_id` are serialized.
- The authoritative game state lives in memory while the game is active.
- Every accepted command appends domain events to Postgres.
- Snapshots are written every N events and on major transitions.
- WebSocket subscribers receive filtered state updates after each commit.

This avoids race conditions and makes the rules engine easy to reason about.

## Core Design Principles

1. Server authoritative
   - The client only sends intent.
   - The server validates legality and computes the result.

2. Event-first persistence
   - Every accepted action becomes one or more domain events.
   - Replays and debugging become practical.

3. Explicit state machine
   - The game is always in one well-defined sub-state.
   - Allowed commands depend on the current sub-state.

4. Canonical board topology
   - Do not model vertices and edges by duplicating them per adjacent hex.
   - Use fixed intersection and edge IDs for the standard board.

5. Hidden information filtering
   - The authoritative state contains all information.
   - Each client sees a filtered projection.

6. Idempotent command handling
   - Duplicate client submissions must be safe.

## Board Topology

The current prototype uses hex-direction pairs as vertex and edge identity. That is not sufficient for a complete implementation because it duplicates the same physical intersection/edge across adjacent hexes.

Use canonical IDs for the standard board:

- 19 land hexes
- 54 intersections
- 72 edges
- 9 ports

Represent topology as static data:

```ts
type HexId = string
type IntersectionId = string
type EdgeId = string

interface HexTopology {
  id: HexId
  adjacentHexIds: HexId[]
  intersectionIds: [IntersectionId, IntersectionId, IntersectionId, IntersectionId, IntersectionId, IntersectionId]
  edgeIds: [EdgeId, EdgeId, EdgeId, EdgeId, EdgeId, EdgeId]
}

interface IntersectionTopology {
  id: IntersectionId
  adjacentIntersectionIds: IntersectionId[]
  adjacentEdgeIds: EdgeId[]
  adjacentHexIds: HexId[]
  portId?: string
}

interface EdgeTopology {
  id: EdgeId
  endpointIds: [IntersectionId, IntersectionId]
  adjacentHexIds: HexId[]
}
```

Store this in a static module such as:

- `backend/src/domain/topology/base4p.ts`

### Board Randomization

At game start, generate:

- Resource hex layout
- Number token layout
- Port type layout
- Development deck order
- First player seat

Rules:

- Standard base-game resource counts
- Standard base-game number token counts
- Desert starts with robber
- Sixes and eights may not be adjacent
- Port positions are fixed on the board perimeter, but port resource types are shuffled using the standard distribution

Persist the realized layout and deck order in authoritative state. Do not rely on replaying a random seed across runtimes to reconstruct hidden outcomes.

## Domain Model

### Aggregate Root

`GameAggregate` is the single source of truth for gameplay.

```ts
interface GameAggregate {
  id: string
  ruleset: "base-4p"
  status: "lobby" | "in_progress" | "finished" | "abandoned"
  version: number
  board: BoardState
  bank: BankState
  devDeck: DevDeckState
  seats: SeatState[]
  turn: TurnState
  awards: AwardState
  trade: TradeState | null
  winnerSeatId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
```

### Board State

```ts
interface BoardState {
  hexes: Record<HexId, HexState>
  intersections: Record<IntersectionId, IntersectionState>
  edges: Record<EdgeId, EdgeState>
  robberHexId: HexId
  ports: Record<string, PortState>
}
```

`IntersectionState`:

- empty
- settlement owned by seat X
- city owned by seat X

`EdgeState`:

- empty
- road owned by seat X

### Seat State

```ts
interface SeatState {
  seatId: string
  userId: string | null
  displayName: string
  color: "red" | "blue" | "white" | "orange"
  isConnected: boolean
  resources: ResourceHand
  devCards: DevCardInstance[]
  playedKnights: number
  visibleVictoryPointCards: number
  roadsRemaining: number
  settlementsRemaining: number
  citiesRemaining: number
  hasLongestRoad: boolean
  hasLargestArmy: boolean
  isReady: boolean
}
```

`DevCardInstance` needs metadata:

```ts
interface DevCardInstance {
  id: string
  type: "knight" | "victory_point" | "road_building" | "year_of_plenty" | "monopoly"
  purchasedOnTurn: number
  revealed: boolean
  played: boolean
}
```

This is necessary to enforce "newly bought dev cards cannot be played on the same turn."

### Bank State

Track the physical card economy:

- 19 of each resource in the bank
- dev card deck count and exact remaining order

Important rule:

- If the bank cannot fully satisfy a production payout for a resource type on a roll, no one receives that resource type from that roll.

### Award State

```ts
interface AwardState {
  longestRoadSeatId: string | null
  longestRoadLength: number
  largestArmySeatId: string | null
  largestArmySize: number
}
```

## Turn State Machine

Do not use a loose enum like `MainTurn` and then special-case everything. Use an explicit state machine with payload.

```ts
type TurnState =
  | { type: "setup_place_settlement"; seatId: string; round: 1 | 2 }
  | { type: "setup_place_road"; seatId: string; round: 1 | 2; originIntersectionId: string }
  | { type: "await_roll"; seatId: string; turnNumber: number; devCardPlayed: boolean }
  | { type: "await_discards"; seatId: string; turnNumber: number; pendingSeatIds: string[]; totalRolled: 7 }
  | { type: "await_robber_move"; seatId: string; turnNumber: number; source: "rolled_7" | "knight" }
  | { type: "await_robber_steal"; seatId: string; turnNumber: number; robberHexId: string; eligibleVictimSeatIds: string[] }
  | { type: "main_turn"; seatId: string; turnNumber: number; devCardPlayed: boolean }
  | { type: "resolving_road_building"; seatId: string; turnNumber: number; roadsLeftToPlace: 1 | 2 }
  | { type: "resolving_year_of_plenty"; seatId: string; turnNumber: number; picksLeft: 1 | 2; selected: Resource[] }
  | { type: "await_trade_responses"; seatId: string; offerId: string; pendingSeatIds: string[] }
  | { type: "finished"; winnerSeatId: string }
```

This makes command validity obvious.

## Command Model

All gameplay mutations enter through commands.

Each command envelope:

```ts
interface CommandEnvelope<TPayload> {
  commandId: string
  gameId: string
  actorUserId: string
  actorSeatId: string | null
  expectedVersion: number
  submittedAt: string
  payload: TPayload
}
```

### Lobby Commands

- `CreateLobby`
- `JoinLobby`
- `LeaveLobby`
- `SetReady`
- `StartGame`
- `ReconnectSeat`

### Gameplay Commands

- `PlaceSetupSettlement`
- `PlaceSetupRoad`
- `RollDice`
- `DiscardCards`
- `MoveRobber`
- `StealRandomCard`
- `BuildRoad`
- `BuildSettlement`
- `BuildCity`
- `BuyDevelopmentCard`
- `PlayKnight`
- `PlayRoadBuilding`
- `PlayYearOfPlenty`
- `PlayMonopoly`
- `RevealVictoryPointCards`
- `OfferTrade`
- `RespondToTrade`
- `CancelTrade`
- `TradeWithBank`
- `EndTurn`
- `ResignGame`

Each command handler:

1. Loads the aggregate
2. Validates `expectedVersion`
3. Validates actor permissions
4. Validates legality against current `TurnState`
5. Emits domain events
6. Applies events to produce the next aggregate state
7. Persists events and snapshot
8. Broadcasts updated projections

## Event Model

The event store is the canonical history.

Representative events:

- `LobbyCreated`
- `SeatJoined`
- `SeatLeft`
- `SeatReadied`
- `GameStarted`
- `SetupSettlementPlaced`
- `SetupRoadPlaced`
- `InitialResourcesGrantedFromSecondSettlement`
- `TurnStarted`
- `DiceRolled`
- `ResourcesProduced`
- `ProductionBlockedByEmptyBank`
- `DiscardRequired`
- `CardsDiscarded`
- `RobberMoved`
- `ResourceStolen`
- `RoadBuilt`
- `SettlementBuilt`
- `CityBuilt`
- `DevelopmentCardPurchased`
- `KnightPlayed`
- `RoadBuildingPlayed`
- `YearOfPlentyPlayed`
- `MonopolyPlayed`
- `BankTradeCompleted`
- `PlayerTradeOffered`
- `PlayerTradeAccepted`
- `PlayerTradeDeclined`
- `PlayerTradeCompleted`
- `LongestRoadAwarded`
- `LargestArmyAwarded`
- `VictoryPointsRevealed`
- `GameWon`
- `GameResigned`
- `PlayerDisconnected`
- `PlayerReconnected`

Events should be small, explicit, and enough to reconstruct state without hidden side effects.

## Full Rules Coverage

### Setup Phase

Flow:

1. Seats 1 -> N place settlement
2. Seats 1 -> N place road adjacent to that settlement
3. Seats N -> 1 place settlement
4. Seats N -> 1 place road adjacent to that settlement
5. After the second settlement, grant resources from adjacent non-desert hexes
6. First turn starts with seat 1

Validation:

- Settlement must be on an empty intersection
- Distance rule: no adjacent settlement/city on neighboring intersections
- Road must touch the newly placed setup settlement

### Dice and Production

On `RollDice`:

- Record the two dice values in an event
- If total is 7, move to discard flow
- Otherwise compute production per resource type

Production algorithm:

1. Find hexes matching the rolled number and not blocked by robber
2. Determine payouts by settlement/city
3. Group payouts by resource type
4. For each resource type:
   - if bank has enough cards for all recipients, distribute all
   - else distribute none for that resource type

### Robber

For a roll of 7 or a Knight:

1. If any player has more than 7 resource cards, require discard
2. Each such player must discard `floor(totalCards / 2)`
3. Active player moves robber to a new hex
4. If there are adjacent opponent settlements/cities with cards, active player chooses a victim
5. Server steals one random resource card from the victim

### Building

#### Road

Requirements:

- Actor is in an allowed turn state
- Actor can pay or has free road placement from Road Building
- Edge is empty
- Edge is connected to actor's road network or building, unless it is a setup road
- Edge is not blocked by an opponent building that breaks continuity where relevant

#### Settlement

Requirements:

- Actor can pay
- Intersection is empty
- Distance rule holds
- Intersection connects to actor road network
- Actor has settlements remaining

#### City

Requirements:

- Actor can pay
- Intersection currently contains actor settlement
- Actor has cities remaining

### Development Cards

Purchase:

- Costs 1 wheat, 1 sheep, 1 ore
- Requires dev deck not empty
- Drawn card is hidden from other players
- Purchased card cannot be played on the same turn unless it is only contributing hidden victory points at game-end evaluation

Play rules:

- Only one non-victory development card may be played per turn
- Knight:
  - move robber
  - steal if eligible
  - increment knight count
  - re-evaluate Largest Army
- Road Building:
  - place up to 2 free roads legally
  - if only one road is legally placeable, allow one
- Year of Plenty:
  - take any two resource cards from bank, subject to availability
- Monopoly:
  - choose a resource type
  - take all cards of that type from every other player
- Victory Point:
  - hidden until revealed or game win calculation

### Trading

#### Bank/Port Trade

Support:

- 4:1 generic
- 3:1 generic port
- 2:1 specific port

Port ownership rule:

- A player has access to a port if they own a settlement or city on either intersection of that port

Use the best applicable ratio.

#### Player Trade

Simplify the interaction to a clean server flow:

1. Active player creates an offer
2. Offer targets all other players or a specific player
3. Each target may `accept` or `decline`
4. If one target accepts, the active player may finalize with that target
5. Once completed or canceled, return to `main_turn`

This avoids free-form counteroffers in v1 while still fully supporting legal base-game player trading.

### Longest Road

Implement Longest Road with a graph search over the player's road graph.

Rules to respect:

- Minimum length is 5
- An opponent settlement/city at an intersection breaks continuity through that node
- Forks are allowed, but only the longest simple path counts
- Ties do not transfer the award unless a player strictly exceeds the current holder

For a 72-edge board, recomputing after every road placement is acceptable.

Recommended implementation:

- Build the player's traversable road graph
- For each endpoint, DFS over simple edge paths
- Block traversal through intersections occupied by opponents
- Compute the max path length

### Largest Army

- Award at 3 played Knights
- Ties do not transfer the award
- Transfer only on strict exceed

### Victory Detection

Check victory after every state-changing event that can affect points:

- settlement built
- city built
- longest road changed
- largest army changed
- victory point card revealed
- hidden victory point card count changes

Victory total:

- settlements: 1 each
- cities: 2 each
- longest road: 2
- largest army: 2
- victory point dev cards: 1 each

End the game immediately when a player reaches 10 or more points during their turn.

## Public and Private Views

Do not send the raw aggregate to clients.

Generate:

1. `GameViewPublic`
   - board
   - turn state summary
   - seat order
   - each player's public building counts
   - each player's total resource card count, not composition
   - each player's total dev card count, not hidden types
   - revealed awards
   - revealed played knights
   - active trade summary

2. `GameViewPrivate`
   - everything in public view
   - your exact resource hand
   - your exact dev cards
   - your legal actions
   - any prompts you must answer

This filtered projection is mandatory. Without it, the client can cheat.

## API Surface

Use REST for setup and WebSocket for active gameplay.

### REST Endpoints

#### Auth and Session

- `POST /v1/auth/guest`
  - creates a guest identity and session token

- `POST /v1/auth/reconnect`
  - exchanges a reconnect token for a fresh session

#### Lobby

- `POST /v1/lobbies`
- `GET /v1/lobbies/:lobbyId`
- `POST /v1/lobbies/:lobbyId/join`
- `POST /v1/lobbies/:lobbyId/leave`
- `POST /v1/lobbies/:lobbyId/ready`
- `POST /v1/lobbies/:lobbyId/start`

#### Game State

- `GET /v1/games/:gameId`
  - returns the caller's private view

- `GET /v1/games/:gameId/history`
  - paginated filtered event history for replay UI

### WebSocket

Single socket per client:

- client authenticates with bearer token
- client subscribes to lobby or game channels
- server pushes view updates after every accepted command

Client -> server messages:

```json
{
  "type": "submit_command",
  "payload": {
    "commandId": "cmd_123",
    "gameId": "game_456",
    "expectedVersion": 38,
    "kind": "BuildRoad",
    "body": {
      "edgeId": "E17"
    }
  }
}
```

Server -> client messages:

- `command_accepted`
- `command_rejected`
- `game_view_updated`
- `presence_updated`
- `desynced_requery_required`

`command_rejected` must include machine-readable reason codes such as:

- `not_your_turn`
- `invalid_phase`
- `insufficient_resources`
- `edge_occupied`
- `intersection_too_close`
- `bank_insufficient`
- `version_conflict`

## Persistence Model

Use Postgres as the source of truth.

### Tables

#### `users`

- `id`
- `display_name`
- `created_at`
- `is_guest`

#### `sessions`

- `id`
- `user_id`
- `access_token_hash`
- `reconnect_token_hash`
- `expires_at`
- `created_at`
- `last_seen_at`

#### `games`

- `id`
- `status`
- `ruleset`
- `version`
- `created_at`
- `started_at`
- `finished_at`
- `winner_seat_id`

#### `game_seats`

- `game_id`
- `seat_id`
- `user_id`
- `display_name`
- `color`
- `joined_at`

#### `game_events`

- `game_id`
- `version`
- `event_id`
- `event_type`
- `actor_user_id`
- `actor_seat_id`
- `payload_json`
- `created_at`

Unique constraint:

- `(game_id, version)`
- `(game_id, event_id)`

#### `game_snapshots`

- `game_id`
- `version`
- `snapshot_json`
- `created_at`

#### `processed_commands`

- `game_id`
- `command_id`
- `result_json`
- `created_at`

This is the idempotency table.

### Snapshot Strategy

Write a snapshot:

- every 25 events
- at `GameStarted`
- after each full turn
- at `GameWon`

This keeps recovery fast without overcomplicating storage.

## Concurrency and Scaling

### Single-Writer Game Actors

For each active game:

- exactly one process owns command execution at a time
- all commands for that game are processed sequentially

Initial implementation:

- route all commands through one service instance
- use an in-memory actor map keyed by `game_id`

Scalable implementation:

- hash `game_id` to a shard
- use Redis or queue-based routing so a single worker owns that shard

Do not attempt multi-writer updates on the same game row. This is a turn-based game, not a collaborative document editor.

### Optimistic Concurrency

Every command carries `expectedVersion`.

If the stored game version differs:

- reject with `version_conflict`
- client refetches or waits for the next pushed view

## Reconnect and Presence

Requirements:

- a player can refresh and recover their seat
- a temporary disconnect does not forfeit the game
- presence updates do not mutate gameplay state except connection flags

Design:

- Access token for active auth
- Reconnect token stored client-side for seat recovery
- WebSocket heartbeat updates `last_seen_at`
- Disconnect sets `isConnected = false`
- Reconnect restores the same seat and resubscribes to the game stream

## Timeouts and Abandonment

v1 should support these administrative rules even if the UI uses them later:

- lobby inactivity timeout
- long disconnect warnings
- optional turn timer
- resignation
- abandon game if all players leave before start

Do not auto-skip turns in the first implementation unless you have a clear product rule for it.

## Security Model

1. Never trust client-computed legality
2. Never expose full authoritative state to clients
3. Hash access and reconnect tokens at rest
4. Validate every incoming payload with Zod
5. Rate-limit command submission per connection
6. Audit all accepted commands and server-generated random outcomes

## Testing Strategy

This backend is only complete if the rules engine is exhaustively tested.

### Unit Tests

Target pure domain functions:

- setup placement validation
- road connectivity
- settlement distance rule
- city upgrade rule
- resource production calculation
- bank insufficiency handling
- port ratio calculation
- dev card play rules
- Longest Road path calculation
- Largest Army transfer
- victory calculation

### Scenario Tests

Use event-driven fixtures to simulate full games:

- two-player illegal start rejected
- correct snake-order setup
- second settlement grants starting resources
- roll produces correct resources
- roll of 7 forces correct discards
- robber move and steal
- build sequence updates state and bank correctly
- Road Building with only one legal road
- Monopoly drains all matching resources
- award transfer edge cases
- win with hidden victory point card

### Property Tests

Good candidates:

- resource counts are conserved across bank + players
- piece counts never exceed official limits
- no intersection can contain both settlement and city
- no edge can contain multiple roads
- game version strictly increases

### Integration Tests

Test:

- REST auth and lobby flow
- WebSocket subscription lifecycle
- duplicate command idempotency
- reconnect after socket drop
- event replay from snapshot + tail events

## Observability

Emit structured logs with:

- `game_id`
- `command_id`
- `event_version`
- `actor_user_id`
- `actor_seat_id`
- `turn_state`
- latency

Metrics:

- active games
- connected players
- commands per second
- command rejection rate by reason
- actor queue depth
- snapshot load time
- replay time

Admin tooling:

- replay a game by `game_id`
- inspect current private/public state projections
- inspect event stream for a turn

## Suggested Repo Layout

```text
backend/
  src/
    api/
      http/
      websocket/
      schemas/
    application/
      commands/
      handlers/
      projections/
      actors/
    domain/
      game/
        aggregate.ts
        reducer.ts
        commands.ts
        events.ts
        rules/
      topology/
        base4p.ts
      projections/
        publicView.ts
        privateView.ts
    infrastructure/
      db/
      redis/
      auth/
      repos/
    observability/
  test/
    unit/
    scenario/
    integration/
```

Keep the existing `catan_api` directory only as a prototype reference until the new backend exists. Do not keep shipping code out of that prototype.

## Implementation Plan

### Phase 1: Foundation

- Create backend service skeleton
- Add auth, lobby, and session tables
- Add board topology module
- Add event store and snapshot store

### Phase 2: Core Game Engine

- Implement aggregate and reducer
- Implement setup flow
- Implement roll, production, robber, and turn progression
- Implement building rules and bank accounting

### Phase 3: Advanced Rules

- Implement dev cards
- Implement player trade and bank/port trade
- Implement Longest Road and Largest Army
- Implement victory detection

### Phase 4: Transport and Recovery

- Add WebSocket subscriptions
- Add reconnect flow
- Add filtered public/private projections
- Add history endpoint

### Phase 5: Hardening

- Exhaustive scenario tests
- Property tests
- Metrics and admin replay tooling
- Abuse/rate-limit protections

## Non-Negotiable Corrections To The Current Prototype

Before any serious implementation starts, these current design assumptions must be discarded:

1. Raw socket HTTP parsing in application code
   - replace with a real HTTP/WebSocket framework

2. Duplicate board geometry identity
   - replace with canonical topology IDs

3. Counter-only build actions
   - all builds must mutate the actual board

4. Loose phase enums
   - replace with explicit turn-state payloads

5. Unfiltered state responses
   - replace with public/private projections

6. In-memory-only game storage
   - replace with persisted events and snapshots

7. Placeholder setup shortcut
   - implement real snake-order setup and starting resources

## Success Criteria

The backend is complete when all of the following are true:

- A full base-game match can be played to completion with no manual intervention
- Illegal moves are rejected with deterministic reason codes
- A disconnected client can reconnect and recover the same private state
- Hidden information is never leaked to the wrong player
- A game can be replayed from stored events and reach the same final result
- Rule coverage is backed by automated tests, especially for robber, dev cards, trading, and award edge cases
