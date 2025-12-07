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
#include <queue>
#include <condition_variable>
#include <functional>

#include "catan_types.h"
#include "session.h"
#include "ai_agent.h"
#include "llm_provider.h"

// Global LLM config manager
catan::ai::LLMConfigManager llmConfigManager;

// Map of game ID to AI turn executor
std::unordered_map<std::string, std::unique_ptr<catan::ai::AITurnExecutor>> aiExecutors;
std::mutex aiExecutorsMutex;

// Forward declaration
catan::ai::AITurnExecutor* getOrCreateAIExecutor(const std::string& gameId);

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

int parseJsonInt(const std::string& json, const std::string& key, int defaultValue = 0) {
    std::string searchKey = "\"" + key + "\":";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) return defaultValue;
    pos += searchKey.length();
    // Skip whitespace
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    // Parse integer
    size_t endPos = pos;
    if (json[endPos] == '-') endPos++;
    while (endPos < json.size() && std::isdigit(json[endPos])) endPos++;
    if (endPos == pos) return defaultValue;
    try {
        return std::stoi(json.substr(pos, endPos - pos));
    } catch (...) {
        return defaultValue;
    }
}

bool parseJsonBool(const std::string& json, const std::string& key, bool defaultValue = false) {
    std::string searchKey = "\"" + key + "\":";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) return defaultValue;
    pos += searchKey.length();
    // Skip whitespace
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (json.substr(pos, 4) == "true") return true;
    if (json.substr(pos, 5) == "false") return false;
    return defaultValue;
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
    
    // Parse player info from JSON body
    std::string playerName = parseJsonString(req.body, "name");
    bool isAI = parseJsonBool(req.body, "isAI", false);
    
    int playerId = game->players.size();
    catan::Player player;
    player.id = playerId;
    player.name = playerName.empty() ? ("Player " + std::to_string(playerId + 1)) : playerName;
    player.playerType = isAI ? catan::PlayerType::AI : catan::PlayerType::Human;
    player.isConnected = true;
    player.lastActivity = std::chrono::steady_clock::now();
    game->players.push_back(player);
    
    // Create session token (even AI players get tokens for API access)
    std::string token = sessionManager.createSession(gameId, playerId, player.name);
    
    std::string playerTypeStr = isAI ? "ai" : "human";
    
    return jsonResponse(200, 
        "{\"token\":\"" + token + "\","
        "\"playerId\":" + std::to_string(playerId) + ","
        "\"playerName\":\"" + player.name + "\","
        "\"playerType\":\"" + playerTypeStr + "\"}");
}

