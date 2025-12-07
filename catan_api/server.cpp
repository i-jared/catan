#include <iostream>
#include <string>
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <thread>
#include <vector>
#include <sstream>
#include <algorithm>
#include <random>

#include "catan_types.h"
#include "session.h"

// Global managers (in production, wrap these properly)
catan::GameManager gameManager;
catan::SessionManager sessionManager;

// ============================================================================
// BUILDING COSTS
// ============================================================================

const catan::ResourceHand ROAD_COST = {1, 1, 0, 0, 0};       // wood, brick
const catan::ResourceHand SETTLEMENT_COST = {1, 1, 1, 1, 0}; // wood, brick, wheat, sheep
const catan::ResourceHand CITY_COST = {0, 0, 2, 0, 3};       // 2 wheat, 3 ore
const catan::ResourceHand DEV_CARD_COST = {0, 0, 1, 1, 1};   // wheat, sheep, ore

bool canAfford(const catan::ResourceHand& have, const catan::ResourceHand& cost) {
    return have.wood >= cost.wood &&
           have.brick >= cost.brick &&
           have.wheat >= cost.wheat &&
           have.sheep >= cost.sheep &&
           have.ore >= cost.ore;
}

void subtractResources(catan::ResourceHand& from, const catan::ResourceHand& cost) {
    from.wood -= cost.wood;
    from.brick -= cost.brick;
    from.wheat -= cost.wheat;
    from.sheep -= cost.sheep;
    from.ore -= cost.ore;
}

// Simple JSON value parser (for {"give":"wood","receive":"ore"} style)
std::string parseJsonString(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\":\"";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) return "";
    pos += searchKey.length();
    size_t endPos = json.find("\"", pos);
    if (endPos == std::string::npos) return "";
    return json.substr(pos, endPos - pos);
}

catan::Resource stringToResource(const std::string& name) {
    if (name == "wood") return catan::Resource::Wood;
    if (name == "brick") return catan::Resource::Brick;
    if (name == "wheat") return catan::Resource::Wheat;
    if (name == "sheep") return catan::Resource::Sheep;
    if (name == "ore") return catan::Resource::Ore;
    return catan::Resource::None;
}

std::string resourceToString(catan::Resource r) {
    switch (r) {
        case catan::Resource::Wood: return "wood";
        case catan::Resource::Brick: return "brick";
        case catan::Resource::Wheat: return "wheat";
        case catan::Resource::Sheep: return "sheep";
        case catan::Resource::Ore: return "ore";
        default: return "none";
    }
}

// ============================================================================
// HTTP PARSING HELPERS
// ============================================================================

struct HTTPRequest {
    std::string method;
    std::string path;
    std::unordered_map<std::string, std::string> headers;
    std::string body;
    
    // Parsed from Authorization header
    std::string authToken;
};

HTTPRequest parseRequest(const std::string& raw) {
    HTTPRequest req;
    std::istringstream stream(raw);
    std::string line;
    
    // Parse request line: GET /path HTTP/1.1
    if (std::getline(stream, line)) {
        std::istringstream requestLine(line);
        requestLine >> req.method >> req.path;
    }
    
    // Parse headers
    while (std::getline(stream, line) && line != "\r" && !line.empty()) {
        // Remove \r if present
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        
        size_t colonPos = line.find(':');
        if (colonPos != std::string::npos) {
            std::string key = line.substr(0, colonPos);
            std::string value = line.substr(colonPos + 1);
            // Trim leading space from value
            if (!value.empty() && value[0] == ' ') {
                value = value.substr(1);
            }
            // Convert header name to lowercase for easy lookup
            std::transform(key.begin(), key.end(), key.begin(), ::tolower);
            req.headers[key] = value;
        }
    }
    
    // Parse Authorization: Bearer <token>
    auto authIt = req.headers.find("authorization");
    if (authIt != req.headers.end()) {
        const std::string& auth = authIt->second;
        if (auth.substr(0, 7) == "Bearer ") {
            req.authToken = auth.substr(7);
        }
    }
    
    // Rest is body
    std::stringstream bodyStream;
    bodyStream << stream.rdbuf();
    req.body = bodyStream.str();
    
    return req;
}

