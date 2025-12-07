#include "sse_handler.h"
#include <unistd.h>
#include <sys/socket.h>
#include <cstring>
#include <sstream>

namespace catan {

// Global SSE manager instance
SSEManager sseManager;

// ============================================================================
// SSE MANAGER IMPLEMENTATION
// ============================================================================

SSEManager::~SSEManager() {
    std::lock_guard<std::mutex> lock(clientsMutex);
    for (auto* client : allClients) {
        client->connected = false;
        delete client;
    }
    allClients.clear();
    gameClients.clear();
}

SSEClient* SSEManager::registerClient(int socket, const std::string& gameId, const std::string& playerId) {
    auto* client = new SSEClient();
    client->socket = socket;
    client->gameId = gameId;
    client->playerId = playerId;
    client->connected = true;
    
    std::lock_guard<std::mutex> lock(clientsMutex);
    gameClients[gameId].push_back(client);
    allClients.insert(client);
    
    return client;
}

void SSEManager::unregisterClient(SSEClient* client) {
    if (!client) return;
    
    client->connected = false;
    
    std::lock_guard<std::mutex> lock(clientsMutex);
    
    // Remove from game clients
    auto it = gameClients.find(client->gameId);
    if (it != gameClients.end()) {
        auto& clients = it->second;
        clients.erase(
            std::remove(clients.begin(), clients.end(), client),
            clients.end()
        );
        if (clients.empty()) {
            gameClients.erase(it);
        }
    }
    
    // Remove from all clients
    allClients.erase(client);
    
    delete client;
}

void SSEManager::broadcastToGame(const std::string& gameId, const SSEEvent& event) {
    std::vector<SSEClient*> clientsCopy;
    
    {
        std::lock_guard<std::mutex> lock(clientsMutex);
        auto it = gameClients.find(gameId);
        if (it != gameClients.end()) {
            clientsCopy = it->second;
        }
    }
    
    for (auto* client : clientsCopy) {
        if (client->connected) {
            sendToClient(client, event);
        }
    }
}

void SSEManager::sendToClient(SSEClient* client, const SSEEvent& event) {
    if (!client || !client->connected) return;
    
    if (!writeEvent(client->socket, event)) {
        client->connected = false;
    }
}

std::string SSEManager::nextEventId() {
    return std::to_string(eventIdCounter.fetch_add(1));
}

size_t SSEManager::getClientCount(const std::string& gameId) const {
    std::lock_guard<std::mutex> lock(clientsMutex);
    auto it = gameClients.find(gameId);
    if (it != gameClients.end()) {
        return it->second.size();
    }
    return 0;
}

bool SSEManager::isClientConnected(SSEClient* client) const {
    return client && client->connected.load();
}

bool SSEManager::writeSSEHeaders(int socket) {
    const char* headers = 
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: *\r\n"
        "\r\n";
    
    ssize_t written = send(socket, headers, strlen(headers), MSG_NOSIGNAL);
    return written > 0;
}

bool SSEManager::writeEvent(int socket, const SSEEvent& event) {
    std::string data = event.serialize();
    ssize_t written = send(socket, data.c_str(), data.length(), MSG_NOSIGNAL);
    return written > 0;
}

bool SSEManager::writeKeepalive(int socket) {
    const char* keepalive = ": keepalive\n\n";
    ssize_t written = send(socket, keepalive, strlen(keepalive), MSG_NOSIGNAL);
    return written > 0;
}

// ============================================================================
// GAME EVENTS HELPERS
// ============================================================================

namespace GameEvents {

SSEEvent createAIActionEvent(
    int playerId,
    const std::string& playerName,
    const std::string& action,
    const std::string& description,
    bool success
) {
    std::ostringstream json;
    json << "{";
    json << "\"playerId\":" << playerId << ",";
    json << "\"playerName\":\"" << playerName << "\",";
    json << "\"action\":\"" << action << "\",";
    json << "\"description\":\"" << description << "\",";
    json << "\"success\":" << (success ? "true" : "false");
    json << "}";
    
    SSEEvent event;
    event.event = AI_ACTION;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createTurnChangedEvent(
    int currentPlayerIndex,
    const std::string& playerName,
    bool isAI
) {
    std::ostringstream json;
    json << "{";
    json << "\"currentPlayerIndex\":" << currentPlayerIndex << ",";
    json << "\"playerName\":\"" << playerName << "\",";
    json << "\"isAI\":" << (isAI ? "true" : "false");
    json << "}";
    
    SSEEvent event;
    event.event = TURN_CHANGED;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createGameStateChangedEvent(const std::string& gameStateJson) {
    SSEEvent event;
    event.event = GAME_STATE_CHANGED;
    event.data = gameStateJson;
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createChatMessageEvent(
    const std::string& messageId,
    int fromPlayerId,
    const std::string& fromPlayerName,
    int toPlayerId,
    const std::string& content,
    const std::string& messageType
) {
    std::ostringstream json;
    json << "{";
    json << "\"messageId\":\"" << messageId << "\",";
    json << "\"fromPlayerId\":" << fromPlayerId << ",";
    json << "\"fromPlayerName\":\"" << fromPlayerName << "\",";
    json << "\"toPlayerId\":" << toPlayerId << ",";
    // Escape special characters in content
    std::string escapedContent;
    for (char c : content) {
        if (c == '"') escapedContent += "\\\"";
        else if (c == '\\') escapedContent += "\\\\";
        else if (c == '\n') escapedContent += "\\n";
        else if (c == '\r') escapedContent += "\\r";
        else if (c == '\t') escapedContent += "\\t";
        else escapedContent += c;
    }
    json << "\"content\":\"" << escapedContent << "\",";
    json << "\"type\":\"" << messageType << "\"";
    json << "}";
    
    SSEEvent event;
    event.event = CHAT_MESSAGE;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createTradeProposedEvent(
    int tradeId,
    int fromPlayerId,
    const std::string& fromPlayerName,
    int toPlayerId,
    int offerWood, int offerBrick, int offerWheat, int offerSheep, int offerOre,
    int requestWood, int requestBrick, int requestWheat, int requestSheep, int requestOre,
    const std::string& message
) {
    std::ostringstream json;
    json << "{";
    json << "\"tradeId\":" << tradeId << ",";
    json << "\"fromPlayerId\":" << fromPlayerId << ",";
    json << "\"fromPlayerName\":\"" << fromPlayerName << "\",";
    json << "\"toPlayerId\":" << toPlayerId << ",";
    json << "\"offering\":{";
    json << "\"wood\":" << offerWood << ",";
    json << "\"brick\":" << offerBrick << ",";
    json << "\"wheat\":" << offerWheat << ",";
    json << "\"sheep\":" << offerSheep << ",";
    json << "\"ore\":" << offerOre << "},";
    json << "\"requesting\":{";
    json << "\"wood\":" << requestWood << ",";
    json << "\"brick\":" << requestBrick << ",";
    json << "\"wheat\":" << requestWheat << ",";
    json << "\"sheep\":" << requestSheep << ",";
    json << "\"ore\":" << requestOre << "}";
    if (!message.empty()) {
        std::string escapedMessage;
        for (char c : message) {
            if (c == '"') escapedMessage += "\\\"";
            else if (c == '\\') escapedMessage += "\\\\";
            else if (c == '\n') escapedMessage += "\\n";
            else escapedMessage += c;
        }
        json << ",\"message\":\"" << escapedMessage << "\"";
    }
    json << "}";
    
    SSEEvent event;
    event.event = TRADE_PROPOSED;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createTradeResponseEvent(
    const std::string& eventType,
    int tradeId,
    int responderId,
    const std::string& responderName
) {
    std::ostringstream json;
    json << "{";
    json << "\"tradeId\":" << tradeId << ",";
    json << "\"responderId\":" << responderId << ",";
    json << "\"responderName\":\"" << responderName << "\"";
    json << "}";
    
    SSEEvent event;
    event.event = eventType;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

SSEEvent createTradeExecutedEvent(
    int tradeId,
    int player1Id,
    const std::string& player1Name,
    int player2Id,
    const std::string& player2Name
) {
    std::ostringstream json;
    json << "{";
    json << "\"tradeId\":" << tradeId << ",";
    json << "\"player1Id\":" << player1Id << ",";
    json << "\"player1Name\":\"" << player1Name << "\",";
    json << "\"player2Id\":" << player2Id << ",";
    json << "\"player2Name\":\"" << player2Name << "\"";
    json << "}";
    
    SSEEvent event;
    event.event = TRADE_EXECUTED;
    event.data = json.str();
    event.id = sseManager.nextEventId();
    return event;
}

}  // namespace GameEvents

}  // namespace catan
