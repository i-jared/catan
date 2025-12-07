#include "catan_types.h"
#include <random>
#include <algorithm>
#include <sstream>
#include <iomanip>

namespace catan {

// ============================================================================
// GAME MANAGER IMPLEMENTATION
// ============================================================================

static std::string generateGameId() {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<> dis(0, 15);
    
    std::stringstream ss;
    for (int i = 0; i < 8; i++) {
        ss << std::hex << dis(gen);
    }
    return ss.str();
}

std::string GameManager::createGame(const std::string& name, int maxPlayers) {
    std::lock_guard<std::mutex> lock(mutex);
    
    std::string gameId = generateGameId();
    
    auto game = std::make_unique<Game>();
    game->gameId = gameId;
    game->name = name;
    game->maxPlayers = maxPlayers;
    game->phase = GamePhase::WaitingForPlayers;
    game->board = generateRandomBoard();
    game->createdAt = std::chrono::steady_clock::now();
    game->lastActivity = game->createdAt;
    
    // Initialize dev card deck (25 cards total in base game)
    game->devCardDeck = {
        // 14 Knights
        DevCardType::Knight, DevCardType::Knight, DevCardType::Knight,
        DevCardType::Knight, DevCardType::Knight, DevCardType::Knight,
        DevCardType::Knight, DevCardType::Knight, DevCardType::Knight,
        DevCardType::Knight, DevCardType::Knight, DevCardType::Knight,
        DevCardType::Knight, DevCardType::Knight,
        // 5 Victory Points
        DevCardType::VictoryPoint, DevCardType::VictoryPoint,
        DevCardType::VictoryPoint, DevCardType::VictoryPoint,
        DevCardType::VictoryPoint,
        // 2 Road Building
        DevCardType::RoadBuilding, DevCardType::RoadBuilding,
        // 2 Year of Plenty
        DevCardType::YearOfPlenty, DevCardType::YearOfPlenty,
        // 2 Monopoly
        DevCardType::Monopoly, DevCardType::Monopoly
    };
    
    // Shuffle the deck
    std::random_device rd;
    std::mt19937 g(rd());
    std::shuffle(game->devCardDeck.begin(), game->devCardDeck.end(), g);
    
    games[gameId] = std::move(game);
    return gameId;
}

Game* GameManager::getGame(const std::string& gameId) {
    std::lock_guard<std::mutex> lock(mutex);
    auto it = games.find(gameId);
    if (it != games.end()) {
        return it->second.get();
    }
    return nullptr;
}

std::vector<std::string> GameManager::listGames() {
    std::lock_guard<std::mutex> lock(mutex);
    std::vector<std::string> result;
    for (const auto& pair : games) {
        if (!pair.second->isPrivate) {
            result.push_back(pair.first);
        }
    }
    return result;
}

bool GameManager::removeGame(const std::string& gameId) {
    std::lock_guard<std::mutex> lock(mutex);
    return games.erase(gameId) > 0;
}

size_t GameManager::gameCount() const {
    std::lock_guard<std::mutex> lock(mutex);
    return games.size();
}

// ============================================================================
// BOARD GENERATION
// ============================================================================

// Standard Catan board hex positions using axial coordinates
// The board is a hexagon of radius 2 (19 land hexes)
static const std::vector<HexCoord> LAND_HEX_COORDS = {
    // Center
    {0, 0},
    // Ring 1 (6 hexes)
    {1, -1}, {1, 0}, {0, 1}, {-1, 1}, {-1, 0}, {0, -1},
    // Ring 2 (12 hexes)
    {2, -2}, {2, -1}, {2, 0}, {1, 1}, {0, 2}, {-1, 2},
    {-2, 2}, {-2, 1}, {-2, 0}, {-1, -1}, {0, -2}, {1, -2}
};

// Standard resource distribution for base Catan
static const std::vector<HexType> STANDARD_RESOURCES = {
    HexType::Desert,    // 1
    HexType::Forest, HexType::Forest, HexType::Forest, HexType::Forest,     // 4 wood
    HexType::Hills, HexType::Hills, HexType::Hills,                          // 3 brick
    HexType::Fields, HexType::Fields, HexType::Fields, HexType::Fields,     // 4 wheat
    HexType::Pasture, HexType::Pasture, HexType::Pasture, HexType::Pasture, // 4 sheep
    HexType::Mountains, HexType::Mountains, HexType::Mountains              // 3 ore
};

// Number tokens (desert gets 0)
static const std::vector<int> STANDARD_NUMBERS = {
    2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
};

GameBoard generateRandomBoard() {
    GameBoard board;
    
    std::random_device rd;
    std::mt19937 gen(rd());
    
    // Shuffle resources
    std::vector<HexType> resources = STANDARD_RESOURCES;
    std::shuffle(resources.begin(), resources.end(), gen);
    
    // Shuffle numbers
    std::vector<int> numbers = STANDARD_NUMBERS;
    std::shuffle(numbers.begin(), numbers.end(), gen);
    
    // Place hexes
    int numberIndex = 0;
    for (size_t i = 0; i < LAND_HEX_COORDS.size(); i++) {
        Hex hex;
        hex.coord = LAND_HEX_COORDS[i];
        hex.type = resources[i];
        hex.hasRobber = (hex.type == HexType::Desert);
        
        if (hex.type == HexType::Desert) {
            hex.numberToken = 0;
            board.robberLocation = hex.coord;
        } else {
            hex.numberToken = numbers[numberIndex++];
        }
        
        board.hexes[hex.coord] = hex;
    }
    
    // Initialize vertices (each hex has 6 corners)
    for (const auto& hexCoord : LAND_HEX_COORDS) {
        for (int dir = 0; dir < 6; dir++) {
            VertexCoord vc{hexCoord, dir};
            if (board.vertices.find(vc) == board.vertices.end()) {
                Vertex v;
                v.coord = vc;
                v.building = Building::None;
                v.ownerPlayerId = -1;
                board.vertices[vc] = v;
            }
        }
    }
    
    // Initialize edges (each hex has 6 edges)
    for (const auto& hexCoord : LAND_HEX_COORDS) {
        for (int dir = 0; dir < 6; dir++) {
            EdgeCoord ec{hexCoord, dir};
            if (board.edges.find(ec) == board.edges.end()) {
                Edge e;
                e.coord = ec;
                e.hasRoad = false;
                e.ownerPlayerId = -1;
                board.edges[ec] = e;
            }
        }
    }
    
    // Setup ports (9 ports in standard game)
    // Port positions are on the outer edge - simplified version
    std::vector<PortType> portTypes = {
        PortType::Generic, PortType::Generic, PortType::Generic, PortType::Generic,
        PortType::Wood, PortType::Brick, PortType::Wheat, PortType::Sheep, PortType::Ore
    };
    std::shuffle(portTypes.begin(), portTypes.end(), gen);
    
    // Port positions (simplified - would need proper edge vertices in full impl)
    // For now we just store the port types; proper placement needs more geometry
    
    return board;
}

// ============================================================================
// COORDINATE HELPERS
// ============================================================================

// Direction offsets for axial hex coordinates
static const int HEX_DIRECTIONS[6][2] = {
    {0, -1},  // N
    {1, -1},  // NE
    {1, 0},   // SE
    {0, 1},   // S
    {-1, 1},  // SW
    {-1, 0}   // NW
};

std::vector<VertexCoord> getAdjacentVertices(const HexCoord& hex) {
    std::vector<VertexCoord> result;
    for (int dir = 0; dir < 6; dir++) {
        result.push_back({hex, dir});
    }
    return result;
}

std::vector<EdgeCoord> getAdjacentEdges(const HexCoord& hex) {
    std::vector<EdgeCoord> result;
    for (int dir = 0; dir < 6; dir++) {
        result.push_back({hex, dir});
    }
    return result;
}

std::vector<HexCoord> getHexesAdjacentToVertex(const VertexCoord& vertex) {
    // A vertex touches up to 3 hexes
    std::vector<HexCoord> result;
    result.push_back(vertex.hex);
    
    // The two neighboring hexes depend on the vertex direction
    int d1 = vertex.direction;
    int d2 = (vertex.direction + 5) % 6;  // previous direction
    
    HexCoord neighbor1{
        vertex.hex.q + HEX_DIRECTIONS[d1][0],
        vertex.hex.r + HEX_DIRECTIONS[d1][1]
    };
    HexCoord neighbor2{
        vertex.hex.q + HEX_DIRECTIONS[d2][0],
        vertex.hex.r + HEX_DIRECTIONS[d2][1]
    };
    
    result.push_back(neighbor1);
    result.push_back(neighbor2);
    
    return result;
}

Resource hexTypeToResource(HexType type) {
    switch (type) {
        case HexType::Forest:    return Resource::Wood;
        case HexType::Hills:     return Resource::Brick;
        case HexType::Fields:    return Resource::Wheat;
        case HexType::Pasture:   return Resource::Sheep;
        case HexType::Mountains: return Resource::Ore;
        default:                 return Resource::None;
    }
}

}  // namespace catan

