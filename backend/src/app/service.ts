import { createLobbyGameResult, decide, applyEvents } from '../domain/game/engine.js'
import { filterHistoryEvents, toPrivateView } from '../domain/game/views.js'
import type { GameAggregate, GameCommand, GameEvent } from '../domain/game/types.js'
import { makeId, DefaultRandomSource } from '../util/random.js'
import { RuleError } from '../util/errors.js'
import { hashToken } from '../infra/token-hash.js'
import type { BackendStore, CommandResult, PersistedSession } from '../infra/store.js'

interface SessionTokens {
  userId: string
  displayName: string
  accessToken: string
  reconnectToken: string
}

interface AuthenticatedSession {
  sessionId: string
  userId: string
  displayName: string
  isGuest: boolean
}

export interface CommandEnvelope {
  commandId?: string | undefined
  expectedVersion?: number | undefined
  command: GameCommand
}

export class CatanService {
  private readonly random = new DefaultRandomSource()

  constructor(private readonly store: BackendStore) {}

  async createGuest(displayName: string): Promise<SessionTokens> {
    const createdAt = new Date().toISOString()
    const accessToken = makeId('access')
    const reconnectToken = makeId('reconnect')
    const response = {
      userId: makeId('user'),
      displayName: displayName.trim(),
      accessToken,
      reconnectToken,
    }
    await this.store.createSession({
      sessionId: makeId('session'),
      userId: response.userId,
      displayName: response.displayName,
      isGuest: true,
      accessTokenHash: hashToken(accessToken),
      reconnectTokenHash: hashToken(reconnectToken),
      createdAt,
      expiresAt: null,
    })
    return response
  }

  async reconnect(reconnectToken: string): Promise<SessionTokens> {
    const persisted = await this.store.getSessionByReconnectTokenHash(hashToken(reconnectToken))
    if (!persisted) {
      throw new RuleError('invalid_reconnect_token', 'Reconnect token is invalid')
    }
    const accessToken = makeId('access')
    await this.store.rotateAccessToken(
      persisted.sessionId,
      hashToken(accessToken),
      new Date().toISOString(),
    )
    return {
      userId: persisted.userId,
      displayName: persisted.displayName,
      accessToken,
      reconnectToken,
    }
  }

