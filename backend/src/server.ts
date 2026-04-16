import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { z } from 'zod'
import { CatanService } from './app/service.js'
import { RuleError } from './util/errors.js'
import { resources } from './domain/game/resources.js'
import { createStoreFromEnv } from './infra/store.js'

const resourceEnum = z.enum(resources)
const resourceHandSchema = z.object({
  wood: z.number().int().min(0),
  brick: z.number().int().min(0),
  sheep: z.number().int().min(0),
  wheat: z.number().int().min(0),
  ore: z.number().int().min(0),
})

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PlaceSetupSettlement'),
    seatId: z.string(),
    intersectionId: z.string(),
  }),
  z.object({
    type: z.literal('PlaceSetupRoad'),
    seatId: z.string(),
    edgeId: z.string(),
  }),
  z.object({
    type: z.literal('RollDice'),
    seatId: z.string(),
  }),
  z.object({
    type: z.literal('DiscardCards'),
    seatId: z.string(),
    cards: resourceHandSchema,
  }),
  z.object({
    type: z.literal('MoveRobber'),
    seatId: z.string(),
    hexId: z.string(),
  }),
  z.object({
    type: z.literal('StealRandomCard'),
    seatId: z.string(),
    fromSeatId: z.string(),
  }),
  z.object({
    type: z.literal('BuildRoad'),
    seatId: z.string(),
    edgeId: z.string(),
  }),
  z.object({
    type: z.literal('BuildSettlement'),
    seatId: z.string(),
    intersectionId: z.string(),
  }),
  z.object({
    type: z.literal('BuildCity'),
    seatId: z.string(),
    intersectionId: z.string(),
  }),
  z.object({
    type: z.literal('BuyDevelopmentCard'),
    seatId: z.string(),
  }),
  z.object({
    type: z.literal('PlayKnight'),
    seatId: z.string(),
    cardId: z.string(),
    hexId: z.string(),
  }),
  z.object({
    type: z.literal('PlayRoadBuilding'),
    seatId: z.string(),
    cardId: z.string(),
  }),
  z.object({
    type: z.literal('PlayYearOfPlenty'),
    seatId: z.string(),
    cardId: z.string(),
    resources: z.tuple([resourceEnum, resourceEnum]),
  }),
  z.object({
    type: z.literal('PlayMonopoly'),
    seatId: z.string(),
    cardId: z.string(),
    resource: resourceEnum,
  }),
  z.object({
    type: z.literal('TradeWithBank'),
    seatId: z.string(),
    give: resourceEnum,
    receive: resourceEnum,
  }),
  z.object({
    type: z.literal('OfferTrade'),
    seatId: z.string(),
    targetSeatIds: z.array(z.string()).min(1),
    offered: resourceHandSchema,
    requested: resourceHandSchema,
  }),
  z.object({
    type: z.literal('RespondToTrade'),
    seatId: z.string(),
    offerId: z.string(),
    accepted: z.boolean(),
  }),
  z.object({
    type: z.literal('FinalizeTrade'),
    seatId: z.string(),
    offerId: z.string(),
    targetSeatId: z.string(),
  }),
  z.object({
    type: z.literal('CancelTrade'),
    seatId: z.string(),
    offerId: z.string(),
  }),
  z.object({
    type: z.literal('EndTurn'),
    seatId: z.string(),
  }),
])

const commandEnvelopeSchema = z.object({
  commandId: z.string().min(1).optional(),
  expectedVersion: z.number().int().min(0).optional(),
  command: commandSchema,
})

const commandInputSchema = z.union([commandSchema, commandEnvelopeSchema])

type SubscriptionRecord = {
  socket: { send: (payload: string) => void }
  accessToken: string
}

