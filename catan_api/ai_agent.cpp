#include "ai_agent.h"
#include "sse_handler.h"
#include <sstream>
#include <random>

namespace catan {
namespace ai {

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

std::vector<ToolDefinition> getToolDefinitions() {
    return {
        {
            "roll_dice",
            "Roll the dice to start your turn. Must be done at the beginning of each turn during the Rolling phase.",
            "{\"type\":\"object\",\"properties\":{},\"required\":[]}"
        },
        {
            "build_road",
            "Build a road on an edge. Costs 1 wood + 1 brick. Roads must connect to your existing roads or settlements.",
            "{\"type\":\"object\",\"properties\":{\"hexQ\":{\"type\":\"integer\"},\"hexR\":{\"type\":\"integer\"},\"direction\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":5}},\"required\":[\"hexQ\",\"hexR\",\"direction\"]}"
        },
        {
            "build_settlement",
            "Build a settlement on a vertex. Costs 1 wood + 1 brick + 1 wheat + 1 sheep.",
            "{\"type\":\"object\",\"properties\":{\"hexQ\":{\"type\":\"integer\"},\"hexR\":{\"type\":\"integer\"},\"direction\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":5}},\"required\":[\"hexQ\",\"hexR\",\"direction\"]}"
        },
        {
            "build_city",
            "Upgrade a settlement to a city. Costs 2 wheat + 3 ore.",
            "{\"type\":\"object\",\"properties\":{\"hexQ\":{\"type\":\"integer\"},\"hexR\":{\"type\":\"integer\"},\"direction\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":5}},\"required\":[\"hexQ\",\"hexR\",\"direction\"]}"
        },
        {
            "buy_dev_card",
            "Buy a development card. Costs 1 wheat + 1 sheep + 1 ore.",
            "{\"type\":\"object\",\"properties\":{},\"required\":[]}"
        },
        {
            "bank_trade",
            "Trade 4 of one resource for 1 of another with the bank.",
            "{\"type\":\"object\",\"properties\":{\"give\":{\"type\":\"string\",\"enum\":[\"wood\",\"brick\",\"wheat\",\"sheep\",\"ore\"]},\"receive\":{\"type\":\"string\",\"enum\":[\"wood\",\"brick\",\"wheat\",\"sheep\",\"ore\"]}},\"required\":[\"give\",\"receive\"]}"
        },
        {
            "move_robber",
            "Move the robber to a new hex and optionally steal from a player.",
            "{\"type\":\"object\",\"properties\":{\"hexQ\":{\"type\":\"integer\"},\"hexR\":{\"type\":\"integer\"},\"stealFromPlayerId\":{\"type\":\"integer\"}},\"required\":[\"hexQ\",\"hexR\",\"stealFromPlayerId\"]}"
        },
        {
            "play_knight",
            "Play a Knight development card. Move the robber and steal a resource.",
            "{\"type\":\"object\",\"properties\":{\"hexQ\":{\"type\":\"integer\"},\"hexR\":{\"type\":\"integer\"},\"stealFromPlayerId\":{\"type\":\"integer\"}},\"required\":[\"hexQ\",\"hexR\",\"stealFromPlayerId\"]}"
        },
        {
            "play_road_building",
            "Play Road Building development card. Build up to 2 roads for free.",
            "{\"type\":\"object\",\"properties\":{\"road1HexQ\":{\"type\":\"integer\"},\"road1HexR\":{\"type\":\"integer\"},\"road1Direction\":{\"type\":\"integer\"},\"road2HexQ\":{\"type\":\"integer\"},\"road2HexR\":{\"type\":\"integer\"},\"road2Direction\":{\"type\":\"integer\"}},\"required\":[\"road1HexQ\",\"road1HexR\",\"road1Direction\"]}"
        },
        {
            "play_year_of_plenty",
            "Play Year of Plenty development card. Take any 2 resources from the bank.",
            "{\"type\":\"object\",\"properties\":{\"resource1\":{\"type\":\"string\",\"enum\":[\"wood\",\"brick\",\"wheat\",\"sheep\",\"ore\"]},\"resource2\":{\"type\":\"string\",\"enum\":[\"wood\",\"brick\",\"wheat\",\"sheep\",\"ore\"]}},\"required\":[\"resource1\",\"resource2\"]}"
        },
        {
            "play_monopoly",
            "Play Monopoly development card. Take all of one resource type from all other players.",
            "{\"type\":\"object\",\"properties\":{\"resource\":{\"type\":\"string\",\"enum\":[\"wood\",\"brick\",\"wheat\",\"sheep\",\"ore\"]}},\"required\":[\"resource\"]}"
        },
        {
            "end_turn",
            "End your turn and pass to the next player.",
            "{\"type\":\"object\",\"properties\":{},\"required\":[]}"
        }
    };
}

// ============================================================================
// GAME STATE FOR AI
// ============================================================================

std::string hexTypeToString(HexType type) {
    switch (type) {
        case HexType::Desert: return "desert";
        case HexType::Forest: return "forest";
        case HexType::Hills: return "hills";
        case HexType::Fields: return "fields";
        case HexType::Pasture: return "pasture";
        case HexType::Mountains: return "mountains";
        case HexType::Ocean: return "ocean";
        default: return "unknown";
    }
}

