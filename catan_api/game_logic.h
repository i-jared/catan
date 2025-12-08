#pragma once

#include "catan_types.h"
#include <set>
#include <queue>

namespace catan {

// ============================================================================
// PORT TRADING LOGIC
// ============================================================================

// Get the trade ratio for a player and resource
// Returns 4 for normal trade, 3 for generic port, 2 for resource-specific port
int getTradeRatio(const Game& game, int playerId, Resource resource);

// Check if a player has access to a specific port type
bool playerHasPort(const Game& game, int playerId, PortType portType);

// ============================================================================
// LONGEST ROAD CALCULATION
// ============================================================================

// Calculate the longest road length for a player
int calculateLongestRoad(const Game& game, int playerId);

// Update longest road holder (call after any road is built)
void updateLongestRoad(Game& game);

// ============================================================================
// LARGEST ARMY TRACKING
// ============================================================================

// Update largest army holder (call after any knight is played)
void updateLargestArmy(Game& game);

// ============================================================================
// VICTORY POINT CALCULATION
// ============================================================================

// Calculate total victory points for a player (including hidden VP cards)
int calculateVictoryPoints(const Game& game, int playerId, bool includeHidden = true);

// Calculate visible victory points (what other players can see)
int calculateVisibleVictoryPoints(const Game& game, int playerId);

// Check if any player has won (10+ VP)
// Returns player ID of winner, or -1 if no winner
int checkForWinner(const Game& game);

// ============================================================================
// SETUP PHASE LOGIC
// ============================================================================

// Get valid settlement locations for setup phase
std::vector<VertexCoord> getValidSetupSettlementLocations(const Game& game);

// Get valid road locations for setup phase (must connect to just-placed settlement)
std::vector<EdgeCoord> getValidSetupRoadLocations(const Game& game, const VertexCoord& settlement);

// Place initial settlement during setup
bool placeSetupSettlement(Game& game, int playerId, const VertexCoord& location);

// Place initial road during setup (must connect to last placed settlement)
bool placeSetupRoad(Game& game, int playerId, const EdgeCoord& location);

// Advance setup phase to next player or next phase
void advanceSetupPhase(Game& game);

// Give initial resources based on second settlement placement
void giveInitialResources(Game& game, int playerId, const VertexCoord& settlementLocation);

// ============================================================================
// BUILDING VALIDATION
// ============================================================================

// Get all valid settlement locations for a player (main game, not setup)
std::vector<VertexCoord> getValidSettlementLocations(const Game& game, int playerId);

// Get all valid road locations for a player
std::vector<EdgeCoord> getValidRoadLocations(const Game& game, int playerId);

// Get all valid city upgrade locations for a player
std::vector<VertexCoord> getValidCityLocations(const Game& game, int playerId);

// Check if a vertex is at least 2 edges away from any existing settlement/city
bool isVertexDistanceValid(const Game& game, const VertexCoord& vertex);

// Check if a road connects to player's existing network
bool isRoadConnectedToNetwork(const Game& game, int playerId, const EdgeCoord& edge);

// ============================================================================
// COORDINATE HELPERS
// ============================================================================

// Get vertices adjacent to a vertex (the 2-3 neighboring vertices)
std::vector<VertexCoord> getAdjacentVertices(const VertexCoord& vertex);

// Get edges adjacent to a vertex (the 3 edges that touch this vertex)
std::vector<EdgeCoord> getEdgesAtVertex(const VertexCoord& vertex);

// Get vertices at the ends of an edge
std::pair<VertexCoord, VertexCoord> getVerticesOfEdge(const EdgeCoord& edge);

// Normalize vertex coordinate (vertices can be represented multiple ways)
VertexCoord normalizeVertex(const VertexCoord& vertex);

// Normalize edge coordinate
EdgeCoord normalizeEdge(const EdgeCoord& edge);

// Check if two vertices are the same (accounting for multiple representations)
bool verticesEqual(const VertexCoord& v1, const VertexCoord& v2);

// Check if two edges are the same
bool edgesEqual(const EdgeCoord& e1, const EdgeCoord& e2);

}  // namespace catan