export async function buildApp() {
  const service = new CatanService(await createStoreFromEnv())
  const app = Fastify({
    logger: true,
  })

  await app.register(websocket)

  const subscriptions = new Map<string, Set<SubscriptionRecord>>()

  function bearerToken(authorizationHeader: string | undefined): string {
    if (!authorizationHeader) {
      throw new RuleError('unauthorized', 'Missing authorization header')
    }
    const [scheme, token] = authorizationHeader.split(' ')
    if (scheme !== 'Bearer' || !token) {
      throw new RuleError('unauthorized', 'Expected Bearer token')
    }
    return token
  }

  async function broadcastGame(gameId: string): Promise<void> {
    const listeners = subscriptions.get(gameId)
    if (!listeners) {
      return
    }

    for (const listener of [...listeners]) {
      try {
        const view = await service.getPrivateView(listener.accessToken, gameId)
        listener.socket.send(JSON.stringify({ type: 'game_view_updated', payload: view }))
      } catch {
        listeners.delete(listener)
      }
    }
  }

  function hasOtherSubscription(gameId: string, accessToken: string, excludingSocket: SubscriptionRecord['socket']): boolean {
    const listeners = subscriptions.get(gameId)
    if (!listeners) {
      return false
    }
    for (const listener of listeners) {
      if (listener.accessToken === accessToken && listener.socket !== excludingSocket) {
        return true
      }
    }
    return false
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuleError) {
      return reply.status(400).send({
        error: error.code,
        message: error.message,
      })
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'invalid_request',
        message: error.issues.map((issue) => issue.message).join('; '),
      })
    }

    requestLog(app, error)
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Unexpected server error',
    })
  })

  app.get('/health', async () => ({
    status: 'ok',
    persistence: process.env.DATABASE_URL ? 'postgres' : 'memory',
  }))

  app.post('/v1/auth/guest', async (request) => {
    const body = z.object({ displayName: z.string().trim().min(1).max(32) }).parse(request.body)
    return service.createGuest(body.displayName)
  })

  app.post('/v1/auth/reconnect', async (request) => {
    const body = z.object({ reconnectToken: z.string().min(1) }).parse(request.body)
    return service.reconnect(body.reconnectToken)
  })

  app.post('/v1/lobbies', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const game = await service.createLobby(accessToken)
    return service.getPrivateView(accessToken, game.id)
  })

  app.post('/v1/lobbies/:gameId/join', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    const result = await service.joinLobby(accessToken, params.gameId)
    await broadcastGame(params.gameId)
    return {
      events: result.events,
      view: await service.getPrivateView(accessToken, params.gameId),
    }
  })

  app.post('/v1/lobbies/:gameId/leave', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    const result = await service.leaveLobby(accessToken, params.gameId)
    await broadcastGame(params.gameId)
    return {
      events: result.events,
      view: await service.getPrivateView(accessToken, params.gameId),
    }
  })

  app.post('/v1/lobbies/:gameId/ready', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    const body = z.object({ ready: z.boolean() }).parse(request.body)
    const result = await service.setReady(accessToken, params.gameId, body.ready)
    await broadcastGame(params.gameId)
    return {
      events: result.events,
      view: await service.getPrivateView(accessToken, params.gameId),
    }
  })

  app.post('/v1/lobbies/:gameId/start', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    const result = await service.startGame(accessToken, params.gameId)
    await broadcastGame(params.gameId)
    return {
      events: result.events,
      view: await service.getPrivateView(accessToken, params.gameId),
    }
  })

  app.get('/v1/games/:gameId', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    return service.getPrivateView(accessToken, params.gameId)
  })

  app.get('/v1/games/:gameId/history', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    return service.getHistory(accessToken, params.gameId)
  })

  app.post('/v1/games/:gameId/commands', async (request) => {
    const accessToken = bearerToken(request.headers.authorization)
    const params = z.object({ gameId: z.string() }).parse(request.params)
    const command = commandInputSchema.parse(request.body)
    const result = await service.submitGameCommand(accessToken, params.gameId, command)
    await broadcastGame(params.gameId)
    return {
      type: 'command_accepted',
      events: result.events,
      view: await service.getPrivateView(accessToken, params.gameId),
    }
  })

  app.register(async (instance) => {
    instance.get('/v1/ws', { websocket: true }, async (socket, request) => {
      const accessToken = z.object({ accessToken: z.string().min(1) }).parse(request.query).accessToken
      await service.authenticate(accessToken)

      socket.on('message', async (rawMessage: Buffer) => {
        try {
          const message = JSON.parse(rawMessage.toString()) as {
            type: 'subscribe' | 'submit_command'
            gameId: string
            command?: unknown
          }

          if (message.type === 'subscribe') {
            const gameId = z.string().parse(message.gameId)
            const current = subscriptions.get(gameId) ?? new Set()
            current.add({ socket, accessToken })
            subscriptions.set(gameId, current)
            const presence = await service.setPresence(accessToken, gameId, true)
            if (presence.events.length > 0) {
              await broadcastGame(gameId)
            }
            socket.send(JSON.stringify({ type: 'game_view_updated', payload: await service.getPrivateView(accessToken, gameId) }))
            return
          }

          if (message.type === 'submit_command') {
            const gameId = z.string().parse(message.gameId)
            const command = commandInputSchema.parse(message.command)
            const result = await service.submitGameCommand(accessToken, gameId, command)
            socket.send(JSON.stringify({ type: 'command_accepted', payload: { events: result.events } }))
            await broadcastGame(gameId)
          }
        } catch (error) {
          const payload = error instanceof Error ? error.message : 'Unexpected websocket error'
          socket.send(JSON.stringify({ type: 'command_rejected', payload }))
        }
      })

      socket.on('close', async () => {
        for (const [gameId, listeners] of subscriptions.entries()) {
          for (const listener of [...listeners]) {
            if (listener.socket === socket) {
              listeners.delete(listener)
              if (!hasOtherSubscription(gameId, listener.accessToken, socket)) {
                try {
                  const presence = await service.setPresence(listener.accessToken, gameId, false)
                  if (presence.events.length > 0) {
                    await broadcastGame(gameId)
                  }
                } catch {}
              }
            }
          }
        }
      })
    })
  })

  return app
}

if (process.env.NO_LISTEN !== '1') {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '127.0.0.1'
  await app.listen({
    host,
    port,
  })
}

function requestLog(app: { log: { error: (arg1: unknown, arg2?: string) => void } }, error: unknown): void {
  if (error instanceof Error) {
    app.log.error(error)
  } else {
    app.log.error({ error }, 'Unexpected error')
  }
}