std::string buildingToString(Building building) {
    switch (building) {
        case Building::None: return "none";
        case Building::Settlement: return "settlement";
        case Building::City: return "city";
        default: return "unknown";
    }
}

std::string phaseToString(GamePhase phase) {
    switch (phase) {
        case GamePhase::WaitingForPlayers: return "waiting_for_players";
        case GamePhase::Setup: return "setup";
        case GamePhase::SetupReverse: return "setup_reverse";
        case GamePhase::Rolling: return "rolling";
        case GamePhase::Robber: return "robber";
        case GamePhase::Stealing: return "stealing";
        case GamePhase::MainTurn: return "main_turn";
        case GamePhase::Trading: return "trading";
        case GamePhase::Finished: return "finished";
        default: return "unknown";
    }
}

std::string resourceToString(Resource r) {
    switch (r) {
        case Resource::Wood: return "wood";
        case Resource::Brick: return "brick";
        case Resource::Wheat: return "wheat";
        case Resource::Sheep: return "sheep";
        case Resource::Ore: return "ore";
        default: return "none";
    }
}

std::string devCardToString(DevCardType type) {
    switch (type) {
        case DevCardType::Knight: return "knight";
        case DevCardType::VictoryPoint: return "victory_point";
        case DevCardType::RoadBuilding: return "road_building";
        case DevCardType::YearOfPlenty: return "year_of_plenty";
        case DevCardType::Monopoly: return "monopoly";
        default: return "unknown";
    }
}

AIGameState getAIGameState(const Game& game, int playerId) {
    AIGameState state;
    
    const Player* player = nullptr;
    for (const auto& p : game.players) {
        if (p.id == playerId) {
            player = &p;
            break;
        }
    }
    
    if (!player) {
        // Return empty state if player not found
        return state;
    }
    
    // Current player info
    state.playerId = player->id;
    state.playerName = player->name;
    state.resources = player->resources;
    state.devCards = player->devCards;
    state.settlementsRemaining = player->settlementsRemaining;
    state.citiesRemaining = player->citiesRemaining;
    state.roadsRemaining = player->roadsRemaining;
    state.knightsPlayed = player->knightsPlayed;
    
    // Game phase
    state.phase = game.phase;
    state.isMyTurn = (game.currentPlayerIndex == playerId);
    state.lastRoll = game.lastRoll;
    
    // Other players (public info only)
    for (const auto& p : game.players) {
        if (p.id != playerId) {
            AIGameState::OtherPlayer other;
            other.id = p.id;
            other.name = p.name;
            other.resourceCount = p.resources.total();
            other.devCardCount = p.devCards.size();
            other.knightsPlayed = p.knightsPlayed;
            other.hasLongestRoad = p.hasLongestRoad;
            other.hasLargestArmy = p.hasLargestArmy;
            // Calculate visible VP (buildings counted separately)
            other.visibleVictoryPoints = 0;
            if (p.hasLongestRoad) other.visibleVictoryPoints += 2;
            if (p.hasLargestArmy) other.visibleVictoryPoints += 2;
            state.otherPlayers.push_back(other);
        }
    }
    
    // Board state - hexes
    for (const auto& [coord, hex] : game.board.hexes) {
        AIGameState::HexInfo info;
        info.q = coord.q;
        info.r = coord.r;
        info.type = hex.type;
        info.numberToken = hex.numberToken;
        info.hasRobber = hex.hasRobber;
        state.hexes.push_back(info);
    }
    
    // Board state - buildings (only occupied)
    for (const auto& [coord, vertex] : game.board.vertices) {
        if (vertex.building != Building::None) {
            AIGameState::VertexInfo info;
            info.hexQ = coord.hex.q;
            info.hexR = coord.hex.r;
            info.direction = coord.direction;
            info.building = vertex.building;
            info.ownerPlayerId = vertex.ownerPlayerId;
            state.buildings.push_back(info);
        }
    }
    
    // Board state - roads (only edges with roads)
    for (const auto& [coord, edge] : game.board.edges) {
        if (edge.hasRoad) {
            AIGameState::EdgeInfo info;
            info.hexQ = coord.hex.q;
            info.hexR = coord.hex.r;
            info.direction = coord.direction;
            info.ownerPlayerId = edge.ownerPlayerId;
            state.roads.push_back(info);
        }
    }
    
    // Determine available tools based on phase
    if (state.isMyTurn) {
        switch (state.phase) {
            case GamePhase::Rolling:
                state.availableTools.push_back("roll_dice");
                // Can play knight before rolling
                for (auto card : player->devCards) {
                    if (card == DevCardType::Knight) {
                        state.availableTools.push_back("play_knight");
                        break;
                    }
                }
                break;
                
            case GamePhase::Robber:
                state.availableTools.push_back("move_robber");
                break;
                
            case GamePhase::MainTurn:
                // Building options (if affordable)
                if (player->resources.wood >= 1 && player->resources.brick >= 1 && 
                    player->roadsRemaining > 0) {
                    state.availableTools.push_back("build_road");
                }
                if (player->resources.wood >= 1 && player->resources.brick >= 1 &&
                    player->resources.wheat >= 1 && player->resources.sheep >= 1 &&
                    player->settlementsRemaining > 0) {
                    state.availableTools.push_back("build_settlement");
                }
                if (player->resources.wheat >= 2 && player->resources.ore >= 3 &&
                    player->citiesRemaining > 0) {
                    state.availableTools.push_back("build_city");
                }
                if (player->resources.wheat >= 1 && player->resources.sheep >= 1 &&
                    player->resources.ore >= 1) {
                    state.availableTools.push_back("buy_dev_card");
                }
                
                // Trading
                if (player->resources.wood >= 4 || player->resources.brick >= 4 ||
                    player->resources.wheat >= 4 || player->resources.sheep >= 4 ||
                    player->resources.ore >= 4) {
                    state.availableTools.push_back("bank_trade");
                }
                
                // Development cards
                for (auto card : player->devCards) {
                    if (card == DevCardType::Knight) {
                        state.availableTools.push_back("play_knight");
                    } else if (card == DevCardType::RoadBuilding) {
                        state.availableTools.push_back("play_road_building");
                    } else if (card == DevCardType::YearOfPlenty) {
                        state.availableTools.push_back("play_year_of_plenty");
                    } else if (card == DevCardType::Monopoly) {
                        state.availableTools.push_back("play_monopoly");
                    }
                }
                
                // Can always end turn
                state.availableTools.push_back("end_turn");
                break;
                
            default:
                break;
        }
    }
    
    return state;
}