// Add AI players to fill the game
std::string handleAddAIPlayers(const HTTPRequest& req, const std::string& gameId) {
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    std::lock_guard<std::mutex> lock(game->mutex);
    
    if (game->phase != catan::GamePhase::WaitingForPlayers) {
        return jsonResponse(400, "{\"error\":\"Game already started\"}");
    }
    
    // Parse count from body, default to filling remaining slots
    int requestedCount = parseJsonInt(req.body, "count", -1);
    int availableSlots = game->maxPlayers - game->players.size();
    
    if (requestedCount < 0) {
        requestedCount = availableSlots;
    }
    
    int addCount = std::min(requestedCount, availableSlots);
    
    if (addCount <= 0) {
        return jsonResponse(400, "{\"error\":\"No slots available for AI players\"}");
    }
    
    // AI player names
    static const std::vector<std::string> AI_NAMES = {
        "Claude", "GPT", "Gemini", "LLaMA", "Mistral", "Falcon", "Cohere"
    };
    
    std::vector<int> addedIds;
    
    for (int i = 0; i < addCount; i++) {
        int playerId = game->players.size();
        catan::Player aiPlayer;
        aiPlayer.id = playerId;
        
        // Pick a name from the list, cycling through if needed
        size_t nameIndex = playerId % AI_NAMES.size();
        aiPlayer.name = AI_NAMES[nameIndex] + " (AI)";
        
        aiPlayer.playerType = catan::PlayerType::AI;
        aiPlayer.isConnected = true;
        aiPlayer.lastActivity = std::chrono::steady_clock::now();
        game->players.push_back(aiPlayer);
        
        // Create session token for the AI player
        sessionManager.createSession(gameId, playerId, aiPlayer.name);
        
        addedIds.push_back(playerId);
    }
    
    // Build response
    std::ostringstream json;
    json << "{\"success\":true,\"addedCount\":" << addCount << ",\"addedPlayerIds\":[";
    for (size_t i = 0; i < addedIds.size(); i++) {
        if (i > 0) json << ",";
        json << addedIds[i];
    }
    json << "],\"totalPlayers\":" << game->players.size() << "}";
    
    return jsonResponse(200, json.str());
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
    
    // Check if the next player is AI
    catan::ai::AIPlayerManager aiManager(ctx.game);
    bool nextIsAI = aiManager.isCurrentPlayerAI();
    int nextHumanIndex = aiManager.getNextHumanPlayerIndex();
    
    // If next player is AI, automatically start AI turn processing
    bool aiProcessingStarted = false;
    if (nextIsAI) {
        auto* executor = getOrCreateAIExecutor(gameId);
        if (executor) {
            aiProcessingStarted = executor->startProcessing();
        }
    }
    
    std::ostringstream json;
    json << "{\"success\":true";
    json << ",\"nextPlayer\":" << ctx.game->currentPlayerIndex;
    json << ",\"nextPlayerName\":\"" << (nextPlayer ? nextPlayer->name : "unknown") << "\"";
    json << ",\"nextPlayerIsAI\":" << (nextIsAI ? "true" : "false");
    
    // If next player is AI, include info about when control returns to a human
    if (nextIsAI) {
        json << ",\"pendingAITurns\":true";
        json << ",\"aiProcessingStarted\":" << (aiProcessingStarted ? "true" : "false");
        if (nextHumanIndex >= 0) {
            json << ",\"nextHumanPlayerIndex\":" << nextHumanIndex;
            json << ",\"nextHumanPlayerName\":\"" << ctx.game->players[nextHumanIndex].name << "\"";
        }
    }
    
    json << "}";
    
    return jsonResponse(200, json.str());
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
    
    // Check if the first player is AI
    catan::ai::AIPlayerManager aiManager(ctx.game);
    bool firstIsAI = aiManager.isCurrentPlayerAI();
    
    std::ostringstream json;
    json << "{\"success\":true,\"message\":\"Game started\"";
    json << ",\"currentPlayer\":0";
    json << ",\"phase\":\"rolling\"";
    json << ",\"currentPlayerIsAI\":" << (firstIsAI ? "true" : "false");
    
    // Include player info
    json << ",\"players\":[";
    for (size_t i = 0; i < ctx.game->players.size(); i++) {
        if (i > 0) json << ",";
        auto& p = ctx.game->players[i];
        json << "{\"id\":" << p.id;
        json << ",\"name\":\"" << p.name << "\"";
        json << ",\"type\":\"" << (p.isAI() ? "ai" : "human") << "\"}";
    }
    json << "]";
    json << "}";
    
    return jsonResponse(200, json.str());
}

// ============================================================================
// AI-SPECIFIC ENDPOINTS
// ============================================================================

// Get AI game state for decision making
std::string handleGetAIState(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId, false);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    catan::ai::AIGameState state = catan::ai::getAIGameState(*ctx.game, ctx.session->playerId);
    std::string stateJson = catan::ai::aiGameStateToJson(state);
    
    return jsonResponse(200, stateJson);
}

// Get available tools and their definitions
std::string handleGetAITools(const HTTPRequest& req) {
    auto tools = catan::ai::getToolDefinitions();
    
    std::ostringstream json;
    json << "{\"tools\":[";
    for (size_t i = 0; i < tools.size(); i++) {
        if (i > 0) json << ",";
        json << "{\"name\":\"" << tools[i].name << "\"";
        json << ",\"description\":\"" << tools[i].description << "\"";
        json << ",\"parameters\":" << tools[i].parametersSchema;
        json << "}";
    }
    json << "]}";
    
    return jsonResponse(200, json.str());
}