std::string jsonResponse(int status, const std::string& json) {
    std::string statusText = (status == 200) ? "OK" : 
                             (status == 201) ? "Created" :
                             (status == 400) ? "Bad Request" :
                             (status == 401) ? "Unauthorized" :
                             (status == 404) ? "Not Found" : "Error";
    
    std::ostringstream response;
    response << "HTTP/1.1 " << status << " " << statusText << "\r\n"
             << "Content-Type: application/json\r\n"
             << "Content-Length: " << json.length() << "\r\n"
             << "Connection: close\r\n"
             << "\r\n"
             << json;
    return response.str();
}

// ============================================================================
// API HANDLERS
// ============================================================================

std::string handleCreateGame(const HTTPRequest& req) {
    // TODO: Parse name from JSON body
    std::string gameId = gameManager.createGame("New Game", 4);
    
    return jsonResponse(201, 
        "{\"gameId\":\"" + gameId + "\",\"message\":\"Game created\"}");
}

std::string handleJoinGame(const HTTPRequest& req, const std::string& gameId) {
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    std::lock_guard<std::mutex> lock(game->mutex);
    
    if (game->phase != catan::GamePhase::WaitingForPlayers) {
        return jsonResponse(400, "{\"error\":\"Game already started\"}");
    }
    
    if (game->players.size() >= (size_t)game->maxPlayers) {
        return jsonResponse(400, "{\"error\":\"Game is full\"}");
    }
    
    // Create the player
    // TODO: Parse playerName from JSON body
    int playerId = game->players.size();
    catan::Player player;
    player.id = playerId;
    player.name = "Player " + std::to_string(playerId + 1);
    player.isConnected = true;
    player.lastActivity = std::chrono::steady_clock::now();
    game->players.push_back(player);
    
    // Create session token
    std::string token = sessionManager.createSession(gameId, playerId, player.name);
    
    return jsonResponse(200, 
        "{\"token\":\"" + token + "\","
        "\"playerId\":" + std::to_string(playerId) + ","
        "\"playerName\":\"" + player.name + "\"}");
}

std::string handleGetGameState(const HTTPRequest& req, const std::string& gameId) {
    // Validate session
    catan::Session* session = sessionManager.getSession(req.authToken);
    if (!session || session->gameId != gameId) {
        return jsonResponse(401, "{\"error\":\"Unauthorized\"}");
    }
    
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    std::lock_guard<std::mutex> lock(game->mutex);
    
    // Build game state JSON (simplified - would use a JSON library in production)
    std::ostringstream json;
    json << "{"
         << "\"gameId\":\"" << game->gameId << "\","
         << "\"phase\":" << static_cast<int>(game->phase) << ","
         << "\"currentPlayer\":" << game->currentPlayerIndex << ","
         << "\"playerCount\":" << game->players.size() << ","
         << "\"yourPlayerId\":" << session->playerId;
    
    // Include this player's resources
    if (session->playerId < (int)game->players.size()) {
        auto& player = game->players[session->playerId];
        json << ",\"resources\":{"
             << "\"wood\":" << player.resources.wood << ","
             << "\"brick\":" << player.resources.brick << ","
             << "\"wheat\":" << player.resources.wheat << ","
             << "\"sheep\":" << player.resources.sheep << ","
             << "\"ore\":" << player.resources.ore
             << "}";
    }
    
    json << "}";
    
    return jsonResponse(200, json.str());
}

std::string handleListGames(const HTTPRequest& req) {
    auto games = gameManager.listGames();
    
    std::ostringstream json;
    json << "{\"games\":[";
    for (size_t i = 0; i < games.size(); i++) {
        if (i > 0) json << ",";
        json << "\"" << games[i] << "\"";
    }
    json << "]}";
    
    return jsonResponse(200, json.str());
}

// ============================================================================
// GAME ACTION HELPERS
// ============================================================================

// Validates session and returns game/player, or error response
struct GameContext {
    catan::Game* game = nullptr;
    catan::Player* player = nullptr;
    catan::Session* session = nullptr;
    std::string error;
    int errorCode = 0;
};