std::string aiGameStateToJson(const AIGameState& state) {
    std::ostringstream json;
    
    json << "{";
    
    // Player info
    json << "\"playerId\":" << state.playerId << ",";
    json << "\"playerName\":\"" << state.playerName << "\",";
    json << "\"resources\":{";
    json << "\"wood\":" << state.resources.wood << ",";
    json << "\"brick\":" << state.resources.brick << ",";
    json << "\"wheat\":" << state.resources.wheat << ",";
    json << "\"sheep\":" << state.resources.sheep << ",";
    json << "\"ore\":" << state.resources.ore;
    json << "},";
    
    // Dev cards
    json << "\"devCards\":[";
    for (size_t i = 0; i < state.devCards.size(); i++) {
        if (i > 0) json << ",";
        json << "\"" << devCardToString(state.devCards[i]) << "\"";
    }
    json << "],";
    
    // Building pieces remaining
    json << "\"settlementsRemaining\":" << state.settlementsRemaining << ",";
    json << "\"citiesRemaining\":" << state.citiesRemaining << ",";
    json << "\"roadsRemaining\":" << state.roadsRemaining << ",";
    json << "\"knightsPlayed\":" << state.knightsPlayed << ",";
    
    // Game state
    json << "\"phase\":\"" << phaseToString(state.phase) << "\",";
    json << "\"isMyTurn\":" << (state.isMyTurn ? "true" : "false") << ",";
    
    if (state.lastRoll) {
        json << "\"lastRoll\":{\"die1\":" << state.lastRoll->die1 
             << ",\"die2\":" << state.lastRoll->die2 
             << ",\"total\":" << state.lastRoll->total() << "},";
    }
    
    // Other players
    json << "\"otherPlayers\":[";
    for (size_t i = 0; i < state.otherPlayers.size(); i++) {
        if (i > 0) json << ",";
        const auto& p = state.otherPlayers[i];
        json << "{\"id\":" << p.id;
        json << ",\"name\":\"" << p.name << "\"";
        json << ",\"resourceCount\":" << p.resourceCount;
        json << ",\"devCardCount\":" << p.devCardCount;
        json << ",\"knightsPlayed\":" << p.knightsPlayed;
        json << ",\"hasLongestRoad\":" << (p.hasLongestRoad ? "true" : "false");
        json << ",\"hasLargestArmy\":" << (p.hasLargestArmy ? "true" : "false");
        json << ",\"visibleVictoryPoints\":" << p.visibleVictoryPoints;
        json << "}";
    }
    json << "],";
    
    // Board - hexes
    json << "\"hexes\":[";
    for (size_t i = 0; i < state.hexes.size(); i++) {
        if (i > 0) json << ",";
        const auto& h = state.hexes[i];
        json << "{\"q\":" << h.q << ",\"r\":" << h.r;
        json << ",\"type\":\"" << hexTypeToString(h.type) << "\"";
        json << ",\"numberToken\":" << h.numberToken;
        json << ",\"hasRobber\":" << (h.hasRobber ? "true" : "false");
        json << "}";
    }
    json << "],";
    
    // Board - buildings
    json << "\"buildings\":[";
    for (size_t i = 0; i < state.buildings.size(); i++) {
        if (i > 0) json << ",";
        const auto& b = state.buildings[i];
        json << "{\"hexQ\":" << b.hexQ << ",\"hexR\":" << b.hexR;
        json << ",\"direction\":" << b.direction;
        json << ",\"building\":\"" << buildingToString(b.building) << "\"";
        json << ",\"ownerPlayerId\":" << b.ownerPlayerId;
        json << "}";
    }
    json << "],";
    
    // Board - roads
    json << "\"roads\":[";
    for (size_t i = 0; i < state.roads.size(); i++) {
        if (i > 0) json << ",";
        const auto& r = state.roads[i];
        json << "{\"hexQ\":" << r.hexQ << ",\"hexR\":" << r.hexR;
        json << ",\"direction\":" << r.direction;
        json << ",\"ownerPlayerId\":" << r.ownerPlayerId;
        json << "}";
    }
    json << "],";
    
    // Available tools
    json << "\"availableTools\":[";
    for (size_t i = 0; i < state.availableTools.size(); i++) {
        if (i > 0) json << ",";
        json << "\"" << state.availableTools[i] << "\"";
    }
    json << "]";
    
    json << "}";
    
    return json.str();
}

