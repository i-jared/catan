import { Pool, type PoolClient } from 'pg'
import { makeId } from '../util/random.js'
import { RuleError } from '../util/errors.js'
import type { GameAggregate, GameEvent } from '../domain/game/types.js'

export interface PersistedSession {
  sessionId: string
  userId: string
  displayName: string
  isGuest: boolean
  accessTokenHash: string
  reconnectTokenHash: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string | null
}

export interface CreateSessionInput {
  sessionId: string
  userId: string
  displayName: string
  isGuest: boolean
  accessTokenHash: string
  reconnectTokenHash: string
  createdAt: string
  expiresAt: string | null
}

export interface CommandResult {
  game: GameAggregate
  events: GameEvent[]
}

export interface SaveCommandResultInput {
  gameId: string
  previousVersion: number
  game: GameAggregate
  events: GameEvent[]
  commandId?: string | undefined
  actorUserId?: string | undefined
  actorSeatId?: string | undefined
}

export interface BackendStore {
  createSession(input: CreateSessionInput): Promise<void>
  getSessionByAccessTokenHash(accessTokenHash: string): Promise<PersistedSession | null>
  getSessionByReconnectTokenHash(reconnectTokenHash: string): Promise<PersistedSession | null>
  rotateAccessToken(sessionId: string, accessTokenHash: string, lastSeenAt: string): Promise<PersistedSession>
  touchSession(sessionId: string, lastSeenAt: string): Promise<void>
  createGame(game: GameAggregate, initialEvents: GameEvent[]): Promise<void>
  getGame(gameId: string): Promise<GameAggregate | null>
  getHistory(gameId: string): Promise<GameEvent[]>
  getProcessedCommand(gameId: string, commandId: string): Promise<CommandResult | null>
  saveCommandResult(input: SaveCommandResultInput): Promise<CommandResult>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class InMemoryStore implements BackendStore {
  private readonly sessionsByAccessTokenHash = new Map<string, PersistedSession>()
  private readonly sessionsByReconnectTokenHash = new Map<string, PersistedSession>()
  private readonly games = new Map<string, GameAggregate>()
  private readonly events = new Map<string, GameEvent[]>()
  private readonly processedCommands = new Map<string, Map<string, CommandResult>>()

  async createSession(input: CreateSessionInput): Promise<void> {
    const persisted: PersistedSession = {
      ...input,
      lastSeenAt: input.createdAt,
    }
    this.sessionsByAccessTokenHash.set(input.accessTokenHash, clone(persisted))
    this.sessionsByReconnectTokenHash.set(input.reconnectTokenHash, clone(persisted))
  }

  async getSessionByAccessTokenHash(accessTokenHash: string): Promise<PersistedSession | null> {
    return clone(this.sessionsByAccessTokenHash.get(accessTokenHash) ?? null)
  }

  async getSessionByReconnectTokenHash(reconnectTokenHash: string): Promise<PersistedSession | null> {
    return clone(this.sessionsByReconnectTokenHash.get(reconnectTokenHash) ?? null)
  }

  async rotateAccessToken(sessionId: string, accessTokenHash: string, lastSeenAt: string): Promise<PersistedSession> {
    const session = [...this.sessionsByAccessTokenHash.values()].find((candidate) => candidate.sessionId === sessionId)
    if (!session) {
      throw new RuleError('invalid_reconnect_token', 'Reconnect token is invalid')
    }
    this.sessionsByAccessTokenHash.delete(session.accessTokenHash)
    const updated = {
      ...session,
      accessTokenHash,
      lastSeenAt,
    }
    this.sessionsByAccessTokenHash.set(accessTokenHash, clone(updated))
    this.sessionsByReconnectTokenHash.set(updated.reconnectTokenHash, clone(updated))
    return clone(updated)
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    const session = [...this.sessionsByAccessTokenHash.values()].find((candidate) => candidate.sessionId === sessionId)
    if (!session) {
      return
    }
    const updated = {
      ...session,
      lastSeenAt,
    }
    this.sessionsByAccessTokenHash.set(updated.accessTokenHash, clone(updated))
    this.sessionsByReconnectTokenHash.set(updated.reconnectTokenHash, clone(updated))
  }

  async createGame(game: GameAggregate, initialEvents: GameEvent[]): Promise<void> {
    this.games.set(game.id, clone(game))
    this.events.set(game.id, clone(initialEvents))
    this.processedCommands.set(game.id, new Map())
  }

  async getGame(gameId: string): Promise<GameAggregate | null> {
    return clone(this.games.get(gameId) ?? null)
  }

  async getHistory(gameId: string): Promise<GameEvent[]> {
    return clone(this.events.get(gameId) ?? [])
  }

  async getProcessedCommand(gameId: string, commandId: string): Promise<CommandResult | null> {
    const existing = this.processedCommands.get(gameId)?.get(commandId) ?? null
    return clone(existing)
  }

  async saveCommandResult(input: SaveCommandResultInput): Promise<CommandResult> {
    const currentGame = this.games.get(input.gameId)
    if (!currentGame) {
      throw new RuleError('game_not_found', 'Game not found')
    }
    if (currentGame.version !== input.previousVersion) {
      throw new RuleError('version_conflict', `Expected version ${input.previousVersion}, got ${currentGame.version}`)
    }
    this.games.set(input.gameId, clone(input.game))
    this.events.set(input.gameId, [...(this.events.get(input.gameId) ?? []), ...clone(input.events)])
    const result = {
      game: clone(input.game),
      events: clone(input.events),
    }
    if (input.commandId) {
      const processed = this.processedCommands.get(input.gameId) ?? new Map()
      processed.set(input.commandId, clone(result))
      this.processedCommands.set(input.gameId, processed)
    }
    return result
  }
}

export class PostgresStore implements BackendStore {
  constructor(private readonly pool: Pool) {}

