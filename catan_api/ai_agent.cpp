#include "ai_agent.h"
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

}  // namespace ai
}  // namespace catan