// ============================================================================
// AI TURN PROCESSOR
// ============================================================================

AITurnProcessor::AITurnProcessor(Game* game, int playerId) 
    : game(game), playerId(playerId) {}

bool AITurnProcessor::isMyTurn() const {
    return game && game->currentPlayerIndex == playerId;
}

AIGameState AITurnProcessor::getCurrentState() const {
    if (!game) {
        return AIGameState{};
    }
    return getAIGameState(*game, playerId);
}

std::vector<std::string> AITurnProcessor::getAvailableTools() const {
    return getCurrentState().availableTools;
}

ToolResult AITurnProcessor::executeTool(const ToolCall& call) {
    ToolResult result;
    result.success = false;
    
    if (!game) {
        result.message = "No game context";
        return result;
    }
    
    Player* player = game->getPlayerById(playerId);
    if (!player) {
        result.message = "Player not found";
        return result;
    }
    
    // The actual tool execution would be implemented here
    // For now, return a placeholder that indicates the tool would be called
    result.message = "Tool '" + call.toolName + "' execution delegated to server";
    result.data = call.arguments;
    
    return result;
}

// ============================================================================
// AI PLAYER MANAGER
// ============================================================================

AIPlayerManager::AIPlayerManager(Game* game) : game(game) {}

bool AIPlayerManager::isCurrentPlayerAI() const {
    if (!game || game->players.empty()) {
        return false;
    }
    
    if (game->currentPlayerIndex < 0 || 
        game->currentPlayerIndex >= (int)game->players.size()) {
        return false;
    }
    
    return game->players[game->currentPlayerIndex].isAI();
}

std::vector<int> AIPlayerManager::getAIPlayerIds() const {
    std::vector<int> ids;
    if (!game) return ids;
    
    for (const auto& player : game->players) {
        if (player.isAI()) {
            ids.push_back(player.id);
        }
    }
    return ids;
}

int AIPlayerManager::getNextHumanPlayerIndex() const {
    if (!game || game->players.empty()) return -1;
    
    int startIndex = game->currentPlayerIndex;
    int numPlayers = game->players.size();
    
    for (int i = 0; i < numPlayers; i++) {
        int index = (startIndex + i) % numPlayers;
        if (game->players[index].isHuman()) {
            return index;
        }
    }
    
    return -1;  // No human players
}

int AIPlayerManager::humanPlayerCount() const {
    if (!game) return 0;
    
    int count = 0;
    for (const auto& player : game->players) {
        if (player.isHuman()) count++;
    }
    return count;
}

int AIPlayerManager::aiPlayerCount() const {
    if (!game) return 0;
    
    int count = 0;
    for (const auto& player : game->players) {
        if (player.isAI()) count++;
    }
    return count;
}

// ============================================================================
// AI TURN EXECUTOR - Server-side AI turn processing
// ============================================================================

AITurnExecutor::AITurnExecutor(Game* game, const std::string& gameId, LLMConfigManager& llmConfig)
    : game(game), gameId(gameId), llmConfig(llmConfig) {}

AITurnExecutor::~AITurnExecutor() {
    stopProcessing();
}

std::string AITurnExecutor::buildSystemPrompt() const {
    return 
        "You are playing a game of Catan. You are an AI player competing against other players. "
        "Your goal is to win by being the first to reach 10 victory points. "
        "Victory points come from: settlements (1 VP), cities (2 VP), longest road (2 VP), "
        "largest army (2 VP), and victory point development cards (1 VP each). "
        "\n\n"
        "On your turn, you should:\n"
        "1. If in 'rolling' phase: Roll the dice using roll_dice\n"
        "2. If in 'robber' phase: Move the robber using move_robber\n"
        "3. If in 'main_turn' phase: Build, trade, or play development cards, then end your turn\n"
        "\n"
        "Resource costs:\n"
        "- Road: 1 wood + 1 brick\n"
        "- Settlement: 1 wood + 1 brick + 1 wheat + 1 sheep\n"
        "- City (upgrade): 2 wheat + 3 ore\n"
        "- Development card: 1 wheat + 1 sheep + 1 ore\n"
        "\n"
        "Always use one of the available tools. Look at 'availableTools' to see what you can do. "
        "When your turn is complete (in main_turn phase), use end_turn.";
}

std::string AITurnExecutor::buildUserMessage(const AIGameState& state) const {
    return "Current game state:\n" + aiGameStateToJson(state) + 
           "\n\nIt's your turn. Choose an action from availableTools.";
}

std::vector<LLMTool> AITurnExecutor::buildToolList() const {
    std::vector<LLMTool> tools;
    auto defs = getToolDefinitions();
    for (const auto& def : defs) {
        LLMTool tool;
        tool.name = def.name;
        tool.description = def.description;
        tool.parametersSchema = def.parametersSchema;
        tools.push_back(tool);
    }
    return tools;
}