  async createSession(input: CreateSessionInput): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `
          insert into users (id, display_name, is_guest, created_at)
          values ($1, $2, $3, $4)
          on conflict (id) do update
          set display_name = excluded.display_name,
              is_guest = excluded.is_guest
        `,
        [input.userId, input.displayName, input.isGuest, input.createdAt],
      )
      await client.query(
        `
          insert into sessions (
            id, user_id, access_token_hash, reconnect_token_hash, expires_at, created_at, last_seen_at
          )
          values ($1, $2, $3, $4, $5, $6, $6)
        `,
        [
          input.sessionId,
          input.userId,
          input.accessTokenHash,
          input.reconnectTokenHash,
          input.expiresAt,
          input.createdAt,
        ],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async getSessionByAccessTokenHash(accessTokenHash: string): Promise<PersistedSession | null> {
    const result = await this.pool.query(
      `
        select
          s.id as session_id,
          u.id as user_id,
          u.display_name,
          u.is_guest,
          s.access_token_hash,
          s.reconnect_token_hash,
          s.created_at,
          s.last_seen_at,
          s.expires_at
        from sessions s
        join users u on u.id = s.user_id
        where s.access_token_hash = $1
        limit 1
      `,
      [accessTokenHash],
    )
    return result.rows[0] ? mapSessionRow(result.rows[0]) : null
  }

  async getSessionByReconnectTokenHash(reconnectTokenHash: string): Promise<PersistedSession | null> {
    const result = await this.pool.query(
      `
        select
          s.id as session_id,
          u.id as user_id,
          u.display_name,
          u.is_guest,
          s.access_token_hash,
          s.reconnect_token_hash,
          s.created_at,
          s.last_seen_at,
          s.expires_at
        from sessions s
        join users u on u.id = s.user_id
        where s.reconnect_token_hash = $1
        limit 1
      `,
      [reconnectTokenHash],
    )
    return result.rows[0] ? mapSessionRow(result.rows[0]) : null
  }

  async rotateAccessToken(sessionId: string, accessTokenHash: string, lastSeenAt: string): Promise<PersistedSession> {
    await this.pool.query(
      `
        update sessions
        set access_token_hash = $2,
            last_seen_at = $3
        where id = $1
      `,
      [sessionId, accessTokenHash, lastSeenAt],
    )
    const result = await this.pool.query(
      `
        select
          s.id as session_id,
          u.id as user_id,
          u.display_name,
          u.is_guest,
          s.access_token_hash,
          s.reconnect_token_hash,
          s.created_at,
          s.last_seen_at,
          s.expires_at
        from sessions s
        join users u on u.id = s.user_id
        where s.id = $1
        limit 1
      `,
      [sessionId],
    )
    if (!result.rows[0]) {
      throw new RuleError('invalid_reconnect_token', 'Reconnect token is invalid')
    }
    return mapSessionRow(result.rows[0])
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    await this.pool.query(
      `
        update sessions
        set last_seen_at = $2
        where id = $1
      `,
      [sessionId, lastSeenAt],
    )
  }

  async createGame(game: GameAggregate, initialEvents: GameEvent[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await writeGameState(client, game)
      await writeEvents(client, game.id, 0, initialEvents, undefined, undefined)
      await client.query(
        `
          insert into game_snapshots (game_id, version, snapshot_json, created_at)
          values ($1, $2, $3::jsonb, now())
        `,
        [game.id, game.version, JSON.stringify(game)],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async getGame(gameId: string): Promise<GameAggregate | null> {
    const result = await this.pool.query(
      `
        select snapshot_json
        from game_snapshots
        where game_id = $1
        order by version desc
        limit 1
      `,
      [gameId],
    )
    return result.rows[0]?.snapshot_json ?? null
  }

  async getHistory(gameId: string): Promise<GameEvent[]> {
    const result = await this.pool.query(
      `
        select payload_json
        from game_events
        where game_id = $1
        order by version asc
      `,
      [gameId],
    )
    return result.rows.map((row) => row.payload_json as GameEvent)
  }

  async getProcessedCommand(gameId: string, commandId: string): Promise<CommandResult | null> {
    const result = await this.pool.query(
      `
        select result_json
        from processed_commands
        where game_id = $1 and command_id = $2
        limit 1
      `,
      [gameId, commandId],
    )
    return result.rows[0]?.result_json ?? null
  }

  async saveCommandResult(input: SaveCommandResultInput): Promise<CommandResult> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      if (input.commandId) {
        const existing = await client.query(
          `
            select result_json
            from processed_commands
            where game_id = $1 and command_id = $2
            limit 1
          `,
          [input.gameId, input.commandId],
        )
        if (existing.rows[0]) {
          await client.query('commit')
          return existing.rows[0].result_json as CommandResult
        }
      }

      const versionResult = await client.query(
        `
          select version
          from games
          where id = $1
          for update
        `,
        [input.gameId],
      )
      if (!versionResult.rows[0]) {
        throw new RuleError('game_not_found', 'Game not found')
      }
      const currentVersion = Number(versionResult.rows[0].version)
      if (currentVersion !== input.previousVersion) {
        throw new RuleError('version_conflict', `Expected version ${input.previousVersion}, got ${currentVersion}`)
      }

      await writeGameState(client, input.game)
      await writeEvents(
        client,
        input.gameId,
        input.previousVersion,
        input.events,
        input.actorUserId,
        input.actorSeatId,
      )
      await client.query(
        `
          insert into game_snapshots (game_id, version, snapshot_json, created_at)
          values ($1, $2, $3::jsonb, now())
        `,
        [input.gameId, input.game.version, JSON.stringify(input.game)],
      )

      const result: CommandResult = {
        game: input.game,
        events: input.events,
      }
      if (input.commandId) {
        await client.query(
          `
            insert into processed_commands (game_id, command_id, result_json, created_at)
            values ($1, $2, $3::jsonb, now())
          `,
          [input.gameId, input.commandId, JSON.stringify(result)],
        )
      }

      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
}

export async function createStoreFromEnv(): Promise<BackendStore> {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production')
    }
    return new InMemoryStore()
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 20),
  })
  return new PostgresStore(pool)
}

