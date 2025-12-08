import { useMemo } from 'react';
import type { HexInfo, VertexInfo, EdgeInfo, PortInfo, BoardLocation, Player } from './types';

// ============================================================================
// COORDINATE SYSTEM
// ============================================================================

// Hex size and spacing
const HEX_SIZE = 50;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = 2 * HEX_SIZE;

// Convert axial coordinates to pixel position
function axialToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = HEX_SIZE * (3 / 2 * r);
  return { x, y };
}

// Get vertex position (direction 0-5 around hex)
function getVertexPosition(q: number, r: number, direction: number): { x: number; y: number } {
  const center = axialToPixel(q, r);
  const angle = (Math.PI / 3) * direction - Math.PI / 2;
  return {
    x: center.x + HEX_SIZE * Math.cos(angle),
    y: center.y + HEX_SIZE * Math.sin(angle),
  };
}

// Get edge center position
function getEdgePosition(q: number, r: number, direction: number): { x: number; y: number; angle: number } {
  const v1 = getVertexPosition(q, r, direction);
  const v2 = getVertexPosition(q, r, (direction + 1) % 6);
  const angle = Math.atan2(v2.y - v1.y, v2.x - v1.x);
  return {
    x: (v1.x + v2.x) / 2,
    y: (v1.y + v2.y) / 2,
    angle: angle * 180 / Math.PI,
  };
}

// ============================================================================
// HEX COLORS
// ============================================================================

const HEX_COLORS: Record<string, string> = {
  desert: '#F4D03F',
  forest: '#27AE60',
  hills: '#E74C3C',
  fields: '#F39C12',
  pasture: '#82E0AA',
  mountains: '#95A5A6',
  ocean: '#3498DB',
};

const HEX_EMOJIS: Record<string, string> = {
  desert: '🏜️',
  forest: '🌲',
  hills: '🧱',
  fields: '🌾',
  pasture: '🐑',
  mountains: '⛰️',
};

const PLAYER_COLORS = ['#E74C3C', '#3498DB', '#F39C12', '#9B59B6'];

// ============================================================================
// COMPONENT PROPS
// ============================================================================

interface HexBoardProps {
  hexes: HexInfo[];
  vertices: VertexInfo[];
  edges: EdgeInfo[];
  ports: PortInfo[];
  robberLocation: { q: number; r: number };
  players: Player[];
  yourPlayerId: number;
  validSettlementLocations?: BoardLocation[];
  validRoadLocations?: BoardLocation[];
  validCityLocations?: BoardLocation[];
  onVertexClick?: (hexQ: number, hexR: number, direction: number) => void;
  onEdgeClick?: (hexQ: number, hexR: number, direction: number) => void;
  buildMode: 'none' | 'settlement' | 'road' | 'city';
}

// ============================================================================
// HEX COMPONENT
// ============================================================================

function Hex({ hex, hasRobber }: { hex: HexInfo; hasRobber: boolean }) {
  const { x, y } = axialToPixel(hex.q, hex.r);
  
  // Create hexagon points
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    return `${px},${py}`;
  }).join(' ');
  
  const color = HEX_COLORS[hex.type] || '#888';
  const emoji = HEX_EMOJIS[hex.type] || '';
  
  return (
    <g className="hex">
      <polygon
        points={points}
        fill={color}
        stroke="#2C3E50"
        strokeWidth="2"
      />
      {/* Resource emoji */}
      {emoji && (
        <text x={x} y={y - 8} textAnchor="middle" fontSize="20">
          {emoji}
        </text>
      )}
      {/* Number token */}
      {hex.numberToken > 0 && (
        <>
          <circle cx={x} cy={y + 12} r="14" fill="#FDF2E9" stroke="#2C3E50" strokeWidth="1" />
          <text
            x={x}
            y={y + 17}
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill={hex.numberToken === 6 || hex.numberToken === 8 ? '#E74C3C' : '#2C3E50'}
          >
            {hex.numberToken}
          </text>
        </>
      )}
      {/* Robber */}
      {hasRobber && (
        <text x={x} y={y + 35} textAnchor="middle" fontSize="24">
          🦹
        </text>
      )}
    </g>
  );
}