  async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const persisted = await this.store.getSessionByAccessTokenHash(hashToken(accessToken))
    if (!persisted) {
      throw new RuleError('unauthorized', 'Access token is invalid')
    }
    await this.store.touchSession(persisted.sessionId, new Date().toISOString())
    return toAuthenticatedSession(persisted)
  }

  async createLobby(accessToken: string): Promise<GameAggregate> {
    const session = await this.authenticate(accessToken)
    const now = new Date().toISOString()
    const gameId = makeId('game')
    const { game, events } = createLobbyGameResult(gameId, session.userId, session.displayName, now)
    await this.store.createGame(game, events)
    return game
  }

  async getGame(gameId: string): Promise<GameAggregate> {
    const game = await this.store.getGame(gameId)
    if (!game) {
      throw new RuleError('game_not_found', 'Game not found')
    }
    return game
  }

  async getSeatForUser(gameId: string, userId: string): Promise<string | null> {
    const game = await this.getGame(gameId)
    return game.seats.find((seat) => seat.userId === userId)?.seatId ?? null
  }

  async joinLobby(accessToken: string, gameId: string): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    return this.applyCommand(gameId, {
      command: {
        type: 'JoinLobby',
        userId: session.userId,
        displayName: session.displayName,
      },
      actorUserId: session.userId,
    })
  }

  async leaveLobby(accessToken: string, gameId: string): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    const seatId = await this.requireSeatOwnership(gameId, session.userId)
    return this.applyCommand(gameId, {
      command: {
        type: 'LeaveLobby',
        seatId,
      },
      actorUserId: session.userId,
      actorSeatId: seatId,
    })
  }

  async setReady(accessToken: string, gameId: string, ready: boolean): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    const seatId = await this.requireSeatOwnership(gameId, session.userId)
    return this.applyCommand(gameId, {
      command: {
        type: 'SetReady',
        seatId,
        ready,
      },
      actorUserId: session.userId,
      actorSeatId: seatId,
    })
  }

  async startGame(accessToken: string, gameId: string): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    const seatId = await this.requireSeatOwnership(gameId, session.userId)
    return this.applyCommand(gameId, {
      command: {
        type: 'StartGame',
        seatId,
      },
      actorUserId: session.userId,
      actorSeatId: seatId,
    })
  }

  async getPrivateView(accessToken: string, gameId: string) {
    const session = await this.authenticate(accessToken)
    const game = await this.getGame(gameId)
    const seatId = game.seats.find((seat) => seat.userId === session.userId)?.seatId ?? ''
    return toPrivateView(game, seatId)
  }

  async getHistory(accessToken: string, gameId: string) {
    const session = await this.authenticate(accessToken)
    const game = await this.getGame(gameId)
    const seatId = game.seats.find((seat) => seat.userId === session.userId)?.seatId ?? null
    return filterHistoryEvents(game, seatId, await this.store.getHistory(gameId))
  }

  async submitGameCommand(
    accessToken: string,
    gameId: string,
    envelope: CommandEnvelope | GameCommand,
  ): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    const seatId = await this.requireSeatOwnership(gameId, session.userId)
    const normalizedEnvelope = isCommandEnvelope(envelope)
      ? envelope
      : { command: envelope }
    const { command } = normalizedEnvelope
    if ('seatId' in command && command.seatId !== seatId) {
      throw new RuleError('forbidden', 'Command seat does not match the authenticated user')
    }
    return this.applyCommand(gameId, {
      ...normalizedEnvelope,
      actorUserId: session.userId,
      actorSeatId: seatId,
    })
  }

  async setPresence(accessToken: string, gameId: string, connected: boolean): Promise<CommandResult> {
    const session = await this.authenticate(accessToken)
    const seatId = await this.requireSeatOwnership(gameId, session.userId)
    const game = await this.getGame(gameId)
    const seat = game.seats.find((candidate) => candidate.seatId === seatId)
    if (!seat) {
      throw new RuleError('seat_not_found', 'Seat not found')
    }
    if (seat.isConnected === connected) {
      return {
        game,
        events: [],
      }
    }

    const event: GameEvent = {
      type: 'PlayerConnected',
      seatId,
      connected,
      timestamp: new Date().toISOString(),
    }
    return this.applyCommand(gameId, {
      command: {
        type: 'SetReady',
        seatId,
        ready: seat.isReady,
      },
      actorUserId: session.userId,
      actorSeatId: seatId,
      overrideEvents: [event],
    })
  }

  private async applyCommand(
    gameId: string,
    envelope: CommandEnvelope & {
      actorUserId?: string | undefined
      actorSeatId?: string | undefined
      overrideEvents?: GameEvent[] | undefined
    },
  ): Promise<CommandResult> {
    const game = await this.getGame(gameId)

    if (envelope.commandId) {
      const processed = await this.store.getProcessedCommand(gameId, envelope.commandId)
      if (processed) {
        return processed
      }
    }

    if (envelope.expectedVersion !== undefined && envelope.expectedVersion !== game.version) {
      throw new RuleError(
        'version_conflict',
        `Expected version ${envelope.expectedVersion}, got ${game.version}`,
      )
    }

    const events = envelope.overrideEvents ?? decide(game, envelope.command, {
      now: () => new Date().toISOString(),
      random: this.random,
    })
    const next = applyEvents(game, events)

    return this.store.saveCommandResult({
      gameId,
      previousVersion: game.version,
      game: next,
      events,
      commandId: envelope.commandId,
      actorUserId: envelope.actorUserId,
      actorSeatId: envelope.actorSeatId,
    })
  }

  private async requireSeatOwnership(gameId: string, userId: string): Promise<string> {
    const seatId = await this.getSeatForUser(gameId, userId)
    if (!seatId) {
      throw new RuleError('forbidden', 'User is not seated in this game')
    }
    return seatId
  }
}

function isCommandEnvelope(value: CommandEnvelope | GameCommand): value is CommandEnvelope {
  return 'command' in value
}

function toAuthenticatedSession(persisted: PersistedSession): AuthenticatedSession {
  return {
    sessionId: persisted.sessionId,
    userId: persisted.userId,
    displayName: persisted.displayName,
    isGuest: persisted.isGuest,
  }
}