// Simple JSON int parser
static int parseJsonInt(const std::string& json, const std::string& key, int defaultValue = 0) {
    std::string searchKey = "\"" + key + "\":";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) return defaultValue;
    pos += searchKey.length();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
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

static std::string parseJsonStr(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\":\"";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) return "";
    pos += searchKey.length();
    size_t endPos = json.find("\"", pos);
    if (endPos == std::string::npos) return "";
    return json.substr(pos, endPos - pos);
}

ToolResult AITurnExecutor::executeToolCall(const LLMToolCall& toolCall, int playerId) {
    ToolResult result;
    result.success = false;
    
    if (!game) {
        result.message = "No game context";
        return result;
    }
    
    Player* player = game->getPlayerById(playerId);
    if (!player) {
        result.message = "Player not found";
        return result;
    }
    
    const std::string& tool = toolCall.toolName;
    const std::string& args = toolCall.arguments;
    
    // Building costs
    static const ResourceHand ROAD_COST = {1, 1, 0, 0, 0};
    static const ResourceHand SETTLEMENT_COST = {1, 1, 1, 1, 0};
    static const ResourceHand CITY_COST = {0, 0, 2, 0, 3};
    static const ResourceHand DEV_CARD_COST = {0, 0, 1, 1, 1};
    
    auto canAfford = [](const ResourceHand& have, const ResourceHand& cost) {
        return have.wood >= cost.wood && have.brick >= cost.brick &&
               have.wheat >= cost.wheat && have.sheep >= cost.sheep &&
               have.ore >= cost.ore;
    };
    
    auto subtractResources = [](ResourceHand& from, const ResourceHand& cost) {
        from.wood -= cost.wood;
        from.brick -= cost.brick;
        from.wheat -= cost.wheat;
        from.sheep -= cost.sheep;
        from.ore -= cost.ore;
    };
    
    if (tool == "roll_dice") {
        if (game->phase != GamePhase::Rolling) {
            result.message = "Cannot roll now";
            return result;
        }
        
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<> die(1, 6);
        
        DiceRoll roll;
        roll.die1 = die(gen);
        roll.die2 = die(gen);
        game->lastRoll = roll;
        
        if (roll.total() == 7) {
            game->phase = GamePhase::Robber;
            result.message = "Rolled " + std::to_string(roll.total()) + " - must move robber";
        } else {
            // Distribute resources
            for (const auto& [coord, hex] : game->board.hexes) {
                if (hex.numberToken == roll.total() && !hex.hasRobber) {
                    Resource resource = hexTypeToResource(hex.type);
                    if (resource == Resource::None) continue;
                    
                    for (int dir = 0; dir < 6; dir++) {
                        VertexCoord vc{coord, dir};
                        auto it = game->board.vertices.find(vc);
                        if (it != game->board.vertices.end() && it->second.ownerPlayerId >= 0) {
                            Player* owner = game->getPlayerById(it->second.ownerPlayerId);
                            if (owner) {
                                int amount = (it->second.building == Building::City) ? 2 : 1;
                                owner->resources[resource] += amount;
                            }
                        }
                    }
                }
            }
            game->phase = GamePhase::MainTurn;
            result.message = "Rolled " + std::to_string(roll.total());
        }
        result.success = true;
        result.data = "{\"die1\":" + std::to_string(roll.die1) + 
                      ",\"die2\":" + std::to_string(roll.die2) + 
                      ",\"total\":" + std::to_string(roll.total()) + "}";
    }
    else if (tool == "end_turn") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot end turn in this phase";
            return result;
        }
        
        game->currentPlayerIndex = (game->currentPlayerIndex + 1) % game->players.size();
        game->phase = GamePhase::Rolling;
        game->devCardPlayedThisTurn = false;
        
        result.success = true;
        result.message = "Turn ended";
        result.data = "{\"nextPlayer\":" + std::to_string(game->currentPlayerIndex) + "}";
    }
    else if (tool == "build_road") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot build in this phase";
            return result;
        }
        if (!canAfford(player->resources, ROAD_COST)) {
            result.message = "Not enough resources";
            return result;
        }
        if (player->roadsRemaining <= 0) {
            result.message = "No roads remaining";
            return result;
        }
        
        int hexQ = parseJsonInt(args, "hexQ", 0);
        int hexR = parseJsonInt(args, "hexR", 0);
        int direction = parseJsonInt(args, "direction", 0);
        
        subtractResources(player->resources, ROAD_COST);
        player->roadsRemaining--;
        
        EdgeCoord coord{{hexQ, hexR}, direction};
        auto it = game->board.edges.find(coord);
        if (it != game->board.edges.end()) {
            it->second.hasRoad = true;
            it->second.ownerPlayerId = player->id;
        }
        
        result.success = true;
        result.message = "Built road";
    }
    else if (tool == "build_settlement") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot build in this phase";
            return result;
        }
        if (!canAfford(player->resources, SETTLEMENT_COST)) {
            result.message = "Not enough resources";
            return result;
        }
        if (player->settlementsRemaining <= 0) {
            result.message = "No settlements remaining";
            return result;
        }
        
        int hexQ = parseJsonInt(args, "hexQ", 0);
        int hexR = parseJsonInt(args, "hexR", 0);
        int direction = parseJsonInt(args, "direction", 0);
        
        subtractResources(player->resources, SETTLEMENT_COST);
        player->settlementsRemaining--;
        
        VertexCoord coord{{hexQ, hexR}, direction};
        auto it = game->board.vertices.find(coord);
        if (it != game->board.vertices.end()) {
            it->second.building = Building::Settlement;
            it->second.ownerPlayerId = player->id;
        }
        
        result.success = true;
        result.message = "Built settlement";
    }
    else if (tool == "build_city") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot build in this phase";
            return result;
        }
        if (!canAfford(player->resources, CITY_COST)) {
            result.message = "Not enough resources";
            return result;
        }
        if (player->citiesRemaining <= 0) {
            result.message = "No cities remaining";
            return result;
        }
        
        int hexQ = parseJsonInt(args, "hexQ", 0);
        int hexR = parseJsonInt(args, "hexR", 0);
        int direction = parseJsonInt(args, "direction", 0);
        
        VertexCoord coord{{hexQ, hexR}, direction};
        auto it = game->board.vertices.find(coord);
        if (it == game->board.vertices.end() || 
            it->second.building != Building::Settlement ||
            it->second.ownerPlayerId != player->id) {
            result.message = "No settlement to upgrade";
            return result;
        }
        
        subtractResources(player->resources, CITY_COST);
        player->citiesRemaining--;
        player->settlementsRemaining++;
        it->second.building = Building::City;
        
        result.success = true;
        result.message = "Upgraded to city";
    }
    else if (tool == "buy_dev_card") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot buy in this phase";
            return result;
        }
        if (!canAfford(player->resources, DEV_CARD_COST)) {
            result.message = "Not enough resources";
            return result;
        }
        if (game->devCardDeck.empty()) {
            result.message = "No dev cards remaining";
            return result;
        }
        
        subtractResources(player->resources, DEV_CARD_COST);
        
        DevCardType card = game->devCardDeck.back();
        game->devCardDeck.pop_back();
        player->devCards.push_back(card);
        
        std::string cardName;
        switch (card) {
            case DevCardType::Knight: cardName = "knight"; break;
            case DevCardType::VictoryPoint: cardName = "victory_point"; break;
            case DevCardType::RoadBuilding: cardName = "road_building"; break;
            case DevCardType::YearOfPlenty: cardName = "year_of_plenty"; break;
            case DevCardType::Monopoly: cardName = "monopoly"; break;
        }
        
        result.success = true;
        result.message = "Bought " + cardName;
        result.data = "{\"card\":\"" + cardName + "\"}";
    }
    else if (tool == "bank_trade") {
        if (game->phase != GamePhase::MainTurn) {
            result.message = "Cannot trade in this phase";
            return result;
        }
        
        std::string giveStr = parseJsonStr(args, "give");
        std::string receiveStr = parseJsonStr(args, "receive");
        
        auto stringToResource = [](const std::string& name) -> Resource {
            if (name == "wood") return Resource::Wood;
            if (name == "brick") return Resource::Brick;
            if (name == "wheat") return Resource::Wheat;
            if (name == "sheep") return Resource::Sheep;
            if (name == "ore") return Resource::Ore;
            return Resource::None;
        };
        
        Resource give = stringToResource(giveStr);
        Resource receive = stringToResource(receiveStr);
        
        if (give == Resource::None || receive == Resource::None) {
            result.message = "Invalid resources";
            return result;
        }
        
        int ratio = 4;
        if (player->resources[give] < ratio) {
            result.message = "Not enough resources";
            return result;
        }
        
        player->resources[give] -= ratio;
        player->resources[receive] += 1;
        
        result.success = true;
        result.message = "Traded " + giveStr + " for " + receiveStr;
    }
    else if (tool == "move_robber") {
        if (game->phase != GamePhase::Robber) {
            result.message = "Not in robber phase";
            return result;
        }
        
        int hexQ = parseJsonInt(args, "hexQ", 0);
        int hexR = parseJsonInt(args, "hexR", 0);
        int stealFrom = parseJsonInt(args, "stealFromPlayerId", -1);
        
        // Move robber
        HexCoord oldLoc = game->board.robberLocation;
        HexCoord newLoc{hexQ, hexR};
        
        auto oldIt = game->board.hexes.find(oldLoc);
        if (oldIt != game->board.hexes.end()) {
            oldIt->second.hasRobber = false;
        }
        
        auto newIt = game->board.hexes.find(newLoc);
        if (newIt != game->board.hexes.end()) {
            newIt->second.hasRobber = true;
        }
        game->board.robberLocation = newLoc;
        
        // Steal from player
        std::string stolenResource = "none";
        if (stealFrom >= 0 && stealFrom < (int)game->players.size() && stealFrom != playerId) {
            Player* victim = &game->players[stealFrom];
            if (victim->resources.total() > 0) {
                std::vector<Resource> available;
                if (victim->resources.wood > 0) available.push_back(Resource::Wood);
                if (victim->resources.brick > 0) available.push_back(Resource::Brick);
                if (victim->resources.wheat > 0) available.push_back(Resource::Wheat);
                if (victim->resources.sheep > 0) available.push_back(Resource::Sheep);
                if (victim->resources.ore > 0) available.push_back(Resource::Ore);
                
                if (!available.empty()) {
                    static std::random_device rd;
                    static std::mt19937 gen(rd());
                    std::uniform_int_distribution<> dis(0, available.size() - 1);
                    Resource stolen = available[dis(gen)];
                    victim->resources[stolen]--;
                    player->resources[stolen]++;
                    stolenResource = resourceToString(stolen);
                }
            }
        }
        
        game->phase = GamePhase::MainTurn;
        
        result.success = true;
        result.message = "Moved robber" + (stolenResource != "none" ? ", stole " + stolenResource : "");
    }
    else {
        result.message = "Unknown tool: " + tool;
    }
    
    return result;
}

