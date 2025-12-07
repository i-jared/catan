#pragma once

#include <string>
#include <vector>
#include <array>
#include <unordered_map>
#include <optional>
#include <mutex>
#include <chrono>

namespace catan {

// ============================================================================
// RESOURCE & BUILDING TYPES
// ============================================================================

enum class Resource {
    None,
    Wood,
    Brick,
    Wheat,
    Sheep,
    Ore
};

enum class HexType {
    Desert,
    Forest,     // produces Wood
    Hills,      // produces Brick
    Fields,     // produces Wheat
    Pasture,    // produces Sheep
    Mountains,  // produces Ore
    Ocean       // water tiles around the edge
};

enum class Building {
    None,
    Settlement,
    City
};

enum class DevCardType {
    Knight,
    VictoryPoint,
    RoadBuilding,
    YearOfPlenty,
    Monopoly
};

enum class PortType {
    Generic,    // 3:1 any resource
    Wood,       // 2:1 wood
    Brick,      // 2:1 brick
    Wheat,      // 2:1 wheat
    Sheep,      // 2:1 sheep
    Ore         // 2:1 ore
};

// ============================================================================
// BOARD COORDINATES
// Using axial coordinates (q, r) for hex grid - clean and efficient
// ============================================================================

struct HexCoord {
    int q;  // column
    int r;  // row
    
    bool operator==(const HexCoord& other) const {
        return q == other.q && r == other.r;
    }
};

// Vertex identified by adjacent hex + direction (0-5 for 6 corners)
struct VertexCoord {
    HexCoord hex;
    int direction;  // 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
    
    bool operator==(const VertexCoord& other) const {
        return hex == other.hex && direction == other.direction;
    }
};

// Edge identified by adjacent hex + direction (0-5 for 6 edges)
struct EdgeCoord {
    HexCoord hex;
    int direction;  // 0=N, 1=NE, 2=E, 3=S, 4=SW, 5=W
    
    bool operator==(const EdgeCoord& other) const {
        return hex == other.hex && direction == other.direction;
    }
};

}  // namespace catan

// Hash functions for coordinates (needed for unordered_map)
namespace std {
    template<> struct hash<catan::HexCoord> {
        size_t operator()(const catan::HexCoord& c) const {
            return hash<int>()(c.q) ^ (hash<int>()(c.r) << 16);
        }
    };
    
    template<> struct hash<catan::VertexCoord> {
        size_t operator()(const catan::VertexCoord& c) const {
            return hash<catan::HexCoord>()(c.hex) ^ (hash<int>()(c.direction) << 8);
        }
    };
    
    template<> struct hash<catan::EdgeCoord> {
        size_t operator()(const catan::EdgeCoord& c) const {
            return hash<catan::HexCoord>()(c.hex) ^ (hash<int>()(c.direction) << 8);
        }
    };
}

namespace catan {

// ============================================================================
// BOARD ELEMENTS
// ============================================================================

struct Hex {
    HexCoord coord;
    HexType type;
    int numberToken;    // 2-12, 0 for desert/ocean
    bool hasRobber;
};

struct Vertex {
    VertexCoord coord;
    Building building;
    int ownerPlayerId;  // -1 if unoccupied
};

struct Edge {
    EdgeCoord coord;
    bool hasRoad;
    int ownerPlayerId;  // -1 if no road
};

struct Port {
    VertexCoord vertex1;    // ports connect two adjacent vertices
    VertexCoord vertex2;
    PortType type;
};

// ============================================================================
// PLAYER STATE
// ============================================================================

struct ResourceHand {
    int wood = 0;
    int brick = 0;
    int wheat = 0;
    int sheep = 0;
    int ore = 0;
    
    int total() const { return wood + brick + wheat + sheep + ore; }
    
    int& operator[](Resource r) {
        switch(r) {
            case Resource::Wood:  return wood;
            case Resource::Brick: return brick;
            case Resource::Wheat: return wheat;
            case Resource::Sheep: return sheep;
            case Resource::Ore:   return ore;
            default: return wood; // shouldn't happen
        }
    }
    
    int operator[](Resource r) const {
        switch(r) {
            case Resource::Wood:  return wood;
            case Resource::Brick: return brick;
            case Resource::Wheat: return wheat;
            case Resource::Sheep: return sheep;
            case Resource::Ore:   return ore;
            default: return 0;
        }
    }
};

struct Player {
    int id;
    std::string name;
    std::string sessionToken;       // for reconnection
    
    ResourceHand resources;
    std::vector<DevCardType> devCards;
    std::vector<DevCardType> devCardsPlayedThisTurn;
    
