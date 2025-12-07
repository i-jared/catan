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
        },
        // ============ CHAT AND SOCIAL TOOLS ============
        {
            "send_chat",
            "Send a chat message to another player or to everyone. Use this to communicate, strategize, ask questions, or socialize with other players. Be friendly and engaging!",
            "{\"type\":\"object\",\"properties\":{\"toPlayerId\":{\"type\":\"integer\",\"description\":\"Player ID to send to, or -1 for public message to all players\"},\"message\":{\"type\":\"string\",\"description\":\"The message content\"}},\"required\":[\"toPlayerId\",\"message\"]}"
        },
        {
            "propose_trade",
            "Propose a trade with another player or open to all. Creates an official trade offer that others can accept, reject, or counter.",
            "{\"type\":\"object\",\"properties\":{\"toPlayerId\":{\"type\":\"integer\",\"description\":\"Player ID to propose to, or -1 for open trade to all\"},\"giveWood\":{\"type\":\"integer\",\"minimum\":0},\"giveBrick\":{\"type\":\"integer\",\"minimum\":0},\"giveWheat\":{\"type\":\"integer\",\"minimum\":0},\"giveSheep\":{\"type\":\"integer\",\"minimum\":0},\"giveOre\":{\"type\":\"integer\",\"minimum\":0},\"wantWood\":{\"type\":\"integer\",\"minimum\":0},\"wantBrick\":{\"type\":\"integer\",\"minimum\":0},\"wantWheat\":{\"type\":\"integer\",\"minimum\":0},\"wantSheep\":{\"type\":\"integer\",\"minimum\":0},\"wantOre\":{\"type\":\"integer\",\"minimum\":0},\"message\":{\"type\":\"string\",\"description\":\"Optional message to accompany the trade proposal\"}},\"required\":[\"toPlayerId\",\"giveWood\",\"giveBrick\",\"giveWheat\",\"giveSheep\",\"giveOre\",\"wantWood\",\"wantBrick\",\"wantWheat\",\"wantSheep\",\"wantOre\"]}"
        },
        {
            "accept_trade",
            "Accept a pending trade offer. The trade will be executed if you have the required resources.",
            "{\"type\":\"object\",\"properties\":{\"tradeId\":{\"type\":\"integer\",\"description\":\"The ID of the trade offer to accept\"}},\"required\":[\"tradeId\"]}"
        },
        {
            "reject_trade",
            "Reject a pending trade offer.",
            "{\"type\":\"object\",\"properties\":{\"tradeId\":{\"type\":\"integer\",\"description\":\"The ID of the trade offer to reject\"}},\"required\":[\"tradeId\"]}"
        },
        {
            "counter_trade",
            "Make a counter-offer to an existing trade proposal.",
            "{\"type\":\"object\",\"properties\":{\"originalTradeId\":{\"type\":\"integer\",\"description\":\"The ID of the original trade offer\"},\"giveWood\":{\"type\":\"integer\",\"minimum\":0},\"giveBrick\":{\"type\":\"integer\",\"minimum\":0},\"giveWheat\":{\"type\":\"integer\",\"minimum\":0},\"giveSheep\":{\"type\":\"integer\",\"minimum\":0},\"giveOre\":{\"type\":\"integer\",\"minimum\":0},\"wantWood\":{\"type\":\"integer\",\"minimum\":0},\"wantBrick\":{\"type\":\"integer\",\"minimum\":0},\"wantWheat\":{\"type\":\"integer\",\"minimum\":0},\"wantSheep\":{\"type\":\"integer\",\"minimum\":0},\"wantOre\":{\"type\":\"integer\",\"minimum\":0},\"message\":{\"type\":\"string\",\"description\":\"Message explaining the counter-offer\"}},\"required\":[\"originalTradeId\",\"giveWood\",\"giveBrick\",\"giveWheat\",\"giveSheep\",\"giveOre\",\"wantWood\",\"wantBrick\",\"wantWheat\",\"wantSheep\",\"wantOre\"]}"
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
                
                // Player trading - always available during main turn
                if (player->resources.total() > 0) {
                    state.availableTools.push_back("propose_trade");
                }
                
                // Can always end turn
                state.availableTools.push_back("end_turn");
                break;
                
            default:
                break;
        }
    }
    
    // Chat is always available (even when not your turn)
    state.availableTools.push_back("send_chat");
    
    // Check for active trades that this player can respond to
    for (const auto& trade : game.tradeOffers) {
        if (trade.isActive && trade.fromPlayerId != playerId) {
            // Can respond if trade is open or directed to this player
            if (trade.toPlayerId == -1 || trade.toPlayerId == playerId) {
                // Check if hasn't already responded
                bool alreadyAccepted = std::find(trade.acceptedByPlayerIds.begin(), 
                    trade.acceptedByPlayerIds.end(), playerId) != trade.acceptedByPlayerIds.end();
                bool alreadyRejected = std::find(trade.rejectedByPlayerIds.begin(), 
                    trade.rejectedByPlayerIds.end(), playerId) != trade.rejectedByPlayerIds.end();
                
                if (!alreadyAccepted && !alreadyRejected) {
                    // Add tools if not already present
                    if (std::find(state.availableTools.begin(), state.availableTools.end(), "accept_trade") == state.availableTools.end()) {
                        state.availableTools.push_back("accept_trade");
                        state.availableTools.push_back("reject_trade");
                        state.availableTools.push_back("counter_trade");
                    }
                }
            }
        }
    }
    
    // Add recent chat messages (last 20)
    auto chatMessageTypeToString = [](ChatMessageType type) -> std::string {
        switch (type) {
            case ChatMessageType::Normal: return "normal";
            case ChatMessageType::TradeProposal: return "trade_proposal";
            case ChatMessageType::TradeAccept: return "trade_accept";
            case ChatMessageType::TradeReject: return "trade_reject";
            case ChatMessageType::TradeCounter: return "trade_counter";
            case ChatMessageType::System: return "system";
            default: return "unknown";
        }
    };
    
    size_t chatStart = game.chatMessages.size() > 20 ? game.chatMessages.size() - 20 : 0;
    for (size_t i = chatStart; i < game.chatMessages.size(); i++) {
        const auto& msg = game.chatMessages[i];
        // Include public messages or messages to/from this player
        if (msg.toPlayerId == -1 || msg.toPlayerId == playerId || msg.fromPlayerId == playerId) {
            AIGameState::ChatMessageInfo info;
            info.id = msg.id;
            info.fromPlayerId = msg.fromPlayerId;
            if (msg.fromPlayerId >= 0 && msg.fromPlayerId < (int)game.players.size()) {
                info.fromPlayerName = game.players[msg.fromPlayerId].name;
            } else {
                info.fromPlayerName = "System";
            }
            info.toPlayerId = msg.toPlayerId;
            info.content = msg.content;
            info.type = chatMessageTypeToString(msg.type);
            info.relatedTradeId = msg.relatedTradeId;
            state.recentChatMessages.push_back(info);
        }
    }
    
    // Add active trade offers
    for (const auto& trade : game.tradeOffers) {
        if (trade.isActive) {
            // Include if it's visible to this player
            if (trade.toPlayerId == -1 || trade.toPlayerId == playerId || trade.fromPlayerId == playerId) {
                AIGameState::TradeOfferInfo info;
                info.tradeId = trade.id;
                info.fromPlayerId = trade.fromPlayerId;
                if (trade.fromPlayerId >= 0 && trade.fromPlayerId < (int)game.players.size()) {
                    info.fromPlayerName = game.players[trade.fromPlayerId].name;
                }
                info.toPlayerId = trade.toPlayerId;
                info.offeringWood = trade.offering.wood;
                info.offeringBrick = trade.offering.brick;
                info.offeringWheat = trade.offering.wheat;
                info.offeringSheep = trade.offering.sheep;
                info.offeringOre = trade.offering.ore;
                info.requestingWood = trade.requesting.wood;
                info.requestingBrick = trade.requesting.brick;
                info.requestingWheat = trade.requesting.wheat;
                info.requestingSheep = trade.requesting.sheep;
                info.requestingOre = trade.requesting.ore;
                info.isActive = trade.isActive;
                info.acceptedBy = trade.acceptedByPlayerIds;
                info.rejectedBy = trade.rejectedByPlayerIds;
                state.activeTrades.push_back(info);
            }
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
    json << "],";
    
    // Recent chat messages
    json << "\"recentChatMessages\":[";
    for (size_t i = 0; i < state.recentChatMessages.size(); i++) {
        if (i > 0) json << ",";
        const auto& msg = state.recentChatMessages[i];
        json << "{\"id\":\"" << msg.id << "\"";
        json << ",\"fromPlayerId\":" << msg.fromPlayerId;
        json << ",\"fromPlayerName\":\"" << msg.fromPlayerName << "\"";
        json << ",\"toPlayerId\":" << msg.toPlayerId;
        // Escape special characters in content
        std::string escapedContent;
        for (char c : msg.content) {
            if (c == '"') escapedContent += "\\\"";
            else if (c == '\\') escapedContent += "\\\\";
            else if (c == '\n') escapedContent += "\\n";
            else if (c == '\r') escapedContent += "\\r";
            else if (c == '\t') escapedContent += "\\t";
            else escapedContent += c;
        }
        json << ",\"content\":\"" << escapedContent << "\"";
        json << ",\"type\":\"" << msg.type << "\"";
        json << ",\"relatedTradeId\":" << msg.relatedTradeId;
        json << "}";
    }
    json << "],";
    
    // Active trades
    json << "\"activeTrades\":[";
    for (size_t i = 0; i < state.activeTrades.size(); i++) {
        if (i > 0) json << ",";
        const auto& trade = state.activeTrades[i];
        json << "{\"tradeId\":" << trade.tradeId;
        json << ",\"fromPlayerId\":" << trade.fromPlayerId;
        json << ",\"fromPlayerName\":\"" << trade.fromPlayerName << "\"";
        json << ",\"toPlayerId\":" << trade.toPlayerId;
        json << ",\"offering\":{";
        json << "\"wood\":" << trade.offeringWood;
        json << ",\"brick\":" << trade.offeringBrick;
        json << ",\"wheat\":" << trade.offeringWheat;
        json << ",\"sheep\":" << trade.offeringSheep;
        json << ",\"ore\":" << trade.offeringOre << "}";
        json << ",\"requesting\":{";
        json << "\"wood\":" << trade.requestingWood;
        json << ",\"brick\":" << trade.requestingBrick;
        json << ",\"wheat\":" << trade.requestingWheat;
        json << ",\"sheep\":" << trade.requestingSheep;
        json << ",\"ore\":" << trade.requestingOre << "}";
        json << ",\"isActive\":" << (trade.isActive ? "true" : "false");
        json << ",\"acceptedBy\":[";
        for (size_t j = 0; j < trade.acceptedBy.size(); j++) {
            if (j > 0) json << ",";
            json << trade.acceptedBy[j];
        }
        json << "],\"rejectedBy\":[";
        for (size_t j = 0; j < trade.rejectedBy.size(); j++) {
            if (j > 0) json << ",";
            json << trade.rejectedBy[j];
        }
        json << "]}";
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
        "You are playing a game of Catan. You are an AI player competing against other players "
        "(both human and other AI players). Your goal is to win by being the first to reach 10 victory points. "
        "Victory points come from: settlements (1 VP), cities (2 VP), longest road (2 VP), "
        "largest army (2 VP), and victory point development cards (1 VP each).\n\n"
        
        "== SOCIAL INTERACTION ==\n"
        "You are encouraged to be SOCIAL and INTERACTIVE! This is a multiplayer game with chat.\n"
        "- Send chat messages to other players using send_chat (toPlayerId=-1 for public, or specific ID for private)\n"
        "- Comment on dice rolls, congratulate good plays, or express frustration at bad luck\n"
        "- Ask other players about potential trades before formally proposing\n"
        "- Respond to messages from other players in the recentChatMessages\n"
        "- Have a personality! Be friendly, competitive, strategic, or witty\n"
        "- If another player sends you a message, acknowledge it!\n\n"
        
        "== TRADING WITH PLAYERS ==\n"
        "Trading with other players is often more efficient than bank trades (4:1).\n"
        "- Use propose_trade to offer trades to specific players or openly to all (toPlayerId=-1)\n"
        "- Check activeTrades to see pending trade offers\n"
        "- Use accept_trade to accept a trade that benefits you\n"
        "- Use reject_trade to decline, or counter_trade to make a counter-offer\n"
        "- Negotiate in chat! Ask 'Anyone have wheat?' before proposing trades\n"
        "- Consider what resources others might need based on their visible buildings\n\n"
        
        "== YOUR TURN ==\n"
        "On your turn, you should:\n"
        "1. If in 'rolling' phase: Roll the dice using roll_dice\n"
        "2. If in 'robber' phase: Move the robber using move_robber\n"
        "3. If in 'main_turn' phase: Build, trade, chat, or play development cards, then end your turn\n\n"
        
        "== RESOURCE COSTS ==\n"
        "- Road: 1 wood + 1 brick\n"
        "- Settlement: 1 wood + 1 brick + 1 wheat + 1 sheep\n"
        "- City (upgrade): 2 wheat + 3 ore\n"
        "- Development card: 1 wheat + 1 sheep + 1 ore\n\n"
        
        "== IMPORTANT ==\n"
        "Always use one of the available tools. Look at 'availableTools' to see what you can do. "
        "When your turn is complete (in main_turn phase), use end_turn.\n"
        "BE SOCIAL! Send at least one chat message per turn to keep the game lively and fun!";
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
    else if (tool == "send_chat") {
        int toPlayerId = parseJsonInt(args, "toPlayerId", -1);
        std::string message = parseJsonStr(args, "message");
        
        if (message.empty()) {
            result.message = "Message cannot be empty";
            return result;
        }
        
        // Create chat message
        ChatMessage chatMsg;
        chatMsg.id = std::to_string(game->nextChatMessageId++);
        chatMsg.fromPlayerId = playerId;
        chatMsg.toPlayerId = toPlayerId;
        chatMsg.content = message;
        chatMsg.type = ChatMessageType::Normal;
        chatMsg.timestamp = std::chrono::steady_clock::now();
        
        game->chatMessages.push_back(chatMsg);
        
        // Broadcast SSE
        SSEEvent sseEvent = GameEvents::createChatMessageEvent(
            chatMsg.id, chatMsg.fromPlayerId, player->name,
            chatMsg.toPlayerId, chatMsg.content, "normal"
        );
        sseManager.broadcastToGame(gameId, sseEvent);
        
        result.success = true;
        result.message = "Message sent";
        result.data = "{\"messageId\":\"" + chatMsg.id + "\"}";
    }
    else if (tool == "propose_trade") {
        int toPlayerId = parseJsonInt(args, "toPlayerId", -1);
        std::string message = parseJsonStr(args, "message");
        
        ResourceHand offering;
        offering.wood = parseJsonInt(args, "giveWood", 0);
        offering.brick = parseJsonInt(args, "giveBrick", 0);
        offering.wheat = parseJsonInt(args, "giveWheat", 0);
        offering.sheep = parseJsonInt(args, "giveSheep", 0);
        offering.ore = parseJsonInt(args, "giveOre", 0);
        
        ResourceHand requesting;
        requesting.wood = parseJsonInt(args, "wantWood", 0);
        requesting.brick = parseJsonInt(args, "wantBrick", 0);
        requesting.wheat = parseJsonInt(args, "wantWheat", 0);
        requesting.sheep = parseJsonInt(args, "wantSheep", 0);
        requesting.ore = parseJsonInt(args, "wantOre", 0);
        
        // Validate
        if (player->resources.wood < offering.wood ||
            player->resources.brick < offering.brick ||
            player->resources.wheat < offering.wheat ||
            player->resources.sheep < offering.sheep ||
            player->resources.ore < offering.ore) {
            result.message = "Not enough resources to offer";
            return result;
        }
        
        // Create trade
        TradeOffer trade;
        trade.id = game->nextTradeId++;
        trade.fromPlayerId = playerId;
        trade.toPlayerId = toPlayerId;
        trade.offering = offering;
        trade.requesting = requesting;
        trade.isActive = true;
        
        // Create chat message
        ChatMessage chatMsg;
        chatMsg.id = std::to_string(game->nextChatMessageId++);
        chatMsg.fromPlayerId = playerId;
        chatMsg.toPlayerId = toPlayerId;
        chatMsg.type = ChatMessageType::TradeProposal;
        chatMsg.relatedTradeId = trade.id;
        chatMsg.timestamp = std::chrono::steady_clock::now();
        
        std::ostringstream desc;
        desc << "📦 Trade Proposal: ";
        if (!message.empty()) desc << message << " - ";
        desc << "Offering ";
        bool first = true;
        if (offering.wood > 0) { desc << offering.wood << " wood"; first = false; }
        if (offering.brick > 0) { desc << (first ? "" : ", ") << offering.brick << " brick"; first = false; }
        if (offering.wheat > 0) { desc << (first ? "" : ", ") << offering.wheat << " wheat"; first = false; }
        if (offering.sheep > 0) { desc << (first ? "" : ", ") << offering.sheep << " sheep"; first = false; }
        if (offering.ore > 0) { desc << (first ? "" : ", ") << offering.ore << " ore"; first = false; }
        desc << " for ";
        first = true;
        if (requesting.wood > 0) { desc << requesting.wood << " wood"; first = false; }
        if (requesting.brick > 0) { desc << (first ? "" : ", ") << requesting.brick << " brick"; first = false; }
        if (requesting.wheat > 0) { desc << (first ? "" : ", ") << requesting.wheat << " wheat"; first = false; }
        if (requesting.sheep > 0) { desc << (first ? "" : ", ") << requesting.sheep << " sheep"; first = false; }
        if (requesting.ore > 0) { desc << (first ? "" : ", ") << requesting.ore << " ore"; first = false; }
        chatMsg.content = desc.str();
        
        trade.chatMessageId = chatMsg.id;
        game->tradeOffers.push_back(trade);
        game->chatMessages.push_back(chatMsg);
        
        // Broadcast
        SSEEvent chatEvent = GameEvents::createChatMessageEvent(
            chatMsg.id, chatMsg.fromPlayerId, player->name,
            chatMsg.toPlayerId, chatMsg.content, "trade_proposal"
        );
        sseManager.broadcastToGame(gameId, chatEvent);
        
        SSEEvent tradeEvent = GameEvents::createTradeProposedEvent(
            trade.id, trade.fromPlayerId, player->name, trade.toPlayerId,
            offering.wood, offering.brick, offering.wheat, offering.sheep, offering.ore,
            requesting.wood, requesting.brick, requesting.wheat, requesting.sheep, requesting.ore,
            message
        );
        sseManager.broadcastToGame(gameId, tradeEvent);
        
        result.success = true;
        result.message = "Trade proposed";
        result.data = "{\"tradeId\":" + std::to_string(trade.id) + "}";
    }
    else if (tool == "accept_trade") {
        int tradeId = parseJsonInt(args, "tradeId", -1);
        
        TradeOffer* trade = nullptr;
        for (auto& t : game->tradeOffers) {
            if (t.id == tradeId) {
                trade = &t;
                break;
            }
        }
        
        if (!trade) {
            result.message = "Trade not found";
            return result;
        }
        
        if (!trade->isActive) {
            result.message = "Trade no longer active";
            return result;
        }
        
        if (trade->fromPlayerId == playerId) {
            result.message = "Cannot accept own trade";
            return result;
        }
        
        // Verify resources
        if (player->resources.wood < trade->requesting.wood ||
            player->resources.brick < trade->requesting.brick ||
            player->resources.wheat < trade->requesting.wheat ||
            player->resources.sheep < trade->requesting.sheep ||
            player->resources.ore < trade->requesting.ore) {
            result.message = "Not enough resources";
            return result;
        }
        
        Player* proposer = game->getPlayerById(trade->fromPlayerId);
        if (!proposer ||
            proposer->resources.wood < trade->offering.wood ||
            proposer->resources.brick < trade->offering.brick ||
            proposer->resources.wheat < trade->offering.wheat ||
            proposer->resources.sheep < trade->offering.sheep ||
            proposer->resources.ore < trade->offering.ore) {
            trade->isActive = false;
            result.message = "Proposer no longer has resources";
            return result;
        }
        
        // Execute trade
        proposer->resources.wood -= trade->offering.wood;
        proposer->resources.brick -= trade->offering.brick;
        proposer->resources.wheat -= trade->offering.wheat;
        proposer->resources.sheep -= trade->offering.sheep;
        proposer->resources.ore -= trade->offering.ore;
        
        player->resources.wood += trade->offering.wood;
        player->resources.brick += trade->offering.brick;
        player->resources.wheat += trade->offering.wheat;
        player->resources.sheep += trade->offering.sheep;
        player->resources.ore += trade->offering.ore;
        
        player->resources.wood -= trade->requesting.wood;
        player->resources.brick -= trade->requesting.brick;
        player->resources.wheat -= trade->requesting.wheat;
        player->resources.sheep -= trade->requesting.sheep;
        player->resources.ore -= trade->requesting.ore;
        
        proposer->resources.wood += trade->requesting.wood;
        proposer->resources.brick += trade->requesting.brick;
        proposer->resources.wheat += trade->requesting.wheat;
        proposer->resources.sheep += trade->requesting.sheep;
        proposer->resources.ore += trade->requesting.ore;
        
        trade->isActive = false;
        trade->acceptedByPlayerIds.push_back(playerId);
        
        // Chat message
        ChatMessage chatMsg;
        chatMsg.id = std::to_string(game->nextChatMessageId++);
        chatMsg.fromPlayerId = playerId;
        chatMsg.toPlayerId = -1;
        chatMsg.type = ChatMessageType::TradeAccept;
        chatMsg.relatedTradeId = trade->id;
        chatMsg.content = "✅ " + player->name + " accepted the trade with " + proposer->name + "!";
        chatMsg.timestamp = std::chrono::steady_clock::now();
        game->chatMessages.push_back(chatMsg);
        
        // Broadcast
        SSEEvent execEvent = GameEvents::createTradeExecutedEvent(
            trade->id, trade->fromPlayerId, proposer->name, playerId, player->name
        );
        sseManager.broadcastToGame(gameId, execEvent);
        
        SSEEvent chatEvent = GameEvents::createChatMessageEvent(
            chatMsg.id, chatMsg.fromPlayerId, player->name,
            chatMsg.toPlayerId, chatMsg.content, "trade_accept"
        );
        sseManager.broadcastToGame(gameId, chatEvent);
        
        result.success = true;
        result.message = "Trade executed";
    }
    else if (tool == "reject_trade") {
        int tradeId = parseJsonInt(args, "tradeId", -1);
        
        TradeOffer* trade = nullptr;
        for (auto& t : game->tradeOffers) {
            if (t.id == tradeId) {
                trade = &t;
                break;
            }
        }
        
        if (!trade) {
            result.message = "Trade not found";
            return result;
        }
        
        trade->rejectedByPlayerIds.push_back(playerId);
        
        // Chat message
        ChatMessage chatMsg;
        chatMsg.id = std::to_string(game->nextChatMessageId++);
        chatMsg.fromPlayerId = playerId;
        chatMsg.toPlayerId = -1;
        chatMsg.type = ChatMessageType::TradeReject;
        chatMsg.relatedTradeId = trade->id;
        chatMsg.content = "❌ " + player->name + " rejected the trade.";
        chatMsg.timestamp = std::chrono::steady_clock::now();
        game->chatMessages.push_back(chatMsg);
        
        SSEEvent chatEvent = GameEvents::createChatMessageEvent(
            chatMsg.id, chatMsg.fromPlayerId, player->name,
            chatMsg.toPlayerId, chatMsg.content, "trade_reject"
        );
        sseManager.broadcastToGame(gameId, chatEvent);
        
        result.success = true;
        result.message = "Trade rejected";
    }
    else if (tool == "counter_trade") {
        int originalTradeId = parseJsonInt(args, "originalTradeId", -1);
        std::string message = parseJsonStr(args, "message");
        
        TradeOffer* originalTrade = nullptr;
        for (auto& t : game->tradeOffers) {
            if (t.id == originalTradeId) {
                originalTrade = &t;
                break;
            }
        }
        
        if (!originalTrade) {
            result.message = "Original trade not found";
            return result;
        }
        
        ResourceHand offering;
        offering.wood = parseJsonInt(args, "giveWood", 0);
        offering.brick = parseJsonInt(args, "giveBrick", 0);
        offering.wheat = parseJsonInt(args, "giveWheat", 0);
        offering.sheep = parseJsonInt(args, "giveSheep", 0);
        offering.ore = parseJsonInt(args, "giveOre", 0);
        
        ResourceHand requesting;
        requesting.wood = parseJsonInt(args, "wantWood", 0);
        requesting.brick = parseJsonInt(args, "wantBrick", 0);
        requesting.wheat = parseJsonInt(args, "wantWheat", 0);
        requesting.sheep = parseJsonInt(args, "wantSheep", 0);
        requesting.ore = parseJsonInt(args, "wantOre", 0);
        
        if (player->resources.wood < offering.wood ||
            player->resources.brick < offering.brick ||
            player->resources.wheat < offering.wheat ||
            player->resources.sheep < offering.sheep ||
            player->resources.ore < offering.ore) {
            result.message = "Not enough resources";
            return result;
        }
        
        // Create counter trade
        TradeOffer counterTrade;
        counterTrade.id = game->nextTradeId++;
        counterTrade.fromPlayerId = playerId;
        counterTrade.toPlayerId = originalTrade->fromPlayerId;
        counterTrade.offering = offering;
        counterTrade.requesting = requesting;
        counterTrade.isActive = true;
        
        // Chat message
        ChatMessage chatMsg;
        chatMsg.id = std::to_string(game->nextChatMessageId++);
        chatMsg.fromPlayerId = playerId;
        chatMsg.toPlayerId = originalTrade->fromPlayerId;
        chatMsg.type = ChatMessageType::TradeCounter;
        chatMsg.relatedTradeId = counterTrade.id;
        chatMsg.timestamp = std::chrono::steady_clock::now();
        
        std::string proposerName = "Unknown";
        if (originalTrade->fromPlayerId >= 0 && originalTrade->fromPlayerId < (int)game->players.size()) {
            proposerName = game->players[originalTrade->fromPlayerId].name;
        }
        
        std::ostringstream desc;
        desc << "🔄 Counter-offer to " << proposerName;
        if (!message.empty()) desc << ": " << message;
        chatMsg.content = desc.str();
        
        counterTrade.chatMessageId = chatMsg.id;
        game->tradeOffers.push_back(counterTrade);
        game->chatMessages.push_back(chatMsg);
        
        SSEEvent tradeEvent = GameEvents::createTradeProposedEvent(
            counterTrade.id, counterTrade.fromPlayerId, player->name, counterTrade.toPlayerId,
            offering.wood, offering.brick, offering.wheat, offering.sheep, offering.ore,
            requesting.wood, requesting.brick, requesting.wheat, requesting.sheep, requesting.ore,
            message
        );
        sseManager.broadcastToGame(gameId, tradeEvent);
        
        SSEEvent chatEvent = GameEvents::createChatMessageEvent(
            chatMsg.id, chatMsg.fromPlayerId, player->name,
            chatMsg.toPlayerId, chatMsg.content, "trade_counter"
        );
        sseManager.broadcastToGame(gameId, chatEvent);
        
        result.success = true;
        result.message = "Counter-offer made";
        result.data = "{\"counterTradeId\":" + std::to_string(counterTrade.id) + "}";
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