// Execute an AI tool
std::string handleExecuteAITool(const HTTPRequest& req, const std::string& gameId) {
    GameContext ctx = getGameContext(req, gameId);
    if (ctx.errorCode) return jsonResponse(ctx.errorCode, ctx.error);
    
    // Verify this is an AI player
    if (!ctx.player->isAI()) {
        return jsonResponse(400, "{\"error\":\"This endpoint is for AI players only\"}");
    }
    
    std::string toolName = parseJsonString(req.body, "tool");
    if (toolName.empty()) {
        return jsonResponse(400, "{\"error\":\"Missing 'tool' parameter\"}");
    }
    
    std::lock_guard<std::mutex> lock(ctx.game->mutex);
    
    // Route to appropriate action handler based on tool name
    // This reuses existing game logic
    
    if (toolName == "roll_dice") {
        // Simulate the roll dice action
        if (ctx.game->phase != catan::GamePhase::Rolling) {
            return jsonResponse(400, "{\"error\":\"Cannot roll now\"}");
        }
        
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<> die(1, 6);
        
        catan::DiceRoll roll;
        roll.die1 = die(gen);
        roll.die2 = die(gen);
        ctx.game->lastRoll = roll;
        
        int total = roll.total();
        
        if (total == 7) {
            ctx.game->phase = catan::GamePhase::Robber;
            return jsonResponse(200, 
                "{\"success\":true,\"tool\":\"roll_dice\","
                "\"die1\":" + std::to_string(roll.die1) + 
                ",\"die2\":" + std::to_string(roll.die2) + 
                ",\"total\":7,\"robber\":true}");
        }
        
        // Resource distribution logic...
        ctx.game->phase = catan::GamePhase::MainTurn;
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"roll_dice\","
            "\"die1\":" + std::to_string(roll.die1) + 
            ",\"die2\":" + std::to_string(roll.die2) + 
            ",\"total\":" + std::to_string(total) + "}");
    }
    
    if (toolName == "end_turn") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot end turn during this phase\"}");
        }
        
        ctx.game->currentPlayerIndex = (ctx.game->currentPlayerIndex + 1) % ctx.game->players.size();
        ctx.game->phase = catan::GamePhase::Rolling;
        ctx.game->devCardPlayedThisTurn = false;
        
        catan::Player* nextPlayer = ctx.game->getCurrentPlayer();
        bool nextIsAI = nextPlayer && nextPlayer->isAI();
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"end_turn\","
            "\"nextPlayer\":" + std::to_string(ctx.game->currentPlayerIndex) + 
            ",\"nextPlayerIsAI\":" + (nextIsAI ? "true" : "false") + "}");
    }
    
    if (toolName == "build_road") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
        }
        if (!canAfford(ctx.player->resources, ROAD_COST)) {
            return jsonResponse(400, "{\"error\":\"Not enough resources\"}");
        }
        if (ctx.player->roadsRemaining <= 0) {
            return jsonResponse(400, "{\"error\":\"No roads remaining\"}");
        }
        
        // Parse location
        int hexQ = parseJsonInt(req.body, "hexQ", 0);
        int hexR = parseJsonInt(req.body, "hexR", 0);
        int direction = parseJsonInt(req.body, "direction", 0);
        
        // TODO: Validate placement rules
        
        subtractResources(ctx.player->resources, ROAD_COST);
        ctx.player->roadsRemaining--;
        
        // Place the road on the board
        catan::EdgeCoord coord{{hexQ, hexR}, direction};
        auto it = ctx.game->board.edges.find(coord);
        if (it != ctx.game->board.edges.end()) {
            it->second.hasRoad = true;
            it->second.ownerPlayerId = ctx.player->id;
        }
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"build_road\","
            "\"hexQ\":" + std::to_string(hexQ) +
            ",\"hexR\":" + std::to_string(hexR) +
            ",\"direction\":" + std::to_string(direction) + "}");
    }
    
    if (toolName == "build_settlement") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
        }
        if (!canAfford(ctx.player->resources, SETTLEMENT_COST)) {
            return jsonResponse(400, "{\"error\":\"Not enough resources\"}");
        }
        if (ctx.player->settlementsRemaining <= 0) {
            return jsonResponse(400, "{\"error\":\"No settlements remaining\"}");
        }
        
        int hexQ = parseJsonInt(req.body, "hexQ", 0);
        int hexR = parseJsonInt(req.body, "hexR", 0);
        int direction = parseJsonInt(req.body, "direction", 0);
        
        // TODO: Validate placement rules
        
        subtractResources(ctx.player->resources, SETTLEMENT_COST);
        ctx.player->settlementsRemaining--;
        
        catan::VertexCoord coord{{hexQ, hexR}, direction};
        auto it = ctx.game->board.vertices.find(coord);
        if (it != ctx.game->board.vertices.end()) {
            it->second.building = catan::Building::Settlement;
            it->second.ownerPlayerId = ctx.player->id;
        }
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"build_settlement\","
            "\"hexQ\":" + std::to_string(hexQ) +
            ",\"hexR\":" + std::to_string(hexR) +
            ",\"direction\":" + std::to_string(direction) + "}");
    }
    
    if (toolName == "build_city") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot build during this phase\"}");
        }
        if (!canAfford(ctx.player->resources, CITY_COST)) {
            return jsonResponse(400, "{\"error\":\"Not enough resources\"}");
        }
        if (ctx.player->citiesRemaining <= 0) {
            return jsonResponse(400, "{\"error\":\"No cities remaining\"}");
        }
        
        int hexQ = parseJsonInt(req.body, "hexQ", 0);
        int hexR = parseJsonInt(req.body, "hexR", 0);
        int direction = parseJsonInt(req.body, "direction", 0);
        
        // Verify there's a settlement to upgrade
        catan::VertexCoord coord{{hexQ, hexR}, direction};
        auto it = ctx.game->board.vertices.find(coord);
        if (it == ctx.game->board.vertices.end() || 
            it->second.building != catan::Building::Settlement ||
            it->second.ownerPlayerId != ctx.player->id) {
            return jsonResponse(400, "{\"error\":\"No settlement to upgrade at this location\"}");
        }
        
        subtractResources(ctx.player->resources, CITY_COST);
        ctx.player->citiesRemaining--;
        ctx.player->settlementsRemaining++;  // Return settlement
        it->second.building = catan::Building::City;
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"build_city\","
            "\"hexQ\":" + std::to_string(hexQ) +
            ",\"hexR\":" + std::to_string(hexR) +
            ",\"direction\":" + std::to_string(direction) + "}");
    }
    
    if (toolName == "buy_dev_card") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot buy during this phase\"}");
        }
        if (!canAfford(ctx.player->resources, DEV_CARD_COST)) {
            return jsonResponse(400, "{\"error\":\"Not enough resources\"}");
        }
        if (ctx.game->devCardDeck.empty()) {
            return jsonResponse(400, "{\"error\":\"No dev cards remaining\"}");
        }
        
        subtractResources(ctx.player->resources, DEV_CARD_COST);
        
        catan::DevCardType card = ctx.game->devCardDeck.back();
        ctx.game->devCardDeck.pop_back();
        ctx.player->devCards.push_back(card);
        
        std::string cardName;
        switch (card) {
            case catan::DevCardType::Knight: cardName = "knight"; break;
            case catan::DevCardType::VictoryPoint: cardName = "victory_point"; break;
            case catan::DevCardType::RoadBuilding: cardName = "road_building"; break;
            case catan::DevCardType::YearOfPlenty: cardName = "year_of_plenty"; break;
            case catan::DevCardType::Monopoly: cardName = "monopoly"; break;
        }
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"buy_dev_card\",\"card\":\"" + cardName + "\"}");
    }
    
    if (toolName == "bank_trade") {
        if (ctx.game->phase != catan::GamePhase::MainTurn) {
            return jsonResponse(400, "{\"error\":\"Cannot trade during this phase\"}");
        }
        
        std::string giveStr = parseJsonString(req.body, "give");
        std::string receiveStr = parseJsonString(req.body, "receive");
        
        catan::Resource give = stringToResource(giveStr);
        catan::Resource receive = stringToResource(receiveStr);
        
        if (give == catan::Resource::None || receive == catan::Resource::None) {
            return jsonResponse(400, "{\"error\":\"Invalid resources\"}");
        }
        
        int ratio = 4;  // TODO: Check for ports
        
        if (ctx.player->resources[give] < ratio) {
            return jsonResponse(400, "{\"error\":\"Not enough resources\"}");
        }
        
        ctx.player->resources[give] -= ratio;
        ctx.player->resources[receive] += 1;
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"bank_trade\","
            "\"gave\":\"" + giveStr + "\",\"gaveAmount\":" + std::to_string(ratio) +
            ",\"received\":\"" + receiveStr + "\",\"receivedAmount\":1}");
    }
    
    if (toolName == "move_robber") {
        if (ctx.game->phase != catan::GamePhase::Robber) {
            return jsonResponse(400, "{\"error\":\"Not in robber phase\"}");
        }
        
        int hexQ = parseJsonInt(req.body, "hexQ", 0);
        int hexR = parseJsonInt(req.body, "hexR", 0);
        int stealFrom = parseJsonInt(req.body, "stealFromPlayerId", -1);
        
        // Move robber
        catan::HexCoord oldLoc = ctx.game->board.robberLocation;
        catan::HexCoord newLoc{hexQ, hexR};
        
        auto oldIt = ctx.game->board.hexes.find(oldLoc);
        if (oldIt != ctx.game->board.hexes.end()) {
            oldIt->second.hasRobber = false;
        }
        
        auto newIt = ctx.game->board.hexes.find(newLoc);
        if (newIt != ctx.game->board.hexes.end()) {
            newIt->second.hasRobber = true;
        }
        ctx.game->board.robberLocation = newLoc;
        
        // Steal from player if specified
        std::string stolenResource = "none";
        if (stealFrom >= 0 && stealFrom < (int)ctx.game->players.size()) {
            catan::Player* victim = &ctx.game->players[stealFrom];
            if (victim->resources.total() > 0) {
                // Randomly steal one resource
                std::vector<catan::Resource> available;
                if (victim->resources.wood > 0) available.push_back(catan::Resource::Wood);
                if (victim->resources.brick > 0) available.push_back(catan::Resource::Brick);
                if (victim->resources.wheat > 0) available.push_back(catan::Resource::Wheat);
                if (victim->resources.sheep > 0) available.push_back(catan::Resource::Sheep);
                if (victim->resources.ore > 0) available.push_back(catan::Resource::Ore);
                
                if (!available.empty()) {
                    static std::random_device rd;
                    static std::mt19937 gen(rd());
                    std::uniform_int_distribution<> dis(0, available.size() - 1);
                    catan::Resource stolen = available[dis(gen)];
                    victim->resources[stolen]--;
                    ctx.player->resources[stolen]++;
                    stolenResource = resourceToString(stolen);
                }
            }
        }
        
        ctx.game->phase = catan::GamePhase::MainTurn;
        
        return jsonResponse(200, 
            "{\"success\":true,\"tool\":\"move_robber\","
            "\"hexQ\":" + std::to_string(hexQ) +
            ",\"hexR\":" + std::to_string(hexR) +
            ",\"stolenResource\":\"" + stolenResource + "\"}");
    }
    
    return jsonResponse(400, "{\"error\":\"Unknown tool: " + toolName + "\"}");
}