GameContext getGameContext(const HTTPRequest& req, const std::string& gameId, bool requireCurrentTurn = true) {
    GameContext ctx;
    
    ctx.session = sessionManager.getSession(req.authToken);
    if (!ctx.session || ctx.session->gameId != gameId) {
        ctx.error = "{\"error\":\"Unauthorized\"}";
        ctx.errorCode = 401;
        return ctx;
    }
    
    ctx.game = gameManager.getGame(gameId);
    if (!ctx.game) {
        ctx.error = "{\"error\":\"Game not found\"}";
        ctx.errorCode = 404;
        return ctx;
    }
    
    ctx.player = ctx.game->getPlayerById(ctx.session->playerId);
    if (!ctx.player) {
        ctx.error = "{\"error\":\"Player not found\"}";
        ctx.errorCode = 404;
        return ctx;
    }
    
    if (requireCurrentTurn && ctx.game->currentPlayerIndex != ctx.session->playerId) {
        ctx.error = "{\"error\":\"Not your turn\"}";
        ctx.errorCode = 400;
        return ctx;
    }
    
    return ctx;
}

// ============================================================================
// GAME ACTIONS
// ============================================================================

std::string handleRollDice(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::Rolling) {
        return jsonResponse(400, "{\"error\":\"Cannot roll now, phase is not Rolling\"}");
    }
    
    // Roll two dice
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<> die(1, 6);
    
    catan::DiceRoll roll;
    roll.die1 = die(gen);
    roll.die2 = die(gen);
    ctx.game->lastRoll = roll;
    
    int total = roll.total();
    
    // Handle roll of 7 (robber)
    if (total == 7) {
        // Players with > 7 cards must discard half (TODO: implement discard phase)
        ctx.game->phase = catan::GamePhase::Robber;
        return jsonResponse(200, 
            "{\"die1\":" + std::to_string(roll.die1) + 
            ",\"die2\":" + std::to_string(roll.die2) + 
            ",\"total\":7,\"robber\":true}");
    }
    
    // Distribute resources based on roll
    std::ostringstream production;
    production << ",\"production\":{";
    bool first = true;
    
    for (const auto& [coord, hex] : ctx.game->board.hexes) {
        if (hex.numberToken == total && !hex.hasRobber) {
            catan::Resource resource = catan::hexTypeToResource(hex.type);
            if (resource == catan::Resource::None) continue;
            
            // Find all settlements/cities on this hex's vertices
            for (int dir = 0; dir < 6; dir++) {
                catan::VertexCoord vc{coord, dir};
                auto it = ctx.game->board.vertices.find(vc);
                if (it != ctx.game->board.vertices.end() && it->second.ownerPlayerId >= 0) {
                    catan::Player* owner = ctx.game->getPlayerById(it->second.ownerPlayerId);
                    if (owner) {
                        int amount = (it->second.building == catan::Building::City) ? 2 : 1;
                        owner->resources[resource] += amount;
                        
                        if (!first) production << ",";
                        first = false;
                        production << "\"" << owner->name << "_" << resourceToString(resource) << "\":" << amount;
                    }
                }
            }
        }
    }
    production << "}";
    
    ctx.game->phase = catan::GamePhase::MainTurn;
    
    return jsonResponse(200, 
        "{\"die1\":" + std::to_string(roll.die1) + 
        ",\"die2\":" + std::to_string(roll.die2) + 
        ",\"total\":" + std::to_string(total) +
        production.str() + "}");
}

std::string handleBuyRoad(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
    }
    
    if (!canAfford(ctx.player->resources, ROAD_COST)) {
        return jsonResponse(400, "{\"error\":\"Not enough resources. Road costs 1 wood + 1 brick\"}");
    }
    
    if (ctx.player->roadsRemaining <= 0) {
        return jsonResponse(400, "{\"error\":\"No roads remaining\"}");
    }
    
    // TODO: Parse edge location from request body and validate placement
    // For now, just deduct resources
    subtractResources(ctx.player->resources, ROAD_COST);
    ctx.player->roadsRemaining--;
    
    return jsonResponse(200, 
        "{\"success\":true,\"message\":\"Road purchased\","
        "\"roadsRemaining\":" + std::to_string(ctx.player->roadsRemaining) + "}");
}

std::string handleBuySettlement(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
    }
    
    if (!canAfford(ctx.player->resources, SETTLEMENT_COST)) {
        return jsonResponse(400, "{\"error\":\"Not enough resources. Settlement costs 1 wood + 1 brick + 1 wheat + 1 sheep\"}");
    }
    
    if (ctx.player->settlementsRemaining <= 0) {
        return jsonResponse(400, "{\"error\":\"No settlements remaining\"}");
    }
    
    // TODO: Parse vertex location from request body and validate placement
    // For now, just deduct resources
    subtractResources(ctx.player->resources, SETTLEMENT_COST);
    ctx.player->settlementsRemaining--;
    
    return jsonResponse(200, 
        "{\"success\":true,\"message\":\"Settlement purchased\","
        "\"settlementsRemaining\":" + std::to_string(ctx.player->settlementsRemaining) + "}");
}

