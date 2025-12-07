#pragma once

#include <string>
#include <vector>
#include <functional>
#include <optional>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <queue>
#include "catan_types.h"
#include "llm_provider.h"

namespace catan {
namespace ai {

// ============================================================================
// AI TOOL DEFINITIONS
// These are the tools available to LLM agents to play the game
// ============================================================================

// Tool parameter types
struct RollDiceParams {
    // No parameters needed
};

struct BuildRoadParams {
    int hexQ;           // Hex coordinate Q
    int hexR;           // Hex coordinate R
    int direction;      // Edge direction (0-5)
};

struct BuildSettlementParams {
    int hexQ;           // Hex coordinate Q
    int hexR;           // Hex coordinate R
    int direction;      // Vertex direction (0-5)
};

struct BuildCityParams {
    int hexQ;           // Hex coordinate Q
    int hexR;           // Hex coordinate R
    int direction;      // Vertex direction (0-5)
};

struct BuyDevCardParams {
    // No parameters needed
};

struct BankTradeParams {
    Resource give;      // Resource to give (4 of this)
    Resource receive;   // Resource to receive (1 of this)
};

struct MoveRobberParams {
    int hexQ;           // Target hex coordinate Q
    int hexR;           // Target hex coordinate R
    int stealFromPlayerId;  // Player to steal from (-1 if none)
};

struct PlayKnightParams {
    int hexQ;           // Target hex coordinate Q
    int hexR;           // Target hex coordinate R
    int stealFromPlayerId;  // Player to steal from (-1 if none)
};

struct PlayRoadBuildingParams {
    // First road
    int road1HexQ;
    int road1HexR;
    int road1Direction;
    // Second road (optional, -1 if not placing)
    int road2HexQ;
    int road2HexR;
    int road2Direction;
};

struct PlayYearOfPlentyParams {
    Resource resource1;     // First resource to take
    Resource resource2;     // Second resource to take
};

struct PlayMonopolyParams {
    Resource resource;      // Resource to monopolize
};

struct EndTurnParams {
    // No parameters needed
};

// ============================================================================
// TOOL RESULT
// ============================================================================

struct ToolResult {
    bool success;
    std::string message;
    std::string data;       // JSON data if applicable
};

// ============================================================================
// AI TOOL DEFINITIONS FOR LLM
// These are serialized to JSON for the LLM to understand available actions
// ============================================================================

struct ToolDefinition {
    std::string name;
    std::string description;
    std::string parametersSchema;   // JSON schema for parameters
};

// Get all available tool definitions
std::vector<ToolDefinition> getToolDefinitions();

// ============================================================================
// GAME STATE FOR AI
// A simplified view of the game state for AI decision making
// ============================================================================

struct AIGameState {
    // Current player info
    int playerId;
    std::string playerName;
    ResourceHand resources;
    std::vector<DevCardType> devCards;
    int settlementsRemaining;
    int citiesRemaining;
    int roadsRemaining;
    int knightsPlayed;
    
    // Game phase
    GamePhase phase;
    bool isMyTurn;
    std::optional<DiceRoll> lastRoll;
    
    // Other players (public info only)
    struct OtherPlayer {
        int id;
        std::string name;
        int resourceCount;      // Total cards (hidden)
        int devCardCount;       // Total dev cards (hidden)
        int knightsPlayed;
        bool hasLongestRoad;
        bool hasLargestArmy;
        int visibleVictoryPoints;   // VP from buildings + achievements
    };
    std::vector<OtherPlayer> otherPlayers;
    
    // Board state
    struct HexInfo {
        int q, r;
        HexType type;
        int numberToken;
        bool hasRobber;
    };
    std::vector<HexInfo> hexes;
    
    struct VertexInfo {
        int hexQ, hexR, direction;
        Building building;
        int ownerPlayerId;
    };
    std::vector<VertexInfo> buildings;  // Only occupied vertices
    
    struct EdgeInfo {
        int hexQ, hexR, direction;
        int ownerPlayerId;
    };
    std::vector<EdgeInfo> roads;        // Only edges with roads
    
