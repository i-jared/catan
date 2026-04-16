import { startTransition, useEffect, useEffectEvent, useMemo, useState } from 'react'
import './App.css'
import {
  chipAsset,
  cityAssetMap,
  portAssetMap,
  robberAsset,
  roadAssetMap,
  settlementAssetMap,
  terrainAssetMap,
} from './game/assets'
import {
  createGuest,
  createLobby,
  fetchGame,
  joinLobby,
  leaveLobby,
  reconnectSession,
  sendCommand,
  setReady,
  startGame,
  websocketUrl,
} from './game/api'
import { boardGeometry } from './game/topology'
import type { DevCardView, PrivateGameView, Resource, ResourceHand, SeatView, SessionState } from './game/types'

const SESSION_STORAGE_KEY = 'catan.session'
const ACTIVE_GAME_STORAGE_KEY = 'catan.activeGame'
const HEX_RADIUS = 84
const RESOURCES: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore']

type SocketState = 'offline' | 'connecting' | 'live'

type ManualMode =
  | { kind: 'none' }
  | { kind: 'build_road' }
  | { kind: 'build_settlement' }
  | { kind: 'build_city' }
  | { kind: 'play_knight'; cardId: string }

type BoardIntent =
  | { kind: 'hex'; label: string; command: 'MoveRobber' | 'PlayKnight'; cardId?: string }
  | { kind: 'edge'; label: string; command: 'PlaceSetupRoad' | 'BuildRoad'; originIntersectionId?: string }
  | { kind: 'intersection'; label: string; command: 'PlaceSetupSettlement' | 'BuildSettlement' | 'BuildCity' }

type SocketMessage =
  | { type: 'game_view_updated'; payload: PrivateGameView }
  | { type: 'command_accepted'; payload: { events: unknown[] } }
  | { type: 'command_rejected'; payload: string }

function emptyHand(): ResourceHand {
  return {
    wood: 0,
    brick: 0,
    sheep: 0,
    wheat: 0,
    ore: 0,
  }
}

function totalHand(hand: ResourceHand): number {
  return RESOURCES.reduce((sum, resource) => sum + hand[resource], 0)
}

function seatName(view: PrivateGameView | null, seatId: string | null): string {
  if (!view || !seatId) {
    return 'None'
  }
  return view.seats.find((seat) => seat.seatId === seatId)?.displayName ?? seatId
}

function ownerSeat(view: PrivateGameView | null): SeatView | null {
  if (!view?.ownerSeatId) {
    return null
  }
  return view.seats.find((seat) => seat.seatId === view.ownerSeatId) ?? null
}

function getSeat(view: PrivateGameView | null, seatId: string | null): SeatView | null {
  if (!view || !seatId) {
    return null
  }
  return view.seats.find((seat) => seat.seatId === seatId) ?? null
}

function availableCards(view: PrivateGameView | null, type: DevCardView['type']): DevCardView[] {
  return view?.me?.devCards.filter((card) => card.type === type && !card.played) ?? []
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected client error'
}

function parseCount(value: string): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0
  }
  return Math.floor(numeric)
}

function updateHand(hand: ResourceHand, resource: Resource, value: number): ResourceHand {
  return {
    ...hand,
    [resource]: value,
  }
}

function hexPoints(x: number, y: number, radius: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (((60 * index) - 30) * Math.PI) / 180
    const pointX = x + Math.cos(angle) * radius
    const pointY = y + Math.sin(angle) * radius
    return `${pointX},${pointY}`
  }).join(' ')
}

function describeTurn(view: PrivateGameView | null): string {
  if (!view) {
    return 'No active game'
  }

  switch (view.turn.type) {
    case 'lobby':
      return 'Lobby open'
    case 'setup_place_settlement':
      return `${seatName(view, view.turn.seatId)} is placing an initial settlement`
    case 'setup_place_road':
      return `${seatName(view, view.turn.seatId)} is placing an initial road`
    case 'await_roll':
      return `${seatName(view, view.turn.seatId)} must roll`
    case 'await_discards':
      return `Waiting for discards from ${view.turn.pendingSeatIds.map((seatId) => seatName(view, seatId)).join(', ')}`
    case 'await_robber_move':
      return `${seatName(view, view.turn.seatId)} is moving the robber`
    case 'await_robber_steal':
      return `${seatName(view, view.turn.seatId)} is choosing a player to rob`
    case 'main_turn':
      return `${seatName(view, view.turn.seatId)} is taking turn ${view.turn.turnNumber}`
    case 'resolving_road_building':
      return `${seatName(view, view.turn.seatId)} is placing ${view.turn.roadsLeftToPlace} free road${view.turn.roadsLeftToPlace === 1 ? '' : 's'}`
    case 'resolving_year_of_plenty':
      return `${seatName(view, view.turn.seatId)} is resolving Year of Plenty`
    case 'await_trade_responses':
      return `Trade offer waiting on ${view.turn.pendingSeatIds.map((seatId) => seatName(view, seatId)).join(', ')}`
    case 'finished':
      return `${seatName(view, view.turn.winnerSeatId)} won the game`
  }
}