std::string handleBuyCity(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
    }
    
    if (!canAfford(ctx.player->resources, CITY_COST)) {
        return jsonResponse(400, "{\"error\":\"Not enough resources. City costs 2 wheat + 3 ore\"}");
    }
    
    if (ctx.player->citiesRemaining <= 0) {
        return jsonResponse(400, "{\"error\":\"No cities remaining\"}");
    }
    
    // Must upgrade an existing settlement (returns settlement to pool)
    // TODO: Parse vertex location and verify there's a settlement there
    
    subtractResources(ctx.player->resources, CITY_COST);
    ctx.player->citiesRemaining--;
    ctx.player->settlementsRemaining++; // Get settlement back
    
    return jsonResponse(200, 
        "{\"success\":true,\"message\":\"City purchased\","
        "\"citiesRemaining\":" + std::to_string(ctx.player->citiesRemaining) + "}");
}

std::string handleBuyDevCard(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot buy during this phase\"}");
    }
    
    if (!canAfford(ctx.player->resources, DEV_CARD_COST)) {
        return jsonResponse(400, "{\"error\":\"Not enough resources. Dev card costs 1 wheat + 1 sheep + 1 ore\"}");
    }
    
    if (ctx.game->devCardDeck.empty()) {
        return jsonResponse(400, "{\"error\":\"No development cards remaining\"}");
    }
    
    subtractResources(ctx.player->resources, DEV_CARD_COST);
    
    // Draw from deck
    catan::DevCardType card = ctx.game->devCardDeck.back();
    ctx.game->devCardDeck.pop_back();
    ctx.player->devCards.push_back(card);
    
    // Card type names for response
    std::string cardName;
    switch (card) {
        case catan::DevCardType::Knight: cardName = "knight"; break;
        case catan::DevCardType::VictoryPoint: cardName = "victory_point"; break;
        case catan::DevCardType::RoadBuilding: cardName = "road_building"; break;
        case catan::DevCardType::YearOfPlenty: cardName = "year_of_plenty"; break;
        case catan::DevCardType::Monopoly: cardName = "monopoly"; break;
    }
    
    return jsonResponse(200, 
        "{\"success\":true,\"card\":\"" + cardName + "\","
        "\"cardsInDeck\":" + std::to_string(ctx.game->devCardDeck.size()) + "}");
}

std::string handleBankTrade(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot trade during this phase\"}");
    }
    
    // Parse trade request: {"give":"wood","receive":"ore"}
    std::string giveStr = parseJsonString(req.body, "give");
    std::string receiveStr = parseJsonString(req.body, "receive");
    
    catan::Resource give = stringToResource(giveStr);
    catan::Resource receive = stringToResource(receiveStr);
    
    if (give == catan::Resource::None || receive == catan::Resource::None) {
        return jsonResponse(400, "{\"error\":\"Invalid resources. Use: wood, brick, wheat, sheep, ore\"}");
    }
    
    if (give == receive) {
        return jsonResponse(400, "{\"error\":\"Cannot trade same resource\"}");
    }
    
    // Determine trade ratio (4:1 default, could be 3:1 or 2:1 with ports)
    // TODO: Check if player has access to ports
    int ratio = 4;
    
    if (ctx.player->resources[give] < ratio) {
        return jsonResponse(400, 
            "{\"error\":\"Not enough " + giveStr + ". Need " + std::to_string(ratio) + " for bank trade\"}");
    }
    
    ctx.player->resources[give] -= ratio;
    ctx.player->resources[receive] += 1;
    
    return jsonResponse(200, 
        "{\"success\":true,"
        "\"traded\":{\"gave\":\"" + giveStr + "\",\"gaveAmount\":" + std::to_string(ratio) + 
        ",\"received\":\"" + receiveStr + "\",\"receivedAmount\":1}}");
}