std::string AITurnExecutor::describeAction(const std::string& toolName, const ToolResult& result) const {
    if (toolName == "roll_dice") {
        return "Rolled dice: " + result.message;
    } else if (toolName == "end_turn") {
        return "Ended turn";
    } else if (toolName == "build_road") {
        return "Built a road";
    } else if (toolName == "build_settlement") {
        return "Built a settlement";
    } else if (toolName == "build_city") {
        return "Upgraded to city";
    } else if (toolName == "buy_dev_card") {
        return "Bought development card";
    } else if (toolName == "bank_trade") {
        return result.message;
    } else if (toolName == "move_robber") {
        return result.message;
    }
    return toolName + ": " + result.message;
}

bool AITurnExecutor::startProcessing() {
    if (status.load() == Status::Processing) {
        return false;  // Already processing
    }
    
    if (!hasAIPendingTurns()) {
        return false;  // No AI turns to process
    }
    
    shouldStop = false;
    status = Status::Processing;
    
    // Start processing thread
    if (processingThread.joinable()) {
        processingThread.join();
    }
    
    processingThread = std::thread([this]() {
        processAITurns();
    });
    
    return true;
}

void AITurnExecutor::stopProcessing() {
    shouldStop = true;
    if (processingThread.joinable()) {
        processingThread.join();
    }
    status = Status::Idle;
}