async function writeGameState(
  client: PoolClient,
  game: GameAggregate,
): Promise<void> {
  await client.query(
    `
      insert into games (id, status, ruleset, version, winner_seat_id, created_at, started_at, finished_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (id) do update
      set status = excluded.status,
          ruleset = excluded.ruleset,
          version = excluded.version,
          winner_seat_id = excluded.winner_seat_id,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at
    `,
    [
      game.id,
      game.status,
      game.ruleset,
      game.version,
      game.winnerSeatId,
      game.createdAt,
      game.startedAt,
      game.finishedAt,
    ],
  )
  await client.query('delete from game_seats where game_id = $1', [game.id])
  for (const seat of game.seats) {
    await client.query(
      `
        insert into game_seats (game_id, seat_id, user_id, display_name, color, joined_at)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        game.id,
        seat.seatId,
        seat.userId,
        seat.displayName,
        seat.color,
        seat.userId ? game.createdAt : null,
      ],
    )
  }
}

async function writeEvents(
  client: PoolClient,
  gameId: string,
  previousVersion: number,
  events: GameEvent[],
  actorUserId: string | undefined,
  actorSeatId: string | undefined,
): Promise<void> {
  for (const [index, event] of events.entries()) {
    await client.query(
      `
        insert into game_events (
          game_id, version, event_id, event_type, actor_user_id, actor_seat_id, payload_json, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      `,
      [
        gameId,
        previousVersion + index + 1,
        makeId('evt'),
        event.type,
        actorUserId ?? null,
        actorSeatId ?? null,
        JSON.stringify(event),
      ],
    )
  }
}

function mapSessionRow(row: Record<string, unknown>): PersistedSession {
  return {
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    isGuest: Boolean(row.is_guest),
    accessTokenHash: String(row.access_token_hash),
    reconnectTokenHash: String(row.reconnect_token_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
  }
}
