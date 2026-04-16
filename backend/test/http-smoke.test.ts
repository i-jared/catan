import test from 'node:test'
import assert from 'node:assert/strict'

test('http auth and lobby flow works through fastify inject', async () => {
  process.env.NO_LISTEN = '1'
  const { buildApp } = await import('../src/server.js')
  const app = await buildApp()

  const authResponse = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: {
      displayName: 'Alice',
    },
  })

  assert.equal(authResponse.statusCode, 200)
  const authBody = authResponse.json() as { accessToken: string }
  assert.ok(authBody.accessToken)

  const createLobbyResponse = await app.inject({
    method: 'POST',
    url: '/v1/lobbies',
    headers: {
      authorization: `Bearer ${authBody.accessToken}`,
    },
  })

  assert.equal(createLobbyResponse.statusCode, 200)
  const lobbyBody = createLobbyResponse.json() as { gameId: string; me: { seatId: string } }
  assert.ok(lobbyBody.gameId)
  assert.equal(lobbyBody.me.seatId, 'S1')

  await app.close()
})