// Get information about pending AI turns
std::string handleGetPendingAITurns(const HTTPRequest& req, const std::string& gameId) {
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    std::lock_guard<std::mutex> lock(game->mutex);
    
    catan::ai::AIPlayerManager aiManager(game);
    
    std::ostringstream json;
    json << "{";
    json << "\"currentPlayerIndex\":" << game->currentPlayerIndex;
    json << ",\"currentPlayerIsAI\":" << (aiManager.isCurrentPlayerAI() ? "true" : "false");
    json << ",\"phase\":\"" << static_cast<int>(game->phase) << "\"";
    
    if (aiManager.isCurrentPlayerAI()) {
        auto& currentPlayer = game->players[game->currentPlayerIndex];
        json << ",\"currentAIPlayer\":{";
        json << "\"id\":" << currentPlayer.id;
        json << ",\"name\":\"" << currentPlayer.name << "\"";
        json << "}";
    }
    
    int nextHuman = aiManager.getNextHumanPlayerIndex();
    if (nextHuman >= 0) {
        json << ",\"nextHumanPlayerIndex\":" << nextHuman;
        json << ",\"nextHumanPlayerName\":\"" << game->players[nextHuman].name << "\"";
    }
    
    json << ",\"humanCount\":" << aiManager.humanPlayerCount();
    json << ",\"aiCount\":" << aiManager.aiPlayerCount();
    json << "}";
    
    return jsonResponse(200, json.str());
}