std::vector<AIActionLogEntry> AITurnExecutor::getActionLog(size_t maxEntries) const {
    std::lock_guard<std::mutex> lock(mutex);
    if (actionLog.size() <= maxEntries) {
        return actionLog;
    }
    return std::vector<AIActionLogEntry>(
        actionLog.end() - maxEntries, 
        actionLog.end()
    );
}

void AITurnExecutor::clearActionLog() {
    std::lock_guard<std::mutex> lock(mutex);
    actionLog.clear();
}

bool AITurnExecutor::hasAIPendingTurns() const {
    if (!game || game->players.empty()) return false;
    if (game->phase == GamePhase::WaitingForPlayers || 
        game->phase == GamePhase::Finished) return false;
    
    if (game->currentPlayerIndex < 0 || 
        game->currentPlayerIndex >= (int)game->players.size()) return false;
    
    return game->players[game->currentPlayerIndex].isAI();
}

std::string AITurnExecutor::statusToJson() const {
    std::lock_guard<std::mutex> lock(mutex);
    
    std::ostringstream json;
    json << "{";
    json << "\"status\":\"";
    switch (status.load()) {
        case Status::Idle: json << "idle"; break;
        case Status::Processing: json << "processing"; break;
        case Status::Completed: json << "completed"; break;
        case Status::Error: json << "error"; break;
    }
    json << "\",";
    json << "\"currentAIPlayerId\":" << currentAIPlayerId << ",";
    
    if (!lastError.empty()) {
        json << "\"error\":\"" << lastError << "\",";
    }
    
    json << "\"hasAIPendingTurns\":" << (hasAIPendingTurns() ? "true" : "false") << ",";
    json << "\"llmProvider\":\"" << llmConfig.getConfig().provider << "\",";
    
    // Recent actions
    json << "\"recentActions\":[";
    size_t startIdx = actionLog.size() > 10 ? actionLog.size() - 10 : 0;
    for (size_t i = startIdx; i < actionLog.size(); i++) {
        if (i > startIdx) json << ",";
        const auto& entry = actionLog[i];
        json << "{";
        json << "\"playerId\":" << entry.playerId << ",";
        json << "\"playerName\":\"" << entry.playerName << "\",";
        json << "\"action\":\"" << entry.action << "\",";
        json << "\"description\":\"" << entry.description << "\",";
        json << "\"success\":" << (entry.success ? "true" : "false");
        if (!entry.error.empty()) {
            json << ",\"error\":\"" << entry.error << "\"";
        }
        json << "}";
    }
    json << "]";
    
    json << "}";
    return json.str();
}