// ============================================================================
// BUILDING COMPONENT
// ============================================================================

function Building({ vertex, playerColor }: { vertex: VertexInfo; playerColor: string }) {
  const pos = getVertexPosition(vertex.hexQ, vertex.hexR, vertex.direction);
  
  if (vertex.building === 'settlement') {
    return (
      <g className="building settlement">
        <polygon
          points={`${pos.x},${pos.y - 10} ${pos.x - 8},${pos.y} ${pos.x - 8},${pos.y + 8} ${pos.x + 8},${pos.y + 8} ${pos.x + 8},${pos.y}`}
          fill={playerColor}
          stroke="#2C3E50"
          strokeWidth="2"
        />
      </g>
    );
  }
  
  if (vertex.building === 'city') {
    return (
      <g className="building city">
        <rect
          x={pos.x - 10}
          y={pos.y - 8}
          width="20"
          height="16"
          fill={playerColor}
          stroke="#2C3E50"
          strokeWidth="2"
        />
        <polygon
          points={`${pos.x - 10},${pos.y - 8} ${pos.x},${pos.y - 16} ${pos.x + 10},${pos.y - 8}`}
          fill={playerColor}
          stroke="#2C3E50"
          strokeWidth="2"
        />
      </g>
    );
  }
  
  return null;
}

// ============================================================================
// ROAD COMPONENT
// ============================================================================

function Road({ edge, playerColor }: { edge: EdgeInfo; playerColor: string }) {
  const pos = getEdgePosition(edge.hexQ, edge.hexR, edge.direction);
  
  return (
    <g className="road" transform={`translate(${pos.x}, ${pos.y}) rotate(${pos.angle})`}>
      <rect
        x="-18"
        y="-4"
        width="36"
        height="8"
        fill={playerColor}
        stroke="#2C3E50"
        strokeWidth="1.5"
        rx="2"
      />
    </g>
  );
}

// ============================================================================
// CLICKABLE AREAS
// ============================================================================

function ClickableVertex({
  hexQ,
  hexR,
  direction,
  isValid,
  onClick,
  buildMode,
}: {
  hexQ: number;
  hexR: number;
  direction: number;
  isValid: boolean;
  onClick: () => void;
  buildMode: 'settlement' | 'city';
}) {
  const pos = getVertexPosition(hexQ, hexR, direction);
  
  if (!isValid) return null;
  
  return (
    <g className="clickable-vertex" onClick={onClick} style={{ cursor: 'pointer' }}>
      <circle
        cx={pos.x}
        cy={pos.y}
        r="12"
        fill={buildMode === 'city' ? '#9B59B6' : '#2ECC71'}
        fillOpacity="0.7"
        stroke="#FFF"
        strokeWidth="2"
        className="pulse-animation"
      />
      <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="12" fill="#FFF">
        {buildMode === 'city' ? '🏰' : '🏠'}
      </text>
    </g>
  );
}

function ClickableEdge({
  hexQ,
  hexR,
  direction,
  isValid,
  onClick,
}: {
  hexQ: number;
  hexR: number;
  direction: number;
  isValid: boolean;
  onClick: () => void;
}) {
  const pos = getEdgePosition(hexQ, hexR, direction);
  
  if (!isValid) return null;
  
  return (
    <g
      className="clickable-edge"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      transform={`translate(${pos.x}, ${pos.y}) rotate(${pos.angle})`}
    >
      <rect
        x="-20"
        y="-6"
        width="40"
        height="12"
        fill="#2ECC71"
        fillOpacity="0.7"
        stroke="#FFF"
        strokeWidth="2"
        rx="3"
        className="pulse-animation"
      />
    </g>
  );
}