function deriveBoardIntent(view: PrivateGameView | null, manualMode: ManualMode): BoardIntent | null {
  if (!view?.me || !view.board) {
    return null
  }

  if (view.legalActions.includes('PlaceSetupSettlement')) {
    return {
      kind: 'intersection',
      label: 'Select an intersection for the initial settlement.',
      command: 'PlaceSetupSettlement',
    }
  }

  if (view.legalActions.includes('PlaceSetupRoad') && view.turn.type === 'setup_place_road') {
    return {
      kind: 'edge',
      label: 'Select an edge connected to the marked settlement.',
      command: 'PlaceSetupRoad',
      originIntersectionId: view.turn.originIntersectionId,
    }
  }

  if (view.legalActions.includes('MoveRobber') && view.turn.type === 'await_robber_move') {
    return {
      kind: 'hex',
      label: 'Select a hex for the robber.',
      command: 'MoveRobber',
    }
  }

  if (view.legalActions.includes('BuildRoad') && view.turn.type === 'resolving_road_building') {
    return {
      kind: 'edge',
      label: `Select a free edge for Road Building. ${view.turn.roadsLeftToPlace} left.`,
      command: 'BuildRoad',
    }
  }

  if (manualMode.kind === 'play_knight' && view.legalActions.includes('PlayKnight')) {
    return {
      kind: 'hex',
      label: 'Select a hex for Knight.',
      command: 'PlayKnight',
      cardId: manualMode.cardId,
    }
  }

  if (manualMode.kind === 'build_road' && view.legalActions.includes('BuildRoad')) {
    return {
      kind: 'edge',
      label: 'Select an edge to build a road.',
      command: 'BuildRoad',
    }
  }

  if (manualMode.kind === 'build_settlement' && view.legalActions.includes('BuildSettlement')) {
    return {
      kind: 'intersection',
      label: 'Select an intersection to build a settlement.',
      command: 'BuildSettlement',
    }
  }

  if (manualMode.kind === 'build_city' && view.legalActions.includes('BuildCity')) {
    return {
      kind: 'intersection',
      label: 'Select one of your settlements to upgrade to a city.',
      command: 'BuildCity',
    }
  }

  return null
}