void AITurnExecutor::processAITurns() {
    while (!shouldStop && hasAIPendingTurns()) {
        int playerId = game->currentPlayerIndex;
        currentAIPlayerId = playerId;
        
        // Broadcast AI thinking event
        if (playerId >= 0 && playerId < (int)game->players.size()) {
            SSEEvent thinkingEvent;
            thinkingEvent.event = GameEvents::AI_THINKING;
            thinkingEvent.data = "{\"playerId\":" + std::to_string(playerId) + 
                                ",\"playerName\":\"" + game->players[playerId].name + "\"}";
            thinkingEvent.id = sseManager.nextEventId();
            sseManager.broadcastToGame(gameId, thinkingEvent);
        }
        
        if (!processSingleAITurn(playerId)) {
            // Error occurred - broadcast error event
            SSEEvent errorEvent;
            errorEvent.event = GameEvents::AI_ERROR;
            errorEvent.data = "{\"error\":\"" + lastError + "\"}";
            errorEvent.id = sseManager.nextEventId();
            sseManager.broadcastToGame(gameId, errorEvent);
            
            status = Status::Error;
            return;
        }
        
        // Small delay between turns for rate limiting
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    currentAIPlayerId = -1;
    status = Status::Completed;
    
    // Broadcast AI turns complete event
    SSEEvent completeEvent;
    completeEvent.event = GameEvents::AI_TURN_COMPLETE;
    completeEvent.data = "{\"message\":\"All AI turns completed\"}";
    completeEvent.id = sseManager.nextEventId();
    sseManager.broadcastToGame(gameId, completeEvent);
}

bool AITurnExecutor::processSingleAITurn(int playerId) {
    if (!game) return false;
    
    Player* player = game->getPlayerById(playerId);
    if (!player || !player->isAI()) return false;
    
    LLMProvider* llm = llmConfig.getProvider();
    if (!llm) {
        lastError = "No LLM provider configured";
        return false;
    }
    
    std::string systemPrompt = buildSystemPrompt();
    std::vector<LLMTool> tools = buildToolList();
    std::vector<LLMMessage> messages;
    
    int maxActions = 20;  // Safety limit
    int actionCount = 0;
    
    while (actionCount < maxActions && !shouldStop) {
        actionCount++;
        
        // Check if still this AI's turn
        if (game->currentPlayerIndex != playerId) {
            break;  // Turn has ended
        }
        
        // Get current state and build message
        std::lock_guard<std::mutex> lock(game->mutex);
        AIGameState state = getAIGameState(*game, playerId);
        
        if (!state.isMyTurn) {
            break;  // Not our turn anymore
        }
        
        // Build user message with current state
        LLMMessage userMsg;
        userMsg.role = LLMMessage::Role::User;
        userMsg.content = buildUserMessage(state);
        messages.push_back(userMsg);
        
        // Call LLM
        LLMResponse llmResponse = llm->chat(messages, tools, systemPrompt);
        
        if (!llmResponse.success) {
            lastError = "LLM call failed: " + llmResponse.error;
            
            AIActionLogEntry logEntry;
            logEntry.playerId = playerId;
            logEntry.playerName = player->name;
            logEntry.action = "llm_error";
            logEntry.description = lastError;
            logEntry.success = false;
            logEntry.error = llmResponse.error;
            logEntry.timestamp = std::chrono::steady_clock::now();
            
            {
                std::lock_guard<std::mutex> logLock(mutex);
                actionLog.push_back(logEntry);
            }
            
            // Fall back to mock behavior
            llmResponse.toolCall = LLMToolCall{"end_turn", "{}"};
            llmResponse.success = true;
        }
        
        if (!llmResponse.toolCall) {
            // No tool call, LLM gave text response - try to continue
            LLMMessage assistantMsg;
            assistantMsg.role = LLMMessage::Role::Assistant;
            assistantMsg.content = llmResponse.textContent;
            messages.push_back(assistantMsg);
            continue;
        }
        
        // Execute the tool
        ToolResult result = executeToolCall(*llmResponse.toolCall, playerId);
        
        // Log the action
        AIActionLogEntry logEntry;
        logEntry.playerId = playerId;
        logEntry.playerName = player->name;
        logEntry.action = llmResponse.toolCall->toolName;
        logEntry.description = describeAction(llmResponse.toolCall->toolName, result);
        logEntry.success = result.success;
        logEntry.error = result.success ? "" : result.message;
        logEntry.timestamp = std::chrono::steady_clock::now();
        
        {
            std::lock_guard<std::mutex> logLock(mutex);
            actionLog.push_back(logEntry);
        }
        
        // Broadcast SSE event
        SSEEvent sseEvent = GameEvents::createAIActionEvent(
            playerId, player->name, 
            logEntry.action, logEntry.description, 
            result.success
        );
        sseManager.broadcastToGame(gameId, sseEvent);
        
        // Add assistant message with tool call
        LLMMessage assistantMsg;
        assistantMsg.role = LLMMessage::Role::Assistant;
        assistantMsg.toolCall = *llmResponse.toolCall;
        messages.push_back(assistantMsg);
        
        // Add tool result message
        LLMMessage toolResultMsg;
        toolResultMsg.role = LLMMessage::Role::ToolResult;
        toolResultMsg.content = result.success ? 
            ("Success: " + result.message) : 
            ("Error: " + result.message);
        messages.push_back(toolResultMsg);
        
        // Check if turn ended
        if (llmResponse.toolCall->toolName == "end_turn" && result.success) {
            break;
        }
        
        // Small delay between actions
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    
    return true;
}

}  // namespace ai
}  // namespace catan