// ============================================================================
// PORT COMPONENT
// ============================================================================

function Port({ port }: { port: PortInfo }) {
  const v1 = getVertexPosition(port.v1q, port.v1r, port.v1d);
  const v2 = getVertexPosition(port.v2q, port.v2r, port.v2d);
  const midX = (v1.x + v2.x) / 2;
  const midY = (v1.y + v2.y) / 2;
  
  // Move port indicator outward from board center
  const offsetX = midX * 0.15;
  const offsetY = midY * 0.15;
  
  const portLabel = port.type === 'generic' ? '3:1' : '2:1';
  const portEmoji = port.type === 'generic' ? '⚓' : 
    port.type === 'wood' ? '🪵' :
    port.type === 'brick' ? '🧱' :
    port.type === 'wheat' ? '🌾' :
    port.type === 'sheep' ? '🐑' :
    port.type === 'ore' ? '💎' : '⚓';
  
  return (
    <g className="port">
      <line
        x1={v1.x}
        y1={v1.y}
        x2={midX + offsetX}
        y2={midY + offsetY}
        stroke="#8B4513"
        strokeWidth="3"
        strokeDasharray="4,4"
      />
      <circle
        cx={midX + offsetX}
        cy={midY + offsetY}
        r="16"
        fill="#DEB887"
        stroke="#8B4513"
        strokeWidth="2"
      />
      <text x={midX + offsetX} y={midY + offsetY - 4} textAnchor="middle" fontSize="10">
        {portEmoji}
      </text>
      <text x={midX + offsetX} y={midY + offsetY + 8} textAnchor="middle" fontSize="8" fontWeight="bold">
        {portLabel}
      </text>
    </g>
  );
}

// ============================================================================
// MAIN HEX BOARD COMPONENT
// ============================================================================