std::string handleEndTurn(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::MainTurn) {
        return jsonResponse(400, "{\"error\":\"Cannot end turn during this phase\"}");
    }
    
    // Advance to next player
    ctx.game->currentPlayerIndex = (ctx.game->currentPlayerIndex + 1) % ctx.game->players.size();
    ctx.game->phase = catan::GamePhase::Rolling;
    ctx.game->devCardPlayedThisTurn = false;
    
    catan::Player* nextPlayer = ctx.game->getCurrentPlayer();
    
    return jsonResponse(200, 
        "{\"success\":true,"
        "\"nextPlayer\":" + std::to_string(ctx.game->currentPlayerIndex) + ","
        "\"nextPlayerName\":\"" + (nextPlayer ? nextPlayer->name : "unknown") + "\"}");
}

std::string handleStartGame(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId, false); // Don't require current turn
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    if (ctx.game->phase != catan::GamePhase::WaitingForPlayers) {
        return jsonResponse(400, "{\"error\":\"Game already started\"}");
    }
    
    if (ctx.game->players.size() < 2) {
        return jsonResponse(400, "{\"error\":\"Need at least 2 players to start\"}");
    }
    
    // Skip setup phase for now, go straight to rolling
    // TODO: Implement proper setup phase for initial placements
    ctx.game->phase = catan::GamePhase::Rolling;
    ctx.game->currentPlayerIndex = 0;
    
    // Give starting resources (shortcut - normally earned from 2nd settlement)
    for (auto& player : ctx.game->players) {
        player.resources = {2, 2, 2, 2, 2}; // 2 of each to start
    }
    
    return jsonResponse(200, 
        "{\"success\":true,\"message\":\"Game started\","
        "\"currentPlayer\":0,"
        "\"phase\":\"rolling\"}");
}

// ============================================================================
// REQUEST ROUTER
// ============================================================================

// Helper to extract gameId and action from path like /games/{id}/{action}
struct ParsedGamePath {
    std::string gameId;
    std::string action;
    bool valid = false;
};

ParsedGamePath parseGamePath(const std::string& path) {
    ParsedGamePath result;
    if (path.substr(0, 7) != "/games/") return result;
    
    std::string rest = path.substr(7);
    size_t slashPos = rest.find('/');
    
    if (slashPos == std::string::npos) {
        result.gameId = rest;
        result.action = "";
    } else {
        result.gameId = rest.substr(0, slashPos);
        result.action = rest.substr(slashPos + 1);
    }
    
    // Remove trailing slash from action
    if (!result.action.empty() && result.action.back() == '/') {
        result.action.pop_back();
    }
    
    result.valid = !result.gameId.empty();
    return result;
}

std::string routeRequest(const HTTPRequest& req) {
    // POST /games - Create a new game
    if (req.method == "POST" && req.path == "/games") {
        return handleCreateGame(req);
    }
    
    // GET /games - List all games
    if (req.method == "GET" && req.path == "/games") {
        return handleListGames(req);
    }
    
    // Parse game-specific routes
    ParsedGamePath gamePath = parseGamePath(req.path);
    
    if (gamePath.valid) {
        // POST /games/{id}/join - Join a game
        if (req.method == "POST" && gamePath.action == "join") {
            return handleJoinGame(req, gamePath.gameId);
        }
        
        // POST /games/{id}/start - Start the game
        if (req.method == "POST" && gamePath.action == "start") {
            return handleStartGame(req, gamePath.gameId);
        }
        
        // POST /games/{id}/roll - Roll dice
        if (req.method == "POST" && gamePath.action == "roll") {
            return handleRollDice(req, gamePath.gameId);
        }
        
        // POST /games/{id}/buy/road - Buy a road
        if (req.method == "POST" && gamePath.action == "buy/road") {
            return handleBuyRoad(req, gamePath.gameId);
        }
        
        // POST /games/{id}/buy/settlement - Buy a settlement
        if (req.method == "POST" && gamePath.action == "buy/settlement") {
            return handleBuySettlement(req, gamePath.gameId);
        }
        
        // POST /games/{id}/buy/city - Buy a city
        if (req.method == "POST" && gamePath.action == "buy/city") {
            return handleBuyCity(req, gamePath.gameId);
        }
        
        // POST /games/{id}/buy/devcard - Buy a development card
        if (req.method == "POST" && gamePath.action == "buy/devcard") {
            return handleBuyDevCard(req, gamePath.gameId);
        }
        
        // POST /games/{id}/trade/bank - Trade with bank
        if (req.method == "POST" && gamePath.action == "trade/bank") {
            return handleBankTrade(req, gamePath.gameId);
        }
        
        // POST /games/{id}/end-turn - End your turn
        if (req.method == "POST" && gamePath.action == "end-turn") {
            return handleEndTurn(req, gamePath.gameId);
        }
        
        // GET /games/{id} - Get game state (requires auth)
        if (req.method == "GET" && gamePath.action.empty()) {
            return handleGetGameState(req, gamePath.gameId);
        }
    }
    
    // Health check
    if (req.method == "GET" && (req.path == "/" || req.path == "/health")) {
        return jsonResponse(200, 
            "{\"status\":\"ok\","
            "\"activeGames\":" + std::to_string(gameManager.gameCount()) + ","
            "\"activeSessions\":" + std::to_string(sessionManager.activeSessionCount()) + "}");
    }
    
    return jsonResponse(404, "{\"error\":\"Not found\"}");
}

