#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <mutex>
#include <queue>
#include <functional>
#include <atomic>
#include <thread>
#include <condition_variable>

namespace catan {

// ============================================================================
// SSE EVENT
// ============================================================================

struct SSEEvent {
    std::string event;      // Event type (e.g., "ai_action", "game_update")
    std::string data;       // JSON data
    std::string id;         // Optional event ID
    
    std::string serialize() const {
        std::string result;
        if (!event.empty()) {
            result += "event: " + event + "\n";
        }
        if (!id.empty()) {
            result += "id: " + id + "\n";
        }
        // Handle multiline data
        size_t pos = 0;
        std::string dataStr = data;
        while ((pos = dataStr.find('\n')) != std::string::npos) {
            result += "data: " + dataStr.substr(0, pos) + "\n";
            dataStr = dataStr.substr(pos + 1);
        }
        result += "data: " + dataStr + "\n";
        result += "\n";  // Empty line to end event
        return result;
    }
};

// ============================================================================
// SSE CLIENT CONNECTION
// ============================================================================

struct SSEClient {
    int socket;
    std::string gameId;
    std::string playerId;
    std::atomic<bool> connected{true};
    std::queue<SSEEvent> pendingEvents;
    std::mutex eventMutex;
    std::condition_variable eventCv;
};

// ============================================================================
// SSE MANAGER
// Manages SSE connections and broadcasts events
// ============================================================================

class SSEManager {
private:
    // gameId -> list of connected clients
    std::unordered_map<std::string, std::vector<SSEClient*>> gameClients;
    mutable std::mutex clientsMutex;
    
    // All clients (for cleanup)
    std::unordered_set<SSEClient*> allClients;
    
    // Event ID counter
    std::atomic<uint64_t> eventIdCounter{0};
    
public:
    SSEManager() = default;
    ~SSEManager();
    
    // Register a new SSE client for a game
    SSEClient* registerClient(int socket, const std::string& gameId, const std::string& playerId = "");
    
    // Unregister a client
    void unregisterClient(SSEClient* client);
    
    // Broadcast event to all clients watching a game
    void broadcastToGame(const std::string& gameId, const SSEEvent& event);
    
    // Send event to a specific client
    void sendToClient(SSEClient* client, const SSEEvent& event);
    
    // Get next event ID
    std::string nextEventId();
    
    // Get count of clients for a game
    size_t getClientCount(const std::string& gameId) const;
    
    // Check if a client is still connected
    bool isClientConnected(SSEClient* client) const;
    
    // Write SSE headers to socket
    static bool writeSSEHeaders(int socket);
    
    // Write event to socket
    static bool writeEvent(int socket, const SSEEvent& event);
    
    // Write keepalive comment
    static bool writeKeepalive(int socket);
};

// ============================================================================
// GAME EVENT TYPES
// ============================================================================

namespace GameEvents {
    // Event type constants
    constexpr const char* AI_THINKING = "ai_thinking";
    constexpr const char* AI_ACTION = "ai_action";
    constexpr const char* AI_TURN_COMPLETE = "ai_turn_complete";
    constexpr const char* AI_ERROR = "ai_error";
    constexpr const char* GAME_STATE_CHANGED = "game_state_changed";
    constexpr const char* TURN_CHANGED = "turn_changed";
    constexpr const char* PLAYER_JOINED = "player_joined";
    constexpr const char* GAME_STARTED = "game_started";
    constexpr const char* GAME_ENDED = "game_ended";
    
    // Chat and trade events
    constexpr const char* CHAT_MESSAGE = "chat_message";
    constexpr const char* TRADE_PROPOSED = "trade_proposed";
    constexpr const char* TRADE_ACCEPTED = "trade_accepted";
    constexpr const char* TRADE_REJECTED = "trade_rejected";
    constexpr const char* TRADE_COUNTERED = "trade_countered";
    constexpr const char* TRADE_EXECUTED = "trade_executed";
    constexpr const char* TRADE_CANCELLED = "trade_cancelled";
    
    // Helper to create AI action event
    SSEEvent createAIActionEvent(
        int playerId,
        const std::string& playerName,
        const std::string& action,
        const std::string& description,
        bool success
    );
    
    // Helper to create turn changed event
    SSEEvent createTurnChangedEvent(
        int currentPlayerIndex,
        const std::string& playerName,
        bool isAI
    );
    
    // Helper to create game state changed event
    SSEEvent createGameStateChangedEvent(const std::string& gameStateJson);
    
    // Helper to create chat message event
    SSEEvent createChatMessageEvent(
        const std::string& messageId,
        int fromPlayerId,
        const std::string& fromPlayerName,
        int toPlayerId,
        const std::string& content,
        const std::string& messageType
    );
    
    // Helper to create trade proposed event
    SSEEvent createTradeProposedEvent(
        int tradeId,
        int fromPlayerId,
        const std::string& fromPlayerName,
        int toPlayerId,
        int offerWood, int offerBrick, int offerWheat, int offerSheep, int offerOre,
        int requestWood, int requestBrick, int requestWheat, int requestSheep, int requestOre,
        const std::string& message
    );
    
    // Helper to create trade response event
    SSEEvent createTradeResponseEvent(
        const std::string& eventType,  // TRADE_ACCEPTED, TRADE_REJECTED, etc.
        int tradeId,
        int responderId,
        const std::string& responderName
    );
    
    // Helper to create trade executed event
    SSEEvent createTradeExecutedEvent(
        int tradeId,
        int player1Id,
        const std::string& player1Name,
        int player2Id,
        const std::string& player2Name
    );
}

// Global SSE manager instance
extern SSEManager sseManager;

}  // namespace catan