export function HexBoard({
  hexes,
  vertices,
  edges,
  ports,
  robberLocation,
  players,
  yourPlayerId,
  validSettlementLocations = [],
  validRoadLocations = [],
  validCityLocations = [],
  onVertexClick,
  onEdgeClick,
  buildMode,
}: HexBoardProps) {
  // Create lookup maps for valid locations
  const validSettlementSet = useMemo(() => {
    const set = new Set<string>();
    validSettlementLocations.forEach(loc => {
      set.add(`${loc.hexQ},${loc.hexR},${loc.direction}`);
    });
    return set;
  }, [validSettlementLocations]);
  
  const validRoadSet = useMemo(() => {
    const set = new Set<string>();
    validRoadLocations.forEach(loc => {
      set.add(`${loc.hexQ},${loc.hexR},${loc.direction}`);
    });
    return set;
  }, [validRoadLocations]);
  
  const validCitySet = useMemo(() => {
    const set = new Set<string>();
    validCityLocations.forEach(loc => {
      set.add(`${loc.hexQ},${loc.hexR},${loc.direction}`);
    });
    return set;
  }, [validCityLocations]);
  
  // Get player color
  const getPlayerColor = (playerId: number) => PLAYER_COLORS[playerId % PLAYER_COLORS.length];
  
  // Calculate board bounds for viewBox
  const allPositions = hexes.map(h => axialToPixel(h.q, h.r));
  const minX = Math.min(...allPositions.map(p => p.x)) - HEX_WIDTH;
  const maxX = Math.max(...allPositions.map(p => p.x)) + HEX_WIDTH;
  const minY = Math.min(...allPositions.map(p => p.y)) - HEX_HEIGHT;
  const maxY = Math.max(...allPositions.map(p => p.y)) + HEX_HEIGHT;
  
  const viewBox = `${minX - 40} ${minY - 40} ${maxX - minX + 80} ${maxY - minY + 80}`;
  
  // Generate all possible vertex positions for clickable areas
  const allVertexPositions = useMemo(() => {
    const positions: { hexQ: number; hexR: number; direction: number }[] = [];
    hexes.forEach(hex => {
      for (let d = 0; d < 6; d++) {
        positions.push({ hexQ: hex.q, hexR: hex.r, direction: d });
      }
    });
    return positions;
  }, [hexes]);
  
  // Generate all possible edge positions
  const allEdgePositions = useMemo(() => {
    const positions: { hexQ: number; hexR: number; direction: number }[] = [];
    hexes.forEach(hex => {
      for (let d = 0; d < 6; d++) {
        positions.push({ hexQ: hex.q, hexR: hex.r, direction: d });
      }
    });
    return positions;
  }, [hexes]);
  
  return (
    <div className="hex-board-container">
      <svg
        viewBox={viewBox}
        className="hex-board-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <style>{`
            .pulse-animation {
              animation: pulse 1.5s ease-in-out infinite;
            }
            @keyframes pulse {
              0%, 100% { opacity: 0.7; transform: scale(1); }
              50% { opacity: 1; transform: scale(1.1); }
            }
          `}</style>
        </defs>
        
        {/* Ports (render first, behind hexes) */}
        <g className="ports-layer">
          {ports.map((port, i) => (
            <Port key={i} port={port} />
          ))}
        </g>
        
        {/* Hexes */}
        <g className="hexes-layer">
          {hexes.map(hex => (
            <Hex
              key={`${hex.q},${hex.r}`}
              hex={hex}
              hasRobber={hex.q === robberLocation.q && hex.r === robberLocation.r}
            />
          ))}
        </g>
        
        {/* Roads */}
        <g className="roads-layer">
          {edges.map(edge => (
            <Road
              key={`${edge.hexQ},${edge.hexR},${edge.direction}`}
              edge={edge}
              playerColor={getPlayerColor(edge.playerId)}
            />
          ))}
        </g>
        
        {/* Buildings */}
        <g className="buildings-layer">
          {vertices.map(vertex => (
            <Building
              key={`${vertex.hexQ},${vertex.hexR},${vertex.direction}`}
              vertex={vertex}
              playerColor={getPlayerColor(vertex.playerId)}
            />
          ))}
        </g>
        
        {/* Clickable road areas (when in road build mode) */}
        {buildMode === 'road' && (
          <g className="clickable-edges-layer">
            {allEdgePositions.map(pos => {
              const key = `${pos.hexQ},${pos.hexR},${pos.direction}`;
              const isValid = validRoadSet.has(key);
              return (
                <ClickableEdge
                  key={key}
                  hexQ={pos.hexQ}
                  hexR={pos.hexR}
                  direction={pos.direction}
                  isValid={isValid}
                  onClick={() => onEdgeClick?.(pos.hexQ, pos.hexR, pos.direction)}
                />
              );
            })}
          </g>
        )}
        
        {/* Clickable vertex areas (when in settlement/city build mode) */}
        {(buildMode === 'settlement' || buildMode === 'city') && (
          <g className="clickable-vertices-layer">
            {allVertexPositions.map(pos => {
              const key = `${pos.hexQ},${pos.hexR},${pos.direction}`;
              const isValid = buildMode === 'city' 
                ? validCitySet.has(key)
                : validSettlementSet.has(key);
              return (
                <ClickableVertex
                  key={key}
                  hexQ={pos.hexQ}
                  hexR={pos.hexR}
                  direction={pos.direction}
                  isValid={isValid}
                  onClick={() => onVertexClick?.(pos.hexQ, pos.hexR, pos.direction)}
                  buildMode={buildMode}
                />
              );
            })}
          </g>
        )}
      </svg>
      
      {/* Legend */}
      <div className="board-legend">
        {players.map(player => (
          <div key={player.id} className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: getPlayerColor(player.id) }}
            />
            <span className="legend-name">
              {player.name}
              {player.id === yourPlayerId && ' (You)'}
            </span>
            <span className="legend-vp">{player.victoryPoints} VP</span>
          </div>
        ))}
      </div>
    </div>
  );
}