function ResourceEditor(props: {
  hand: ResourceHand
  onChange: (resource: Resource, value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="resource-grid">
      {RESOURCES.map((resource) => (
        <label key={resource} className="resource-field">
          <span>{resource}</span>
          <input
            type="number"
            min="0"
            step="1"
            value={props.hand[resource]}
            disabled={props.disabled}
            onChange={(event) => props.onChange(resource, parseCount(event.target.value))}
          />
        </label>
      ))}
    </div>
  )
}

function BoardView(props: {
  view: PrivateGameView
  intent: BoardIntent | null
  onHexSelect: (hexId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onIntersectionSelect: (intersectionId: string) => void
}) {
  if (!props.view.board) {
    return <div className="empty-state">Board appears after the game starts.</div>
  }

  const colorsBySeatId = Object.fromEntries(props.view.seats.map((seat) => [seat.seatId, seat.color]))
  const setupOrigin = props.intent?.kind === 'edge' ? props.intent.originIntersectionId ?? null : null

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${boardGeometry.width} ${boardGeometry.height}`}
      role="img"
      aria-label="Settlers of Catan board"
    >
      <rect x="0" y="0" width={boardGeometry.width} height={boardGeometry.height} className="board-background" />

      {props.view.board.ports.map((port) => {
        const geometry = boardGeometry.ports[port.portId]
        const edge = boardGeometry.edges[port.edgeId]
        if (!geometry || !edge) {
          return null
        }
        return (
          <g key={port.portId}>
            <line
              className="port-link"
              x1={edge.mx}
              y1={edge.my}
              x2={geometry.x}
              y2={geometry.y}
            />
            <image
              href={portAssetMap[port.type]}
              x={geometry.x - 28}
              y={geometry.y - 28}
              width="56"
              height="56"
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        )
      })}

      {props.view.board.hexes.map((hex) => {
        const geometry = boardGeometry.hexes[hex.hexId]
        if (!geometry) {
          return null
        }

        const points = hexPoints(geometry.x, geometry.y, HEX_RADIUS)
        const isClickable = props.intent?.kind === 'hex'

        return (
          <g key={hex.hexId}>
            <defs>
              <clipPath id={`clip-${hex.hexId}`}>
                <polygon points={points} />
              </clipPath>
            </defs>

            <polygon className="hex-shell" points={points} />
            <image
              href={terrainAssetMap[hex.terrain]}
              x={geometry.x - HEX_RADIUS}
              y={geometry.y - HEX_RADIUS}
              width={HEX_RADIUS * 2}
              height={HEX_RADIUS * 2}
              clipPath={`url(#clip-${hex.hexId})`}
              preserveAspectRatio="xMidYMid slice"
            />
            <polygon className="hex-outline" points={points} />

            {hex.numberToken !== null ? (
              <>
                <image
                  href={chipAsset}
                  x={geometry.x - 28}
                  y={geometry.y - 28}
                  width="56"
                  height="56"
                  preserveAspectRatio="xMidYMid meet"
                />
                <text className="chip-number" x={geometry.x} y={geometry.y + 6}>
                  {hex.numberToken}
                </text>
              </>
            ) : null}

            {props.view.board?.robberHexId === hex.hexId ? (
              <image
                href={robberAsset}
                x={geometry.x - 18}
                y={geometry.y - 64}
                width="36"
                height="48"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null}

            {isClickable ? (
              <polygon
                className="hex-hit"
                points={points}
                onClick={() => props.onHexSelect(hex.hexId)}
              />
            ) : null}
          </g>
        )
      })}

      {Object.entries(props.view.board.edges).map(([edgeId, edge]) => {
        const geometry = boardGeometry.edges[edgeId]
        if (!geometry) {
          return null
        }

        const color = edge.ownerSeatId ? colorsBySeatId[edge.ownerSeatId] ?? 'red' : null
        const isInteractive = props.intent?.kind === 'edge'
          && (!setupOrigin || geometry.intersectionIds.includes(setupOrigin))

        return (
          <g key={edgeId}>
            <line
              className={isInteractive ? 'edge-base edge-base-active' : 'edge-base'}
              x1={geometry.x1}
              y1={geometry.y1}
              x2={geometry.x2}
              y2={geometry.y2}
            />
            {color ? (
              <g transform={`translate(${geometry.mx} ${geometry.my}) rotate(${geometry.angle})`}>
                <image
                  href={roadAssetMap[color]}
                  x={-34}
                  y={-12}
                  width="68"
                  height="24"
                  preserveAspectRatio="xMidYMid meet"
                />
              </g>
            ) : null}
            {isInteractive ? (
              <line
                className="edge-hit"
                x1={geometry.x1}
                y1={geometry.y1}
                x2={geometry.x2}
                y2={geometry.y2}
                onClick={() => props.onEdgeSelect(edgeId)}
              />
            ) : null}
          </g>
        )
      })}

      {Object.entries(props.view.board.intersections).map(([intersectionId, intersection]) => {
        const geometry = boardGeometry.intersections[intersectionId]
        if (!geometry) {
          return null
        }

        const color = intersection.ownerSeatId ? colorsBySeatId[intersection.ownerSeatId] ?? 'red' : null
        const isInteractive = props.intent?.kind === 'intersection'

        return (
          <g key={intersectionId}>
            {color && intersection.building === 'settlement' ? (
              <image
                href={settlementAssetMap[color]}
                x={geometry.x - 18}
                y={geometry.y - 28}
                width="36"
                height="36"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null}

            {color && intersection.building === 'city' ? (
              <image
                href={cityAssetMap[color]}
                x={geometry.x - 20}
                y={geometry.y - 32}
                width="40"
                height="40"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null}

            {!color ? (
              <rect
                className={isInteractive ? 'intersection-marker intersection-marker-active' : 'intersection-marker'}
                x={geometry.x - 5}
                y={geometry.y - 5}
                width="10"
                height="10"
              />
            ) : null}

            {isInteractive ? (
              <rect
                className="intersection-hit"
                x={geometry.x - 12}
                y={geometry.y - 12}
                width="24"
                height="24"
                onClick={() => props.onIntersectionSelect(intersectionId)}
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function App() {
  const [displayName, setDisplayName] = useState('')
  const [joinGameId, setJoinGameId] = useState('')
  const [session, setSession] = useState<SessionState | null>(null)
  const [view, setView] = useState<PrivateGameView | null>(null)
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [socketState, setSocketState] = useState<SocketState>('offline')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState<ManualMode>({ kind: 'none' })
  const [discardDraft, setDiscardDraft] = useState<ResourceHand>(emptyHand)
  const [tradeOffered, setTradeOffered] = useState<ResourceHand>(emptyHand)
  const [tradeRequested, setTradeRequested] = useState<ResourceHand>(emptyHand)
  const [tradeTargets, setTradeTargets] = useState<string[]>([])
  const [bankTrade, setBankTrade] = useState<{ give: Resource; receive: Resource }>({
    give: 'wood',
    receive: 'brick',
  })
  const [yearOfPlenty, setYearOfPlenty] = useState<{ cardId: string; first: Resource; second: Resource }>({
    cardId: '',
    first: 'wood',
    second: 'brick',
  })
  const [monopoly, setMonopoly] = useState<{ cardId: string; resource: Resource }>({
    cardId: '',
    resource: 'wood',
  })

  const me = view?.me ?? null
  const meSeat = getSeat(view, me?.seatId ?? null)
  const currentOwner = ownerSeat(view)
  const boardIntent = deriveBoardIntent(view, manualMode)
  const isBusy = busyAction !== null
  const discardTarget = me ? Math.floor(totalHand(me.resources) / 2) : 0
  const knightCards = useMemo(() => availableCards(view, 'knight'), [view?.me?.devCards])
  const yearOfPlentyCards = useMemo(() => availableCards(view, 'year_of_plenty'), [view?.me?.devCards])
  const monopolyCards = useMemo(() => availableCards(view, 'monopoly'), [view?.me?.devCards])

  function applyView(nextView: PrivateGameView) {
    startTransition(() => {
      setView(nextView)
      setActiveGameId(nextView.gameId)
    })
  }

  async function reloadGame() {
    if (!session || !activeGameId) {
      return
    }

    try {
      const nextView = await fetchGame(session, activeGameId)
      applyView(nextView)
    } catch (reloadError) {
      setError(toErrorMessage(reloadError))
    }
  }

  useEffect(() => {
    let cancelled = false
    const storedGameId = window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY)
    if (storedGameId) {
      setActiveGameId(storedGameId)
      setJoinGameId(storedGameId)
    }

    const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!rawSession) {
      setBootstrapping(false)
      return
    }

    let parsedSession: SessionState
    try {
      parsedSession = JSON.parse(rawSession) as SessionState
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
      window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY)
      setBootstrapping(false)
      return
    }

    setSession(parsedSession)

    void reconnectSession(parsedSession.reconnectToken)
      .then((nextSession) => {
        if (cancelled) {
          return
        }
        setSession(nextSession)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        window.localStorage.removeItem(SESSION_STORAGE_KEY)
        window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY)
        setSession(null)
        setView(null)
        setActiveGameId(null)
        setError('Saved session expired. Create a new guest session.')
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapping(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (bootstrapping) {
      return
    }

    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  }, [bootstrapping, session])

  useEffect(() => {
    if (bootstrapping) {
      return
    }

    if (activeGameId) {
      window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, activeGameId)
    } else {
      window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY)
    }
  }, [activeGameId, bootstrapping])

  useEffect(() => {
    if (bootstrapping || !session || !activeGameId) {
      if (!activeGameId) {
        setView(null)
      }
      return
    }

    let cancelled = false
    void fetchGame(session, activeGameId)
      .then((nextView) => {
        if (!cancelled) {
          startTransition(() => {
            setView(nextView)
            setActiveGameId(nextView.gameId)
          })
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(toErrorMessage(fetchError))
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeGameId, bootstrapping, session])

  const onSocketMessage = useEffectEvent((event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as SocketMessage

      if (message.type === 'game_view_updated') {
        startTransition(() => {
          setView(message.payload)
          setActiveGameId(message.payload.gameId)
        })
        setError(null)
        return
      }

      if (message.type === 'command_rejected') {
        setError(message.payload)
      }
    } catch {
      setError('Received malformed websocket payload.')
    }
  })

  useEffect(() => {
    if (bootstrapping || !session || !activeGameId) {
      setSocketState('offline')
      return
    }

    const socket = new WebSocket(websocketUrl(session))
    let active = true
    setSocketState('connecting')

    socket.addEventListener('open', () => {
      if (!active) {
        return
      }
      setSocketState('live')
      socket.send(JSON.stringify({ type: 'subscribe', gameId: activeGameId }))
    })

    socket.addEventListener('message', onSocketMessage)
    socket.addEventListener('close', () => {
      if (active) {
        setSocketState('offline')
      }
    })
    socket.addEventListener('error', () => {
      if (active) {
        setSocketState('offline')
      }
    })

    return () => {
      active = false
      socket.close()
    }
  }, [activeGameId, bootstrapping, session])

  useEffect(() => {
    if (!view?.me) {
      setManualMode({ kind: 'none' })
      return
    }

    setTradeTargets((current) => {
      const validSeatIds = view.seats
        .filter((seat) => seat.seatId !== view.me?.seatId)
        .map((seat) => seat.seatId)
      return current.filter((seatId) => validSeatIds.includes(seatId))
    })

    setYearOfPlenty((current) => ({
      ...current,
      cardId: yearOfPlentyCards.some((card) => card.id === current.cardId)
        ? current.cardId
        : (yearOfPlentyCards[0]?.id ?? ''),
    }))

    setMonopoly((current) => ({
      ...current,
      cardId: monopolyCards.some((card) => card.id === current.cardId)
        ? current.cardId
        : (monopolyCards[0]?.id ?? ''),
    }))

    if (!view.legalActions.includes('DiscardCards')) {
      setDiscardDraft(emptyHand())
    }

    setManualMode((current) => {
      if (current.kind === 'play_knight') {
        const hasCard = knightCards.some((card) => card.id === current.cardId)
        if (!view.legalActions.includes('PlayKnight') || !hasCard) {
          return { kind: 'none' }
        }
      }

      if (current.kind === 'build_road' && !view.legalActions.includes('BuildRoad')) {
        return { kind: 'none' }
      }

      if (current.kind === 'build_settlement' && !view.legalActions.includes('BuildSettlement')) {
        return { kind: 'none' }
      }

      if (current.kind === 'build_city' && !view.legalActions.includes('BuildCity')) {
        return { kind: 'none' }
      }

      return current
    })
  }, [knightCards, monopolyCards, view, yearOfPlentyCards])

  async function withBusy(label: string, action: () => Promise<void>) {
    setBusyAction(label)
    setError(null)
    try {
      await action()
    } catch (actionError) {
      console.error('Action failed:', label, actionError)
      setError(toErrorMessage(actionError))
      // Only reload if we have an active game
      if (activeGameId) {
        await reloadGame()
      }
    } finally {
      setBusyAction(null)
    }
  }

  async function submitCommand(command: unknown) {
    if (!session || !view) {
      return
    }

    await withBusy('command', async () => {
      const result = await sendCommand(session, view.gameId, view.version, command)
      applyView(result.view)
    })
  }

  function resetSession() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY)
    setSession(null)
    setView(null)
    setActiveGameId(null)
    setSocketState('offline')
    setManualMode({ kind: 'none' })
    setError(null)
  }

  async function handleCreateGuest() {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setError('Enter a display name.')
      return
    }

    await withBusy('auth', async () => {
      const nextSession = await createGuest(trimmedName)
      setSession(nextSession)
      setDisplayName(trimmedName)
    })
  }

  async function handleCreateLobby() {
    if (!session) {
      return
    }

    await withBusy('create_lobby', async () => {
      const nextView = await createLobby(session)
      console.log('Created lobby, got view:', nextView)
      if (!nextView || !nextView.gameId) {
        throw new Error('Invalid response: missing view or gameId')
      }
      startTransition(() => {
        setView(nextView)
        setActiveGameId(nextView.gameId)
      })
      setJoinGameId(nextView.gameId)
    })
  }

  async function handleJoinLobby() {
    if (!session) {
      return
    }

    const trimmedGameId = joinGameId.trim()
    if (!trimmedGameId) {
      setError('Enter a game id.')
      return
    }

    await withBusy('join_lobby', async () => {
      const result = await joinLobby(session, trimmedGameId)
      console.log('Joined lobby, got result:', result)
      if (!result.view) {
        throw new Error('Invalid response: missing view')
      }
      startTransition(() => {
        setView(result.view)
        setActiveGameId(result.view.gameId)
      })
      setJoinGameId(result.view.gameId)
    })
  }

  async function handleToggleReady() {
    if (!session || !view || !meSeat || !view.legalActions.includes('SetReady')) {
      return
    }

    await withBusy('ready', async () => {
      const result = await setReady(session, view.gameId, !meSeat.isReady)
      applyView(result.view)
    })
  }

  async function handleStartGame() {
    if (!session || !view || !view.legalActions.includes('StartGame')) {
      return
    }

    await withBusy('start_game', async () => {
      const result = await startGame(session, view.gameId)
      applyView(result.view)
    })
  }

  async function handleLeaveLobby() {
    if (!session || !view || !view.legalActions.includes('LeaveLobby')) {
      return
    }

    await withBusy('leave_lobby', async () => {
      await leaveLobby(session, view.gameId)
      startTransition(() => {
        setView(null)
        setActiveGameId(null)
      })
      setJoinGameId('')
      setManualMode({ kind: 'none' })
    })
  }

  async function handleHexSelect(hexId: string) {
    if (!me || !boardIntent) {
      return
    }

    if (boardIntent.kind !== 'hex') {
      return
    }

    if (boardIntent.command === 'MoveRobber') {
      await submitCommand({
        type: 'MoveRobber',
        seatId: me.seatId,
        hexId,
      })
      return
    }

    await submitCommand({
      type: 'PlayKnight',
      seatId: me.seatId,
      cardId: boardIntent.cardId,
      hexId,
    })
    setManualMode({ kind: 'none' })
  }

  async function handleEdgeSelect(edgeId: string) {
    if (!me || !boardIntent) {
      return
    }

    if (boardIntent.kind !== 'edge') {
      return
    }

    if (boardIntent.command === 'PlaceSetupRoad') {
      await submitCommand({
        type: 'PlaceSetupRoad',
        seatId: me.seatId,
        edgeId,
      })
      return
    }

    await submitCommand({
      type: 'BuildRoad',
      seatId: me.seatId,
      edgeId,
    })
  }

  async function handleIntersectionSelect(intersectionId: string) {
    if (!me || !boardIntent) {
      return
    }

    if (boardIntent.kind !== 'intersection') {
      return
    }

    if (boardIntent.command === 'PlaceSetupSettlement') {
      await submitCommand({
        type: 'PlaceSetupSettlement',
        seatId: me.seatId,
        intersectionId,
      })
      return
    }

    if (boardIntent.command === 'BuildSettlement') {
      await submitCommand({
        type: 'BuildSettlement',
        seatId: me.seatId,
        intersectionId,
      })
      return
    }

    await submitCommand({
      type: 'BuildCity',
      seatId: me.seatId,
      intersectionId,
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Settlers of Catan</h1>
          <p className="muted">Fast client for the production backend.</p>
        </div>
        <div className="status-grid">
          <div>
            <span className="status-label">Session</span>
            <strong>{session?.displayName ?? (bootstrapping ? 'Restoring' : 'Guest required')}</strong>
          </div>
          <div>
            <span className="status-label">Socket</span>
            <strong>{socketState}</strong>
          </div>
          <div>
            <span className="status-label">Game</span>
            <strong className="mono">{activeGameId ?? 'None'}</strong>
          </div>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="app-grid">
        <section className="panel stack">
          <div className="section-block">
            <h2>Session</h2>
            {!session ? (
              <div className="stack">
                <label className="field">
                  <span>Display Name</span>
                  <input
                    type="text"
                    maxLength={32}
                    value={displayName}
                    disabled={isBusy}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <button type="button" disabled={isBusy} onClick={handleCreateGuest}>
                  Create Guest Session
                </button>
              </div>
            ) : (
              <div className="stack">
                <div className="info-grid">
                  <div>
                    <span className="status-label">User</span>
                    <strong>{session.displayName}</strong>
                  </div>
                  <div>
                    <span className="status-label">User Id</span>
                    <strong className="mono">{session.userId}</strong>
                  </div>
                </div>
                <div className="button-row">
                  <button type="button" disabled={isBusy} onClick={handleCreateLobby}>
                    Create Lobby
                  </button>
                  <button type="button" disabled={isBusy} onClick={() => void reloadGame()}>
                    Refresh
                  </button>
                  <button type="button" className="button-secondary" disabled={isBusy} onClick={resetSession}>
                    Clear Session
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="section-block">
            <h2>Join Lobby</h2>
            <div className="stack">
              <label className="field">
                <span>Game Id</span>
                <input
                  type="text"
                  value={joinGameId}
                  disabled={!session || isBusy}
                  onChange={(event) => setJoinGameId(event.target.value.trim())}
                />
              </label>
              <button type="button" disabled={!session || isBusy} onClick={handleJoinLobby}>
                Join Existing Lobby
              </button>
            </div>
          </div>

          {view ? (
            <>
              <div className="section-block">
                <h2>Game</h2>
                <div className="info-grid">
                  <div>
                    <span className="status-label">Status</span>
                    <strong>{view.status}</strong>
                  </div>
                  <div>
                    <span className="status-label">Version</span>
                    <strong>{view.version}</strong>
                  </div>
                  <div>
                    <span className="status-label">Owner</span>
                    <strong>{currentOwner?.displayName ?? 'None'}</strong>
                  </div>
                  <div>
                    <span className="status-label">Last Roll</span>
                    <strong>{view.lastRoll ? `${view.lastRoll.die1} + ${view.lastRoll.die2}` : 'None'}</strong>
                  </div>
                </div>
                <p className="turn-copy">{describeTurn(view)}</p>
                <p className="mono tight">{view.gameId}</p>
                <div className="button-row">
                  {view.legalActions.includes('SetReady') ? (
                    <button type="button" disabled={isBusy} onClick={handleToggleReady}>
                      {meSeat?.isReady ? 'Mark Not Ready' : 'Mark Ready'}
                    </button>
                  ) : null}
                  {view.legalActions.includes('StartGame') ? (
                    <button type="button" disabled={isBusy} onClick={handleStartGame}>
                      Start Game
                    </button>
                  ) : null}
                  {view.legalActions.includes('LeaveLobby') ? (
                    <button type="button" className="button-secondary" disabled={isBusy} onClick={handleLeaveLobby}>
                      Leave Lobby
                    </button>
                  ) : null}
                </div>
              </div>

              {me && view.legalActions.includes('BuildRoad') && view.turn.type !== 'resolving_road_building' ? (
                <div className="section-block">
                  <h2>Board Actions</h2>
                  <div className="button-row">
                    <button
                      type="button"
                      className={manualMode.kind === 'build_road' ? 'button-active' : undefined}
                      disabled={isBusy}
                      onClick={() => setManualMode((current) => current.kind === 'build_road' ? { kind: 'none' } : { kind: 'build_road' })}
                    >
                      Road
                    </button>
                    {view.legalActions.includes('BuildSettlement') ? (
                      <button
                        type="button"
                        className={manualMode.kind === 'build_settlement' ? 'button-active' : undefined}
                        disabled={isBusy}
                        onClick={() => setManualMode((current) => current.kind === 'build_settlement' ? { kind: 'none' } : { kind: 'build_settlement' })}
                      >
                        Settlement
                      </button>
                    ) : null}
                    {view.legalActions.includes('BuildCity') ? (
                      <button
                        type="button"
                        className={manualMode.kind === 'build_city' ? 'button-active' : undefined}
                        disabled={isBusy}
                        onClick={() => setManualMode((current) => current.kind === 'build_city' ? { kind: 'none' } : { kind: 'build_city' })}
                      >
                        City
                      </button>
                    ) : null}
                  </div>
                  <div className="button-row">
                    {view.legalActions.includes('BuyDevelopmentCard') ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void submitCommand({ type: 'BuyDevelopmentCard', seatId: me.seatId })}
                      >
                        Buy Dev Card
                      </button>
                    ) : null}
                    {view.legalActions.includes('EndTurn') ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void submitCommand({ type: 'EndTurn', seatId: me.seatId })}
                      >
                        End Turn
                      </button>
                    ) : null}
                    {manualMode.kind !== 'none' ? (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={isBusy}
                        onClick={() => setManualMode({ kind: 'none' })}
                      >
                        Clear Selection
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {me && view.legalActions.includes('RollDice') ? (
                <div className="section-block">
                  <h2>Turn</h2>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void submitCommand({ type: 'RollDice', seatId: me.seatId })}
                  >
                    Roll Dice
                  </button>
                </div>
              ) : null}

              {me && view.legalActions.includes('DiscardCards') ? (
                <div className="section-block">
                  <h2>Discard</h2>
                  <p className="muted">Discard exactly {discardTarget} cards.</p>
                  <ResourceEditor
                    hand={discardDraft}
                    disabled={isBusy}
                    onChange={(resource, value) => setDiscardDraft((current) => updateHand(current, resource, value))}
                  />
                  <button
                    type="button"
                    disabled={isBusy || totalHand(discardDraft) !== discardTarget}
                    onClick={() => void submitCommand({
                      type: 'DiscardCards',
                      seatId: me.seatId,
                      cards: discardDraft,
                    })}
                  >
                    Submit Discard
                  </button>
                </div>
              ) : null}

              {me && view.turn.type === 'await_robber_steal' && view.turn.seatId === me.seatId ? (
                <div className="section-block">
                  <h2>Robber</h2>
                  <p className="muted">Choose a player to rob.</p>
                  <div className="button-column">
                    {view.turn.eligibleVictimSeatIds.map((seatId) => {
                      const seat = getSeat(view, seatId)
                      if (!seat) {
                        return null
                      }
                      return (
                        <button
                          key={seatId}
                          type="button"
                          disabled={isBusy}
                          onClick={() => void submitCommand({
                            type: 'StealRandomCard',
                            seatId: me.seatId,
                            fromSeatId: seatId,
                          })}
                        >
                          {seat.displayName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {me && view.legalActions.includes('TradeWithBank') ? (
                <div className="section-block">
                  <h2>Bank Trade</h2>
                  <div className="inline-form">
                    <label className="field">
                      <span>Give</span>
                      <select
                        value={bankTrade.give}
                        disabled={isBusy}
                        onChange={(event) => setBankTrade((current) => ({
                          ...current,
                          give: event.target.value as Resource,
                        }))}
                      >
                        {RESOURCES.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Receive</span>
                      <select
                        value={bankTrade.receive}
                        disabled={isBusy}
                        onChange={(event) => setBankTrade((current) => ({
                          ...current,
                          receive: event.target.value as Resource,
                        }))}
                      >
                        {RESOURCES.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy || bankTrade.give === bankTrade.receive}
                    onClick={() => void submitCommand({
                      type: 'TradeWithBank',
                      seatId: me.seatId,
                      give: bankTrade.give,
                      receive: bankTrade.receive,
                    })}
                  >
                    Trade With Bank
                  </button>
                </div>
              ) : null}

              {me && view.legalActions.includes('OfferTrade') ? (
                <div className="section-block">
                  <h2>Player Trade</h2>
                  <div className="stack">
                    <div className="checkbox-grid">
                      {view.seats
                        .filter((seat) => seat.seatId !== me.seatId)
                        .map((seat) => (
                          <label key={seat.seatId} className="checkbox">
                            <input
                              type="checkbox"
                              checked={tradeTargets.includes(seat.seatId)}
                              disabled={isBusy}
                              onChange={() => setTradeTargets((current) => (
                                current.includes(seat.seatId)
                                  ? current.filter((seatId) => seatId !== seat.seatId)
                                  : [...current, seat.seatId]
                              ))}
                            />
                            <span>{seat.displayName}</span>
                          </label>
                        ))}
                    </div>
                    <div>
                      <span className="status-label">Offering</span>
                      <ResourceEditor
                        hand={tradeOffered}
                        disabled={isBusy}
                        onChange={(resource, value) => setTradeOffered((current) => updateHand(current, resource, value))}
                      />
                    </div>
                    <div>
                      <span className="status-label">Requesting</span>
                      <ResourceEditor
                        hand={tradeRequested}
                        disabled={isBusy}
                        onChange={(resource, value) => setTradeRequested((current) => updateHand(current, resource, value))}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isBusy || tradeTargets.length === 0 || totalHand(tradeOffered) === 0 || totalHand(tradeRequested) === 0}
                      onClick={() => void submitCommand({
                        type: 'OfferTrade',
                        seatId: me.seatId,
                        targetSeatIds: tradeTargets,
                        offered: tradeOffered,
                        requested: tradeRequested,
                      })}
                    >
                      Send Trade Offer
                    </button>
                  </div>
                </div>
              ) : null}

              {view.trade ? (
                <div className="section-block">
                  <h2>Open Trade</h2>
                  <div className="trade-summary">
                    <div>
                      <span className="status-label">From</span>
                      <strong>{seatName(view, view.trade.fromSeatId)}</strong>
                    </div>
                    <div>
                      <span className="status-label">Targets</span>
                      <strong>{view.trade.targetSeatIds.map((seatId) => seatName(view, seatId)).join(', ')}</strong>
                    </div>
                    <div>
                      <span className="status-label">Offered</span>
                      <strong>{RESOURCES.map((resource) => `${resource}:${view.trade?.offered[resource]}`).join(' ')}</strong>
                    </div>
                    <div>
                      <span className="status-label">Requested</span>
                      <strong>{RESOURCES.map((resource) => `${resource}:${view.trade?.requested[resource]}`).join(' ')}</strong>
                    </div>
                  </div>

                  {me && view.turn.type === 'await_trade_responses' && view.turn.seatId === me.seatId ? (
                    <div className="stack">
                      <div className="button-column">
                        {view.trade.acceptedSeatIds.map((seatId) => (
                          <button
                            key={seatId}
                            type="button"
                            disabled={isBusy}
                            onClick={() => void submitCommand({
                              type: 'FinalizeTrade',
                              seatId: me.seatId,
                              offerId: view.trade!.offerId,
                              targetSeatId: seatId,
                            })}
                          >
                            Finalize With {seatName(view, seatId)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={isBusy}
                        onClick={() => void submitCommand({
                          type: 'CancelTrade',
                          seatId: me.seatId,
                          offerId: view.trade!.offerId,
                        })}
                      >
                        Cancel Trade
                      </button>
                    </div>
                  ) : null}

                  {me && view.turn.type === 'await_trade_responses' && view.turn.pendingSeatIds.includes(me.seatId) ? (
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void submitCommand({
                          type: 'RespondToTrade',
                          seatId: me.seatId,
                          offerId: view.trade!.offerId,
                          accepted: true,
                        })}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={isBusy}
                        onClick={() => void submitCommand({
                          type: 'RespondToTrade',
                          seatId: me.seatId,
                          offerId: view.trade!.offerId,
                          accepted: false,
                        })}
                      >
                        Decline
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="panel panel-board">
          <div className="board-header">
            <div>
              <h2>Board</h2>
              <p className="muted">
                {boardIntent?.label ??
                  (view?.status === 'lobby'
                    ? 'Waiting for game to start...'
                    : view?.turn && 'seatId' in view.turn && view.turn.seatId !== view?.me?.seatId
                      ? `Waiting for ${seatName(view, view.turn.seatId)}...`
                      : 'Select an action to make board pieces clickable.')}
              </p>
            </div>
            {view?.turnOrder.length ? (
              <div className="turn-order">
                <span className="status-label">Order</span>
                <strong>{view.turnOrder.map((seatId) => seatName(view, seatId)).join(' -> ')}</strong>
              </div>
            ) : null}
          </div>

          <div className="board-frame">
            {view ? (
              <BoardView
                view={view}
                intent={boardIntent}
                onHexSelect={(hexId) => void handleHexSelect(hexId)}
                onEdgeSelect={(edgeId) => void handleEdgeSelect(edgeId)}
                onIntersectionSelect={(intersectionId) => void handleIntersectionSelect(intersectionId)}
              />
            ) : (
              <div className="empty-state">Create or join a lobby to load a game.</div>
            )}
          </div>
        </section>

        <section className="panel stack">
          <div className="section-block">
            <h2>Players</h2>
            {view ? (
              <div className="seat-list">
                {view.turnOrder.map((seatId, index) => {
                  const seat = view.seats.find((s) => s.seatId === seatId)
                  if (!seat) return null
                  const isCurrentTurn =
                    ('seatId' in view.turn && view.turn.seatId === seatId) ||
                    (view.turn.type === 'lobby' && index === 0)
                  return (
                    <div
                      key={seat.seatId}
                      className={`seat-card seat-${seat.color}${seat.seatId === me?.seatId ? ' seat-card-active' : ''}${isCurrentTurn ? ' seat-card-turn' : ''}`}
                    >
                      <div className="seat-card-header">
                        <strong>
                          {isCurrentTurn ? '→ ' : ''}
                          {seat.displayName}
                        </strong>
                        <span>{seat.color}</span>
                      </div>
                      <div className="seat-card-grid">
                        <span>Ready: {seat.isReady ? 'yes' : 'no'}</span>
                        <span>Connected: {seat.isConnected ? 'yes' : 'no'}</span>
                        <span>Resources: {seat.resourceCardCount}</span>
                        <span>Dev Cards: {seat.developmentCardCount}</span>
                        <span>VP: {seat.publicVictoryPoints}</span>
                        <span>Knight: {seat.playedKnightCount}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">No players yet.</div>
            )}
          </div>

          {me ? (
            <>
              <div className="section-block">
                <h2>My Hand</h2>
                <div className="resource-totals">
                  {RESOURCES.map((resource) => (
                    <div key={resource} className="resource-total">
                      <span>{resource}</span>
                      <strong>{me.resources[resource]}</strong>
                    </div>
                  ))}
                </div>
                <div className="info-grid">
                  <div>
                    <span className="status-label">Visible VP</span>
                    <strong>{me.visibleVictoryPoints}</strong>
                  </div>
                  <div>
                    <span className="status-label">Total Score</span>
                    <strong>{me.score}</strong>
                  </div>
                  <div>
                    <span className="status-label">Roads Left</span>
                    <strong>{meSeat?.roadsRemaining ?? 0}</strong>
                  </div>
                  <div>
                    <span className="status-label">Settlements Left</span>
                    <strong>{meSeat?.settlementsRemaining ?? 0}</strong>
                  </div>
                  <div>
                    <span className="status-label">Cities Left</span>
                    <strong>{meSeat?.citiesRemaining ?? 0}</strong>
                  </div>
                  <div>
                    <span className="status-label">Public Awards</span>
                    <strong>
                      {view?.awards.longestRoadSeatId === me.seatId ? 'Longest Road ' : ''}
                      {view?.awards.largestArmySeatId === me.seatId ? 'Largest Army' : ''}
                      {view?.awards.longestRoadSeatId !== me.seatId && view?.awards.largestArmySeatId !== me.seatId ? 'None' : ''}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="section-block">
                <h2>Development Cards</h2>
                {me.devCards.length === 0 ? (
                  <div className="empty-state">No development cards.</div>
                ) : (
                  <div className="stack">
                    {me.devCards.map((card) => (
                      <div key={card.id} className="card-row">
                        <div>
                          <strong>{card.type.replaceAll('_', ' ')}</strong>
                          <p className="muted tight">
                            {card.played ? 'Played' : `Bought on turn ${card.purchasedOnTurn}`}
                          </p>
                        </div>

                        {card.type === 'knight' && !card.played && view?.legalActions.includes('PlayKnight') ? (
                          <button
                            type="button"
                            className={manualMode.kind === 'play_knight' && manualMode.cardId === card.id ? 'button-active' : undefined}
                            disabled={isBusy}
                            onClick={() => setManualMode((current) => (
                              current.kind === 'play_knight' && current.cardId === card.id
                                ? { kind: 'none' }
                                : { kind: 'play_knight', cardId: card.id }
                            ))}
                          >
                            Select Hex
                          </button>
                        ) : null}

                        {card.type === 'road_building' && !card.played && view?.legalActions.includes('PlayRoadBuilding') ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void submitCommand({
                              type: 'PlayRoadBuilding',
                              seatId: me.seatId,
                              cardId: card.id,
                            })}
                          >
                            Play
                          </button>
                        ) : null}
                      </div>
                    ))}

                    {yearOfPlentyCards.length > 0 && view?.legalActions.includes('PlayYearOfPlenty') ? (
                      <div className="inline-section">
                        <h3>Year of Plenty</h3>
                        <div className="inline-form">
                          <label className="field">
                            <span>Card</span>
                            <select
                              value={yearOfPlenty.cardId}
                              disabled={isBusy}
                              onChange={(event) => setYearOfPlenty((current) => ({
                                ...current,
                                cardId: event.target.value,
                              }))}
                            >
                              {yearOfPlentyCards.map((card) => <option key={card.id} value={card.id}>{card.id}</option>)}
                            </select>
                          </label>
                          <label className="field">
                            <span>First</span>
                            <select
                              value={yearOfPlenty.first}
                              disabled={isBusy}
                              onChange={(event) => setYearOfPlenty((current) => ({
                                ...current,
                                first: event.target.value as Resource,
                              }))}
                            >
                              {RESOURCES.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
                            </select>
                          </label>
                          <label className="field">
                            <span>Second</span>
                            <select
                              value={yearOfPlenty.second}
                              disabled={isBusy}
                              onChange={(event) => setYearOfPlenty((current) => ({
                                ...current,
                                second: event.target.value as Resource,
                              }))}
                            >
                              {RESOURCES.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy || !yearOfPlenty.cardId}
                          onClick={() => void submitCommand({
                            type: 'PlayYearOfPlenty',
                            seatId: me.seatId,
                            cardId: yearOfPlenty.cardId,
                            resources: [yearOfPlenty.first, yearOfPlenty.second],
                          })}
                        >
                          Resolve Year of Plenty
                        </button>
                      </div>
                    ) : null}

                    {monopolyCards.length > 0 && view?.legalActions.includes('PlayMonopoly') ? (
                      <div className="inline-section">
                        <h3>Monopoly</h3>
                        <div className="inline-form">
                          <label className="field">
                            <span>Card</span>
                            <select
                              value={monopoly.cardId}
                              disabled={isBusy}
                              onChange={(event) => setMonopoly((current) => ({
                                ...current,
                                cardId: event.target.value,
                              }))}
                            >
                              {monopolyCards.map((card) => <option key={card.id} value={card.id}>{card.id}</option>)}
                            </select>
                          </label>
                          <label className="field">
                            <span>Resource</span>
                            <select
                              value={monopoly.resource}
                              disabled={isBusy}
                              onChange={(event) => setMonopoly((current) => ({
                                ...current,
                                resource: event.target.value as Resource,
                              }))}
                            >
                              {RESOURCES.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy || !monopoly.cardId}
                          onClick={() => void submitCommand({
                            type: 'PlayMonopoly',
                            seatId: me.seatId,
                            cardId: monopoly.cardId,
                            resource: monopoly.resource,
                          })}
                        >
                          Play Monopoly
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="section-block">
              <h2>Private Seat</h2>
              <div className="empty-state">Join the lobby to see private cards and controls.</div>
            </div>
          )}

          {view ? (
            <div className="section-block">
              <h2>Awards</h2>
              <div className="info-grid">
                <div>
                  <span className="status-label">Longest Road</span>
                  <strong>{seatName(view, view.awards.longestRoadSeatId)}</strong>
                </div>
                <div>
                  <span className="status-label">Road Length</span>
                  <strong>{view.awards.longestRoadLength}</strong>
                </div>
                <div>
                  <span className="status-label">Largest Army</span>
                  <strong>{seatName(view, view.awards.largestArmySeatId)}</strong>
                </div>
                <div>
                  <span className="status-label">Army Size</span>
                  <strong>{view.awards.largestArmySize}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default App
