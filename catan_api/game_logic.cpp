#include "game_logic.h"
#include <algorithm>
#include <unordered_set>

namespace catan {

// Direction offsets for axial hex coordinates
static const int HEX_DIRS[6][2] = {
    {0, -1},  // 0: N
    {1, -1},  // 1: NE
    {1, 0},   // 2: SE
    {0, 1},   // 3: S
    {-1, 1},  // 4: SW
    {-1, 0}   // 5: NW
};

// ============================================================================
// COORDINATE HELPERS
// ============================================================================

VertexCoord normalizeVertex(const VertexCoord& vertex) {
    // Vertices can be represented from 3 different hexes
    // Normalize to the canonical form (lowest hex coord, direction 0-1)
    // For simplicity, we use the representation as-is but ensure direction is 0-5
    VertexCoord norm = vertex;
    norm.direction = ((norm.direction % 6) + 6) % 6;
    return norm;
}

EdgeCoord normalizeEdge(const EdgeCoord& edge) {
    EdgeCoord norm = edge;
    norm.direction = ((norm.direction % 6) + 6) % 6;
    return norm;
}

std::vector<VertexCoord> getAdjacentVertices(const VertexCoord& vertex) {
    std::vector<VertexCoord> result;
    int d = vertex.direction;
    
    // Each vertex has 2-3 adjacent vertices
    // Adjacent in clockwise direction on same hex
    result.push_back({vertex.hex, (d + 1) % 6});
    // Adjacent in counter-clockwise direction on same hex
    result.push_back({vertex.hex, (d + 5) % 6});
    
    // Adjacent vertex on neighboring hex
    HexCoord neighbor = {
        vertex.hex.q + HEX_DIRS[d][0],
        vertex.hex.r + HEX_DIRS[d][1]
    };
    result.push_back({neighbor, (d + 3) % 6});
    
    return result;
}

std::vector<EdgeCoord> getEdgesAtVertex(const VertexCoord& vertex) {
    std::vector<EdgeCoord> result;
    int d = vertex.direction;
    
    // Each vertex touches 3 edges
    result.push_back({vertex.hex, d});
    result.push_back({vertex.hex, (d + 5) % 6});
    
    HexCoord neighbor = {
        vertex.hex.q + HEX_DIRS[d][0],
        vertex.hex.r + HEX_DIRS[d][1]
    };
    result.push_back({neighbor, (d + 4) % 6});
    
    return result;
}

std::pair<VertexCoord, VertexCoord> getVerticesOfEdge(const EdgeCoord& edge) {
    // An edge connects two vertices
    int d = edge.direction;
    VertexCoord v1 = {edge.hex, d};
    VertexCoord v2 = {edge.hex, (d + 1) % 6};
    return {v1, v2};
}

bool verticesEqual(const VertexCoord& v1, const VertexCoord& v2) {
    // Check if two vertex coords refer to the same vertex
    // Vertices can be represented from multiple hexes
    if (v1.hex == v2.hex && v1.direction == v2.direction) return true;
    
    // Check alternate representations
    auto adj = getAdjacentVertices(v1);
    // The "opposite" representation is on a neighboring hex
    HexCoord n1 = {v1.hex.q + HEX_DIRS[v1.direction][0], v1.hex.r + HEX_DIRS[v1.direction][1]};
    if (n1 == v2.hex && (v1.direction + 3) % 6 == v2.direction) return true;
    
    HexCoord n2 = {v1.hex.q + HEX_DIRS[(v1.direction + 5) % 6][0], v1.hex.r + HEX_DIRS[(v1.direction + 5) % 6][1]};
    if (n2 == v2.hex && (v1.direction + 4) % 6 == v2.direction) return true;
    
    return false;
}

bool edgesEqual(const EdgeCoord& e1, const EdgeCoord& e2) {
    if (e1.hex == e2.hex && e1.direction == e2.direction) return true;
    
    // Check alternate representation (from neighboring hex)
    int d = e1.direction;
    HexCoord neighbor = {e1.hex.q + HEX_DIRS[d][0], e1.hex.r + HEX_DIRS[d][1]};
    if (neighbor == e2.hex && (d + 3) % 6 == e2.direction) return true;
    
    return false;
}

// ============================================================================
// PORT TRADING LOGIC
// ============================================================================

bool playerHasPort(const Game& game, int playerId, PortType portType) {
    // Check if player has a settlement/city adjacent to a port of given type
    for (const auto& port : game.board.ports) {
        // Check vertex1
        auto it1 = game.board.vertices.find(port.vertex1);
        if (it1 != game.board.vertices.end() && 
            it1->second.ownerPlayerId == playerId &&
            it1->second.building != Building::None) {
            if (port.type == portType) return true;
        }
        
        // Check vertex2
        auto it2 = game.board.vertices.find(port.vertex2);
        if (it2 != game.board.vertices.end() && 
            it2->second.ownerPlayerId == playerId &&
            it2->second.building != Building::None) {
            if (port.type == portType) return true;
        }
    }
    return false;
}

int getTradeRatio(const Game& game, int playerId, Resource resource) {
    // Check for 2:1 resource-specific port
    PortType specificPort;
    switch (resource) {
        case Resource::Wood: specificPort = PortType::Wood; break;
        case Resource::Brick: specificPort = PortType::Brick; break;
        case Resource::Wheat: specificPort = PortType::Wheat; break;
        case Resource::Sheep: specificPort = PortType::Sheep; break;
        case Resource::Ore: specificPort = PortType::Ore; break;
        default: return 4;
    }
    
    if (playerHasPort(game, playerId, specificPort)) {
        return 2;
    }
    
    // Check for 3:1 generic port
    if (playerHasPort(game, playerId, PortType::Generic)) {
        return 3;
    }
    
    // Default 4:1
    return 4;
}

// ============================================================================
// LONGEST ROAD CALCULATION
// ============================================================================

// DFS helper for longest road
static int longestRoadDFS(const Game& game, int playerId, 
                          const EdgeCoord& currentEdge,
                          std::unordered_set<std::string>& visited,
                          int depth) {
    // Create a key for this edge
    std::string key = std::to_string(currentEdge.hex.q) + "," + 
                      std::to_string(currentEdge.hex.r) + "," + 
                      std::to_string(currentEdge.direction);
    
    if (visited.count(key)) return depth - 1;
    visited.insert(key);
    
    int maxLength = depth;
    
    // Get the two vertices of this edge
    auto [v1, v2] = getVerticesOfEdge(currentEdge);
    
    // For each vertex, check if we can continue (no opponent settlement blocking)
    for (const auto& vertex : {v1, v2}) {
        // Check if there's an opponent's settlement/city blocking
        auto vIt = game.board.vertices.find(vertex);
        if (vIt != game.board.vertices.end() && 
            vIt->second.building != Building::None &&
            vIt->second.ownerPlayerId != playerId) {
            continue;  // Blocked by opponent
        }
        
        // Get edges at this vertex and try to continue
        auto edges = getEdgesAtVertex(vertex);
        for (const auto& nextEdge : edges) {
            // Check if this edge has our road
            auto eIt = game.board.edges.find(nextEdge);
            if (eIt != game.board.edges.end() && 
                eIt->second.hasRoad && 
                eIt->second.ownerPlayerId == playerId) {
                // Check normalized form too
                std::string nextKey = std::to_string(nextEdge.hex.q) + "," + 
                                     std::to_string(nextEdge.hex.r) + "," + 
                                     std::to_string(nextEdge.direction);
                if (!visited.count(nextKey)) {
                    int length = longestRoadDFS(game, playerId, nextEdge, visited, depth + 1);
                    maxLength = std::max(maxLength, length);
                }
            }
        }
    }
    
    visited.erase(key);
    return maxLength;
}

int calculateLongestRoad(const Game& game, int playerId) {
    int longest = 0;
    
    // Try starting from each of the player's roads
    for (const auto& [coord, edge] : game.board.edges) {
        if (edge.hasRoad && edge.ownerPlayerId == playerId) {
            std::unordered_set<std::string> visited;
            int length = longestRoadDFS(game, playerId, coord, visited, 1);
            longest = std::max(longest, length);
        }
    }
    
    return longest;
}

void updateLongestRoad(Game& game) {
    int newLongestLength = game.longestRoadLength;
    int newLongestPlayer = game.longestRoadPlayerId;
    
    for (const auto& player : game.players) {
        int roadLength = calculateLongestRoad(game, player.id);
        
        if (roadLength >= 5) {  // Minimum 5 to claim longest road
            if (roadLength > newLongestLength) {
                newLongestLength = roadLength;
                newLongestPlayer = player.id;
            }
        }
    }
    
    // Update flags
    if (newLongestPlayer != game.longestRoadPlayerId) {
        // Remove old holder's flag
        if (game.longestRoadPlayerId >= 0) {
            Player* oldHolder = game.getPlayerById(game.longestRoadPlayerId);
            if (oldHolder) oldHolder->hasLongestRoad = false;
        }
        
        // Set new holder's flag
        if (newLongestPlayer >= 0) {
            Player* newHolder = game.getPlayerById(newLongestPlayer);
            if (newHolder) newHolder->hasLongestRoad = true;
        }
        
        game.longestRoadPlayerId = newLongestPlayer;
        game.longestRoadLength = newLongestLength;
    }
}

// ============================================================================
// LARGEST ARMY TRACKING
// ============================================================================

void updateLargestArmy(Game& game) {
    int newLargestSize = game.largestArmySize;
    int newLargestPlayer = game.largestArmyPlayerId;
    
    for (const auto& player : game.players) {
        if (player.knightsPlayed >= 3) {  // Minimum 3 to claim largest army
            if (player.knightsPlayed > newLargestSize) {
                newLargestSize = player.knightsPlayed;
                newLargestPlayer = player.id;
            }
        }
    }
    
    // Update flags
    if (newLargestPlayer != game.largestArmyPlayerId) {
        // Remove old holder's flag
        if (game.largestArmyPlayerId >= 0) {
            Player* oldHolder = game.getPlayerById(game.largestArmyPlayerId);
            if (oldHolder) oldHolder->hasLargestArmy = false;
        }
        
        // Set new holder's flag
        if (newLargestPlayer >= 0) {
            Player* newHolder = game.getPlayerById(newLargestPlayer);
            if (newHolder) newHolder->hasLargestArmy = true;
        }
        
        game.largestArmyPlayerId = newLargestPlayer;
        game.largestArmySize = newLargestSize;
    }
}

// ============================================================================
// VICTORY POINT CALCULATION
// ============================================================================

int calculateVictoryPoints(const Game& game, int playerId, bool includeHidden) {
    int vp = 0;
    
    // Count settlements and cities on the board
    for (const auto& [coord, vertex] : game.board.vertices) {
        if (vertex.ownerPlayerId == playerId) {
            if (vertex.building == Building::Settlement) vp += 1;
            else if (vertex.building == Building::City) vp += 2;
        }
    }
    
    const Player* player = nullptr;
    for (const auto& p : game.players) {
        if (p.id == playerId) {
            player = &p;
            break;
        }
    }
    
    if (player) {
        // Longest road bonus
        if (player->hasLongestRoad) vp += 2;
        
        // Largest army bonus
        if (player->hasLargestArmy) vp += 2;
        
        // Victory point dev cards (hidden until game end or winning)
        if (includeHidden) {
            for (auto card : player->devCards) {
                if (card == DevCardType::VictoryPoint) vp++;
            }
        }
    }
    
    return vp;
}

int calculateVisibleVictoryPoints(const Game& game, int playerId) {
    // Don't include hidden VP cards
    return calculateVictoryPoints(game, playerId, false);
}

int checkForWinner(const Game& game) {
    for (const auto& player : game.players) {
        int vp = calculateVictoryPoints(game, player.id, true);
        if (vp >= 10) {
            return player.id;
        }
    }
    return -1;
}

// ============================================================================
// BUILDING VALIDATION
// ============================================================================

bool isVertexDistanceValid(const Game& game, const VertexCoord& vertex) {
    // Check that no settlement/city is within 1 edge of this vertex
    auto adjacent = getAdjacentVertices(vertex);
    
    // Check the vertex itself
    auto it = game.board.vertices.find(vertex);
    if (it != game.board.vertices.end() && it->second.building != Building::None) {
        return false;
    }
    
    // Check adjacent vertices
    for (const auto& adj : adjacent) {
        auto adjIt = game.board.vertices.find(adj);
        if (adjIt != game.board.vertices.end() && adjIt->second.building != Building::None) {
            return false;
        }
    }
    
    return true;
}

bool isRoadConnectedToNetwork(const Game& game, int playerId, const EdgeCoord& edge) {
    auto [v1, v2] = getVerticesOfEdge(edge);
    
    // Check if either vertex has player's settlement/city
    for (const auto& vertex : {v1, v2}) {
        auto vIt = game.board.vertices.find(vertex);
        if (vIt != game.board.vertices.end() && 
            vIt->second.ownerPlayerId == playerId &&
            vIt->second.building != Building::None) {
            return true;
        }
        
        // Check if any adjacent edge has player's road
        auto edges = getEdgesAtVertex(vertex);
        for (const auto& adjEdge : edges) {
            auto eIt = game.board.edges.find(adjEdge);
            if (eIt != game.board.edges.end() && 
                eIt->second.hasRoad && 
                eIt->second.ownerPlayerId == playerId) {
                return true;
            }
        }
    }
    
    return false;
}

std::vector<VertexCoord> getValidSettlementLocations(const Game& game, int playerId) {
    std::vector<VertexCoord> valid;
    
    for (const auto& [coord, vertex] : game.board.vertices) {
        // Must be empty
        if (vertex.building != Building::None) continue;
        
        // Must satisfy distance rule
        if (!isVertexDistanceValid(game, coord)) continue;
        
        // Must be connected to player's road network
        auto edges = getEdgesAtVertex(coord);
        bool connected = false;
        for (const auto& edge : edges) {
            auto eIt = game.board.edges.find(edge);
            if (eIt != game.board.edges.end() && 
                eIt->second.hasRoad && 
                eIt->second.ownerPlayerId == playerId) {
                connected = true;
                break;
            }
        }
        
        if (connected) {
            valid.push_back(coord);
        }
    }
    
    return valid;
}

std::vector<EdgeCoord> getValidRoadLocations(const Game& game, int playerId) {
    std::vector<EdgeCoord> valid;
    
    for (const auto& [coord, edge] : game.board.edges) {
        // Must be empty
        if (edge.hasRoad) continue;
        
        // Must be connected to player's network
        if (isRoadConnectedToNetwork(game, playerId, coord)) {
            valid.push_back(coord);
        }
    }
    
    return valid;
}

std::vector<VertexCoord> getValidCityLocations(const Game& game, int playerId) {
    std::vector<VertexCoord> valid;
    
    for (const auto& [coord, vertex] : game.board.vertices) {
        // Must be player's settlement
        if (vertex.ownerPlayerId == playerId && vertex.building == Building::Settlement) {
            valid.push_back(coord);
        }
    }
    
    return valid;
}

// ============================================================================
// SETUP PHASE LOGIC
// ============================================================================

std::vector<VertexCoord> getValidSetupSettlementLocations(const Game& game) {
    std::vector<VertexCoord> valid;
    
    for (const auto& [coord, vertex] : game.board.vertices) {
        // Must be empty and satisfy distance rule
        if (vertex.building == Building::None && isVertexDistanceValid(game, coord)) {
            // In setup phase, no road connection required
            // Also check that vertex is adjacent to at least one land hex
            bool adjacentToLand = false;
            // The vertex is on this hex
            auto hexIt = game.board.hexes.find(coord.hex);
            if (hexIt != game.board.hexes.end() && hexIt->second.type != HexType::Ocean) {
                adjacentToLand = true;
            }
            
            if (adjacentToLand) {
                valid.push_back(coord);
            }
        }
    }
    
    return valid;
}

std::vector<EdgeCoord> getValidSetupRoadLocations(const Game& game, const VertexCoord& settlement) {
    std::vector<EdgeCoord> valid;
    
    // Get edges adjacent to the settlement
    auto edges = getEdgesAtVertex(settlement);
    
    for (const auto& edge : edges) {
        auto eIt = game.board.edges.find(edge);
        if (eIt != game.board.edges.end() && !eIt->second.hasRoad) {
            valid.push_back(edge);
        }
    }
    
    return valid;
}

bool placeSetupSettlement(Game& game, int playerId, const VertexCoord& location) {
    Player* player = game.getPlayerById(playerId);
    if (!player) return false;
    
    // Verify location is valid
    auto validLocations = getValidSetupSettlementLocations(game);
    bool isValid = false;
    for (const auto& v : validLocations) {
        if (v.hex == location.hex && v.direction == location.direction) {
            isValid = true;
            break;
        }
    }
    
    if (!isValid) return false;
    
    // Place settlement
    auto it = game.board.vertices.find(location);
    if (it != game.board.vertices.end()) {
        it->second.building = Building::Settlement;
        it->second.ownerPlayerId = playerId;
        player->settlementsRemaining--;
        return true;
    }
    
    return false;
}

bool placeSetupRoad(Game& game, int playerId, const EdgeCoord& location) {
    Player* player = game.getPlayerById(playerId);
    if (!player) return false;
    
    auto it = game.board.edges.find(location);
    if (it != game.board.edges.end() && !it->second.hasRoad) {
        it->second.hasRoad = true;
        it->second.ownerPlayerId = playerId;
        player->roadsRemaining--;
        return true;
    }
    
    return false;
}

void giveInitialResources(Game& game, int playerId, const VertexCoord& settlementLocation) {
    Player* player = game.getPlayerById(playerId);
    if (!player) return;
    
    // Get all hexes adjacent to this vertex
    std::vector<HexCoord> adjacentHexes;
    adjacentHexes.push_back(settlementLocation.hex);
    
    int d = settlementLocation.direction;
    HexCoord n1 = {settlementLocation.hex.q + HEX_DIRS[d][0], settlementLocation.hex.r + HEX_DIRS[d][1]};
    HexCoord n2 = {settlementLocation.hex.q + HEX_DIRS[(d + 5) % 6][0], settlementLocation.hex.r + HEX_DIRS[(d + 5) % 6][1]};
    adjacentHexes.push_back(n1);
    adjacentHexes.push_back(n2);
    
    // Give one resource from each adjacent hex
    for (const auto& hexCoord : adjacentHexes) {
        auto hexIt = game.board.hexes.find(hexCoord);
        if (hexIt != game.board.hexes.end()) {
            Resource resource = hexTypeToResource(hexIt->second.type);
            if (resource != Resource::None) {
                player->resources[resource]++;
            }
        }
    }
}

void advanceSetupPhase(Game& game) {
    int numPlayers = game.players.size();
    
    if (game.phase == GamePhase::Setup) {
        // First round: go forward 0 -> 1 -> 2 -> 3
        if (game.currentPlayerIndex < numPlayers - 1) {
            game.currentPlayerIndex++;
        } else {
            // Last player in first round, switch to reverse
            game.phase = GamePhase::SetupReverse;
            // Same player goes again (last player places twice in a row)
        }
    } else if (game.phase == GamePhase::SetupReverse) {
        // Second round: go backward 3 -> 2 -> 1 -> 0
        if (game.currentPlayerIndex > 0) {
            game.currentPlayerIndex--;
        } else {
            // Setup complete! Start the game
            game.phase = GamePhase::Rolling;
            game.currentPlayerIndex = 0;  // First player starts
        }
    }
}

}  // namespace catan