    // Buildings remaining to place
    int settlementsRemaining = 5;
    int citiesRemaining = 4;
    int roadsRemaining = 15;
    
    // Achievements
    int knightsPlayed = 0;
    bool hasLongestRoad = false;
    bool hasLargestArmy = false;
    
    int victoryPoints() const {
        int vp = 0;
        // Settlements = 1 VP each, Cities = 2 VP each (counted from board)
        // This just counts bonus VPs
        if (hasLongestRoad) vp += 2;
        if (hasLargestArmy) vp += 2;
        // VP dev cards
        for (auto card : devCards) {
            if (card == DevCardType::VictoryPoint) vp++;
        }
        return vp;
    }
    
    bool isConnected = false;
    std::chrono::steady_clock::time_point lastActivity;
};

// ============================================================================
// GAME PHASES & TURNS
// ============================================================================

enum class GamePhase {
    WaitingForPlayers,
    Setup,              // initial placement
    SetupReverse,       // second round of initial placement (reverse order)
    Rolling,            // waiting for dice roll
    Robber,             // must move robber (rolled 7 or knight)
    Stealing,           // must choose player to steal from
    MainTurn,           // can build, trade, play dev cards
    Trading,            // active trade offer
    Finished
};

struct DiceRoll {
    int die1;
    int die2;
    int total() const { return die1 + die2; }
};

struct TradeOffer {
    int fromPlayerId;
    ResourceHand offering;
    ResourceHand requesting;
    std::vector<int> acceptedByPlayerIds;
};

// ============================================================================
// FULL GAME STATE
// ============================================================================

struct GameBoard {
    std::unordered_map<HexCoord, Hex> hexes;
    std::unordered_map<VertexCoord, Vertex> vertices;
    std::unordered_map<EdgeCoord, Edge> edges;
    std::vector<Port> ports;
    HexCoord robberLocation;
};

struct Game {
    std::string gameId;
    std::string name;
    
    GameBoard board;
    std::vector<Player> players;
    
    // Dev card deck
    std::vector<DevCardType> devCardDeck;
    
    // Turn state
    GamePhase phase = GamePhase::WaitingForPlayers;
    int currentPlayerIndex = 0;
    int setupRound = 0;             // 0 or 1 for setup phases
    std::optional<DiceRoll> lastRoll;
    std::optional<TradeOffer> activeTradeOffer;
    bool devCardPlayedThisTurn = false;
    
    // Achievements tracking
    int longestRoadLength = 4;      // minimum to claim
    int longestRoadPlayerId = -1;
    int largestArmySize = 2;        // minimum to claim
    int largestArmyPlayerId = -1;
    
    // Timestamps
    std::chrono::steady_clock::time_point createdAt;
    std::chrono::steady_clock::time_point lastActivity;
    
    // Settings
    int maxPlayers = 4;
    bool isPrivate = false;
    
    // Mutex for thread-safe access
    mutable std::mutex mutex;
    
    Player* getCurrentPlayer() {
        if (currentPlayerIndex >= 0 && currentPlayerIndex < (int)players.size()) {
            return &players[currentPlayerIndex];
        }
        return nullptr;
    }
    
    Player* getPlayerById(int id) {
        for (auto& p : players) {
            if (p.id == id) return &p;
        }
        return nullptr;
    }
};

// ============================================================================
// GAME MANAGER - Stores all active games
// ============================================================================

class GameManager {
private:
    std::unordered_map<std::string, Game> games;
    mutable std::mutex mutex;
    
public:
    // Create a new game, returns game ID
    std::string createGame(const std::string& name, int maxPlayers = 4);
    
    // Get a game by ID (returns nullptr if not found)
    Game* getGame(const std::string& gameId);
    
    // List all public games
    std::vector<std::string> listGames();
    
    // Remove a finished/abandoned game
    bool removeGame(const std::string& gameId);
    
    // Get count of active games
    size_t gameCount() const;
};

// ============================================================================
// UTILITY FUNCTIONS (to be implemented)
// ============================================================================

// Board generation
GameBoard generateRandomBoard();

// Coordinate helpers
std::vector<VertexCoord> getAdjacentVertices(const HexCoord& hex);
std::vector<EdgeCoord> getAdjacentEdges(const HexCoord& hex);
std::vector<HexCoord> getHexesAdjacentToVertex(const VertexCoord& vertex);
std::vector<VertexCoord> getVerticesAdjacentToVertex(const VertexCoord& vertex);
std::vector<EdgeCoord> getEdgesAdjacentToVertex(const VertexCoord& vertex);

// Resource production
Resource hexTypeToResource(HexType type);

}  // namespace catan

