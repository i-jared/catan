import type {
  CommandAcceptedResponse,
  GuestAuthResponse,
  PrivateGameView,
  SessionState,
} from './types'

export interface ViewResponse {
  events: unknown[]
  view: PrivateGameView
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function toHeaders(session: SessionState | null): HeadersInit {
  if (!session) {
    return {
      'Content-Type': 'application/json',
    }
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  }
}

export function apiUrl(path: string): string {
  return `${apiBase}${path}`
}

export function websocketUrl(session: SessionState): string {
  const httpUrl = apiBase ? new URL(apiBase) : new URL(window.location.origin)
  const protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${httpUrl.host}/v1/ws?accessToken=${encodeURIComponent(session.accessToken)}`
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(body?.message ?? body?.error ?? `Request failed with status ${response.status}`)
  }
  const data = await response.json() as T
  console.log('API response:', data)
  return data
}

export async function createGuest(displayName: string): Promise<GuestAuthResponse> {
  const response = await fetch(apiUrl('/v1/auth/guest'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName }),
  })
  return parseJson<GuestAuthResponse>(response)
}

export async function reconnectSession(reconnectToken: string): Promise<GuestAuthResponse> {
  const response = await fetch(apiUrl('/v1/auth/reconnect'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reconnectToken }),
  })
  return parseJson<GuestAuthResponse>(response)
}

export async function authedRequest<T>(
  path: string,
  session: SessionState,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...toHeaders(session),
      ...(init.headers ?? {}),
    },
  })
  return parseJson<T>(response)
}

export async function createLobby(session: SessionState): Promise<PrivateGameView> {
  return authedRequest<PrivateGameView>('/v1/lobbies', session, { method: 'POST', body: '{}' })
}

export async function joinLobby(session: SessionState, gameId: string): Promise<ViewResponse> {
  return authedRequest(`/v1/lobbies/${gameId}/join`, session, { method: 'POST', body: '{}' })
}

export async function leaveLobby(session: SessionState, gameId: string): Promise<ViewResponse> {
  return authedRequest<ViewResponse>(`/v1/lobbies/${gameId}/leave`, session, {
    method: 'POST',
    body: '{}',
  })
}

export async function setReady(session: SessionState, gameId: string, ready: boolean): Promise<ViewResponse> {
  return authedRequest<ViewResponse>(`/v1/lobbies/${gameId}/ready`, session, {
    method: 'POST',
    body: JSON.stringify({ ready }),
  })
}

export async function startGame(session: SessionState, gameId: string): Promise<ViewResponse> {
  return authedRequest<ViewResponse>(`/v1/lobbies/${gameId}/start`, session, {
    method: 'POST',
    body: '{}',
  })
}

export async function fetchGame(session: SessionState, gameId: string): Promise<PrivateGameView> {
  return authedRequest<PrivateGameView>(`/v1/games/${gameId}`, session)
}

export async function sendCommand(
  session: SessionState,
  gameId: string,
  version: number,
  command: unknown,
): Promise<CommandAcceptedResponse> {
  return authedRequest<CommandAcceptedResponse>(`/v1/games/${gameId}/commands`, session, {
    method: 'POST',
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion: version,
      command,
    }),
  })
}