// ============================================================================
// SERVER-SIDE AI TURN PROCESSING
// ============================================================================

// Get or create AI executor for a game
catan::ai::AITurnExecutor* getOrCreateAIExecutor(const std::string& gameId) {
    std::lock_guard<std::mutex> lock(aiExecutorsMutex);
    
    auto it = aiExecutors.find(gameId);
    if (it != aiExecutors.end()) {
        return it->second.get();
    }
    
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return nullptr;
    }
    
    auto executor = std::make_unique<catan::ai::AITurnExecutor>(game, llmConfigManager);
    auto* ptr = executor.get();
    aiExecutors[gameId] = std::move(executor);
    return ptr;
}

// Start AI turn processing for a game
std::string handleStartAITurns(const HTTPRequest& req, const std::string& gameId) {
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    auto* executor = getOrCreateAIExecutor(gameId);
    if (!executor) {
        return jsonResponse(500, "{\"error\":\"Failed to create AI executor\"}");
    }
    
    bool started = executor->startProcessing();
    
    std::ostringstream json;
    json << "{";
    json << "\"started\":" << (started ? "true" : "false");
    json << ",\"status\":\"" << (started ? "processing" : "already_running_or_no_ai_turns") << "\"";
    json << ",\"llmProvider\":\"" << llmConfigManager.getConfig().provider << "\"";
    json << "}";
    
    return jsonResponse(200, json.str());
}