// ============================================================================
// HTTP SERVER
// ============================================================================

class HTTPServer {
private:
    int server_fd;
    struct sockaddr_in address;
    bool running;

    void handleClient(int client_socket) {
        char buffer[4096] = {0};
        int valread = read(client_socket, buffer, sizeof(buffer) - 1);

        if (valread > 0) {
            HTTPRequest req = parseRequest(std::string(buffer, valread));
            
            std::cout << req.method << " " << req.path;
            if (!req.authToken.empty()) {
                std::cout << " [auth:" << req.authToken.substr(0, 8) << "...]";
            }
            std::cout << std::endl;

            std::string response = routeRequest(req);
            send(client_socket, response.c_str(), response.length(), 0);
        }

        close(client_socket);
    }

public:
    HTTPServer(int port = 8080) : running(false) {
        server_fd = socket(AF_INET, SOCK_STREAM, 0);
        if (server_fd < 0) {
            throw std::runtime_error("Socket creation failed");
        }

        int opt = 1;
        if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
            close(server_fd);
            throw std::runtime_error("Setsockopt failed");
        }

        address.sin_family = AF_INET;
        address.sin_addr.s_addr = INADDR_ANY;
        address.sin_port = htons(port);

        if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) < 0) {
            close(server_fd);
            throw std::runtime_error("Bind failed");
        }

        if (listen(server_fd, 10) < 0) {
            close(server_fd);
            throw std::runtime_error("Listen failed");
        }

        std::cout << "🎲 Catan Game Server listening on port " << port << std::endl;
        std::cout << "\n   LOBBY:" << std::endl;
        std::cout << "   POST /games              - Create a new game" << std::endl;
        std::cout << "   GET  /games              - List all games" << std::endl;
        std::cout << "   POST /games/{id}/join    - Join a game" << std::endl;
        std::cout << "   POST /games/{id}/start   - Start the game" << std::endl;
        std::cout << "   GET  /games/{id}         - Get game state" << std::endl;
        std::cout << "\n   GAMEPLAY: (require auth token)" << std::endl;
        std::cout << "   POST /games/{id}/roll           - Roll dice" << std::endl;
        std::cout << "   POST /games/{id}/buy/road       - Buy a road" << std::endl;
        std::cout << "   POST /games/{id}/buy/settlement - Buy a settlement" << std::endl;
        std::cout << "   POST /games/{id}/buy/city       - Buy a city" << std::endl;
        std::cout << "   POST /games/{id}/buy/devcard    - Buy dev card" << std::endl;
        std::cout << "   POST /games/{id}/trade/bank     - Trade with bank (4:1)" << std::endl;
        std::cout << "   POST /games/{id}/end-turn       - End your turn" << std::endl;
        std::cout << std::endl;
    }

    ~HTTPServer() {
        if (server_fd >= 0) {
            close(server_fd);
        }
    }

    void run() {
        running = true;
        std::vector<std::thread> threads;

        while (running) {
            int addrlen = sizeof(address);
            int client_socket = accept(server_fd, (struct sockaddr*)&address, (socklen_t*)&addrlen);

            if (client_socket < 0) {
                if (running) {
                    std::cerr << "Accept failed" << std::endl;
                }
                continue;
            }

            threads.emplace_back([this, client_socket]() {
                this->handleClient(client_socket);
            });
        }

        for (auto& thread : threads) {
            if (thread.joinable()) {
                thread.join();
            }
        }
    }

    void stop() {
        running = false;
        shutdown(server_fd, SHUT_RDWR);
    }
};

int main() {
    try {
        HTTPServer server(8080);
        std::cout << "Server started. Press Ctrl+C to stop." << std::endl;
        server.run();
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