    // Available actions based on current phase and resources
    std::vector<std::string> availableTools;
};

// Convert game state to AI-friendly view
AIGameState getAIGameState(const Game& game, int playerId);

// Convert AIGameState to JSON string
std::string aiGameStateToJson(const AIGameState& state);

// ============================================================================
// AI TURN PROCESSOR
// Processes an AI player's turn by calling tools
// ============================================================================

// Tool call from LLM
struct ToolCall {
    std::string toolName;
    std::string arguments;  // JSON string
};

// Result of processing AI turn
struct AITurnResult {
    std::vector<std::pair<ToolCall, ToolResult>> actions;  // All actions taken
    bool turnEnded;
    std::string error;
};

// Process a single AI turn
// This executes tools one by one until the AI ends their turn
class AITurnProcessor {
private:
    Game* game;
    int playerId;
    
public:
    AITurnProcessor(Game* game, int playerId);
    
    // Execute a single tool call
    ToolResult executeTool(const ToolCall& call);
    
    // Get available tools for current game state
    std::vector<std::string> getAvailableTools() const;
    
    // Check if it's this AI's turn
    bool isMyTurn() const;
    
    // Get current game state for AI
    AIGameState getCurrentState() const;
};

// ============================================================================
// AI TURN ACTION LOG
// Records actions taken during AI turns for UI display
// ============================================================================

struct AIActionLogEntry {
    int playerId;
    std::string playerName;
    std::string action;         // Tool name
    std::string description;    // Human-readable description
    bool success;
    std::string error;
    std::chrono::steady_clock::time_point timestamp;
};

// ============================================================================
// SERVER-SIDE AI TURN EXECUTOR
// Handles processing AI turns on the server using LLM providers
// ============================================================================

class AITurnExecutor {
public:
    enum class Status {
        Idle,
        Processing,
        Completed,
        Error
    };
    
private:
    Game* game;
    LLMConfigManager& llmConfig;
    
    // Processing state
    std::atomic<Status> status{Status::Idle};
    std::atomic<bool> shouldStop{false};
    std::thread processingThread;
    mutable std::mutex mutex;
    
    // Action log
    mutable std::vector<AIActionLogEntry> actionLog;
    
    // Current processing info
    int currentAIPlayerId = -1;
    std::string lastError;
    
    // Helper methods
    std::string buildSystemPrompt() const;
    std::string buildUserMessage(const AIGameState& state) const;
    std::vector<LLMTool> buildToolList() const;
    ToolResult executeToolCall(const LLMToolCall& toolCall, int playerId);
    std::string describeAction(const std::string& toolName, const ToolResult& result) const;
    
public:
    AITurnExecutor(Game* game, LLMConfigManager& llmConfig);
    ~AITurnExecutor();
    
    // Start processing AI turns (non-blocking)
    bool startProcessing();
    
    // Stop processing
    void stopProcessing();
    
    // Check status
    Status getStatus() const { return status.load(); }
    
    // Get current AI player being processed
    int getCurrentAIPlayerId() const { return currentAIPlayerId; }
    
    // Get action log (recent actions)
    std::vector<AIActionLogEntry> getActionLog(size_t maxEntries = 50) const;
    
    // Clear action log
    void clearActionLog();
    
    // Get last error
    std::string getLastError() const { return lastError; }
    
    // Check if any AI players need to take their turn
    bool hasAIPendingTurns() const;
    
    // Get status as JSON
    std::string statusToJson() const;
    
private:
    // Main processing loop (runs in thread)
    void processAITurns();
    
    // Process a single AI player's turn
    bool processSingleAITurn(int playerId);
};

// ============================================================================
// AI PLAYER MANAGER
// Manages all AI players and coordinates their turns
// ============================================================================

class AIPlayerManager {
private:
    Game* game;
    
public:
    explicit AIPlayerManager(Game* game);
    
    // Check if current player is AI
    bool isCurrentPlayerAI() const;
    
    // Get all AI player IDs
    std::vector<int> getAIPlayerIds() const;
    
    // Get the next human player's index (for UI to know when to wait)
    int getNextHumanPlayerIndex() const;
    
    // Count of human/AI players
    int humanPlayerCount() const;
    int aiPlayerCount() const;
};

}  // namespace ai
}  // namespace catan