// Stop AI turn processing for a game
std::string handleStopAITurns(const HTTPRequest& req, const std::string& gameId) {
    std::lock_guard<std::mutex> lock(aiExecutorsMutex);
    
    auto it = aiExecutors.find(gameId);
    if (it == aiExecutors.end()) {
        return jsonResponse(200, "{\"stopped\":true,\"message\":\"No AI processing was running\"}");
    }
    
    it->second->stopProcessing();
    
    return jsonResponse(200, "{\"stopped\":true}");
}

// Get AI turn processing status
std::string handleGetAITurnStatus(const HTTPRequest& req, const std::string& gameId) {
    catan::Game* game = gameManager.getGame(gameId);
    if (!game) {
        return jsonResponse(404, "{\"error\":\"Game not found\"}");
    }
    
    auto* executor = getOrCreateAIExecutor(gameId);
    if (!executor) {
        return jsonResponse(500, "{\"error\":\"Failed to get AI executor\"}");
    }
    
    return jsonResponse(200, executor->statusToJson());
}

// Get AI action log for a game
std::string handleGetAIActionLog(const HTTPRequest& req, const std::string& gameId) {
    std::lock_guard<std::mutex> lock(aiExecutorsMutex);
    
    auto it = aiExecutors.find(gameId);
    if (it == aiExecutors.end()) {
        return jsonResponse(200, "{\"actions\":[]}");
    }
    
    auto actions = it->second->getActionLog(100);
    
    std::ostringstream json;
    json << "{\"actions\":[";
    for (size_t i = 0; i < actions.size(); i++) {
        if (i > 0) json << ",";
        const auto& a = actions[i];
        json << "{";
        json << "\"playerId\":" << a.playerId;
        json << ",\"playerName\":\"" << a.playerName << "\"";
        json << ",\"action\":\"" << a.action << "\"";
        json << ",\"description\":\"" << a.description << "\"";
        json << ",\"success\":" << (a.success ? "true" : "false");
        if (!a.error.empty()) {
            json << ",\"error\":\"" << a.error << "\"";
        }
        json << "}";
    }
    json << "]}";
    
    return jsonResponse(200, json.str());
}

// ============================================================================
// LLM CONFIGURATION ENDPOINTS
// ============================================================================

// Get current LLM configuration
std::string handleGetLLMConfig(const HTTPRequest& req) {
    return jsonResponse(200, llmConfigManager.toJson());
}

// Set LLM configuration
std::string handleSetLLMConfig(const HTTPRequest& req) {
    std::string provider = parseJsonString(req.body, "provider");
    std::string apiKey = parseJsonString(req.body, "apiKey");
    std::string model = parseJsonString(req.body, "model");
    std::string baseUrl = parseJsonString(req.body, "baseUrl");
    
    if (provider.empty()) {
        return jsonResponse(400, "{\"error\":\"Missing provider\"}");
    }
    
    catan::ai::LLMConfig config;
    config.provider = provider;
    config.apiKey = apiKey;
    config.model = model;
    config.baseUrl = baseUrl;
    
    llmConfigManager.setConfig(config);
    
    return jsonResponse(200, llmConfigManager.toJson());
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
    
    // GET /ai/tools - Get AI tool definitions (no auth needed)
    if (req.method == "GET" && req.path == "/ai/tools") {
        return handleGetAITools(req);
    }
    
    // ============ LLM CONFIGURATION ============
    
    // GET /llm/config - Get LLM configuration
    if (req.method == "GET" && req.path == "/llm/config") {
        return handleGetLLMConfig(req);
    }
    
    // POST /llm/config - Set LLM configuration
    if (req.method == "POST" && req.path == "/llm/config") {
        return handleSetLLMConfig(req);
    }
    
    // Parse game-specific routes
    ParsedGamePath gamePath = parseGamePath(req.path);
    
    if (gamePath.valid) {
        // POST /games/{id}/join - Join a game
        if (req.method == "POST" && gamePath.action == "join") {
            return handleJoinGame(req, gamePath.gameId);
        }
        
        // POST /games/{id}/add-ai - Add AI players to fill slots
        if (req.method == "POST" && gamePath.action == "add-ai") {
            return handleAddAIPlayers(req, gamePath.gameId);
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
        
        // ============ SERVER-SIDE AI TURN PROCESSING ============
        
        // POST /games/{id}/ai/start - Start AI turn processing
        if (req.method == "POST" && gamePath.action == "ai/start") {
            return handleStartAITurns(req, gamePath.gameId);
        }
        
        // POST /games/{id}/ai/stop - Stop AI turn processing
        if (req.method == "POST" && gamePath.action == "ai/stop") {
            return handleStopAITurns(req, gamePath.gameId);
        }
        
        // GET /games/{id}/ai/status - Get AI processing status
        if (req.method == "GET" && gamePath.action == "ai/status") {
            return handleGetAITurnStatus(req, gamePath.gameId);
        }
        
        // GET /games/{id}/ai/log - Get AI action log
        if (req.method == "GET" && gamePath.action == "ai/log") {
            return handleGetAIActionLog(req, gamePath.gameId);
        }
        
        // ============ AI STATE ENDPOINTS (for external AI) ============
        
        // GET /games/{id}/ai/state - Get AI game state for decision making
        if (req.method == "GET" && gamePath.action == "ai/state") {
            return handleGetAIState(req, gamePath.gameId);
        }
        
        // POST /games/{id}/ai/execute - Execute an AI tool (for external AI)
        if (req.method == "POST" && gamePath.action == "ai/execute") {
            return handleExecuteAITool(req, gamePath.gameId);
        }
        
        // GET /games/{id}/ai/pending - Get pending AI turns info
        if (req.method == "GET" && gamePath.action == "ai/pending") {
            return handleGetPendingAITurns(req, gamePath.gameId);
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
            "\"activeSessions\":" + std::to_string(sessionManager.activeSessionCount()) + ","
            "\"llmProvider\":\"" + llmConfigManager.getConfig().provider + "\"}");
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
        std::cout << "   POST /games/{id}/join    - Join a game (body: {name, isAI})" << std::endl;
        std::cout << "   POST /games/{id}/add-ai  - Add AI players to fill slots" << std::endl;
        std::cout << "   POST /games/{id}/start   - Start the game" << std::endl;
        std::cout << "   GET  /games/{id}         - Get game state" << std::endl;
        std::cout << "\n   GAMEPLAY: (require auth token)" << std::endl;
        std::cout << "   POST /games/{id}/roll           - Roll dice" << std::endl;
        std::cout << "   POST /games/{id}/buy/road       - Buy a road" << std::endl;
        std::cout << "   POST /games/{id}/buy/settlement - Buy a settlement" << std::endl;
        std::cout << "   POST /games/{id}/buy/city       - Buy a city" << std::endl;
        std::cout << "   POST /games/{id}/buy/devcard    - Buy dev card" << std::endl;
        std::cout << "   POST /games/{id}/trade/bank     - Trade with bank (4:1)" << std::endl;
        std::cout << "   POST /games/{id}/end-turn       - End your turn (auto-triggers AI)" << std::endl;
        std::cout << "\n   SERVER-SIDE AI (auto-runs when AI player's turn):" << std::endl;
        std::cout << "   POST /games/{id}/ai/start      - Manually start AI processing" << std::endl;
        std::cout << "   POST /games/{id}/ai/stop       - Stop AI processing" << std::endl;
        std::cout << "   GET  /games/{id}/ai/status     - Get AI processing status" << std::endl;
        std::cout << "   GET  /games/{id}/ai/log        - Get AI action log" << std::endl;
        std::cout << "\n   LLM CONFIGURATION:" << std::endl;
        std::cout << "   GET  /llm/config               - Get LLM config" << std::endl;
        std::cout << "   POST /llm/config               - Set LLM config (provider, apiKey, model)" << std::endl;
        std::cout << "\n   Current LLM: " << llmConfigManager.getConfig().provider << std::endl;
        std::cout << "   (Set ANTHROPIC_API_KEY or OPENAI_API_KEY env var to auto-configure)" << std::endl;
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
