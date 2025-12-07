#pragma once

#include <string>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>

namespace catan {

struct Session {
    std::string token;
    std::string gameId;
    int playerId;
    std::string playerName;
    std::chrono::steady_clock::time_point createdAt;
    std::chrono::steady_clock::time_point lastActivity;
    bool isActive = true;
};

class SessionManager {
private:
    // token -> Session
    std::unordered_map<std::string, Session> sessions;
    
    // Reverse lookup: gameId:playerId -> token (for reconnection)
    std::unordered_map<std::string, std::string> playerToToken;
    
    mutable std::mutex mutex;
    
    std::string generateToken() {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<uint64_t> dis;
        
        std::stringstream ss;
        ss << std::hex << std::setfill('0');
        ss << std::setw(16) << dis(gen);
        ss << std::setw(16) << dis(gen);
        return ss.str();
    }
    
    std::string makePlayerKey(const std::string& gameId, int playerId) {
        return gameId + ":" + std::to_string(playerId);
    }

public:
    // Create a new session when player joins a game
    // Returns the session token
    std::string createSession(const std::string& gameId, int playerId, const std::string& playerName) {
        std::lock_guard<std::mutex> lock(mutex);
        
        std::string token = generateToken();
        auto now = std::chrono::steady_clock::now();
        
        Session session;
        session.token = token;
        session.gameId = gameId;
        session.playerId = playerId;
        session.playerName = playerName;
        session.createdAt = now;
        session.lastActivity = now;
        session.isActive = true;
        
        sessions[token] = session;
        playerToToken[makePlayerKey(gameId, playerId)] = token;
        
        return token;
    }
    
    // Validate a token and get the session
    // Returns nullptr if invalid/expired
    Session* getSession(const std::string& token) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto it = sessions.find(token);
        if (it == sessions.end()) {
            return nullptr;
        }
        
        if (!it->second.isActive) {
            return nullptr;
        }
        
        // Update last activity
        it->second.lastActivity = std::chrono::steady_clock::now();
        return &it->second;
    }
    
    // Get session by game and player (for reconnection scenarios)
    Session* getSessionByPlayer(const std::string& gameId, int playerId) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto it = playerToToken.find(makePlayerKey(gameId, playerId));
        if (it == playerToToken.end()) {
            return nullptr;
        }
        
        auto sessionIt = sessions.find(it->second);
        if (sessionIt == sessions.end()) {
            return nullptr;
        }
        
        return &sessionIt->second;
    }
    
    // Invalidate a session (player leaves/disconnects)
    bool invalidateSession(const std::string& token) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto it = sessions.find(token);
        if (it != sessions.end()) {
            it->second.isActive = false;
            return true;
        }
        return false;
    }
    
    // Remove all sessions for a game (game ended)
    void removeGameSessions(const std::string& gameId) {
        std::lock_guard<std::mutex> lock(mutex);
        
        std::vector<std::string> tokensToRemove;
        for (const auto& pair : sessions) {
            if (pair.second.gameId == gameId) {
                tokensToRemove.push_back(pair.first);
            }
        }
        
        for (const auto& token : tokensToRemove) {
            auto& session = sessions[token];
            playerToToken.erase(makePlayerKey(session.gameId, session.playerId));
            sessions.erase(token);
        }
    }
    
    // Clean up expired sessions (call periodically)
    // Returns number of sessions cleaned
    size_t cleanupExpiredSessions(std::chrono::minutes timeout = std::chrono::minutes(30)) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto now = std::chrono::steady_clock::now();
        std::vector<std::string> tokensToRemove;
        
        for (const auto& pair : sessions) {
            auto elapsed = now - pair.second.lastActivity;
            if (elapsed > timeout) {
                tokensToRemove.push_back(pair.first);
            }
        }
        
        for (const auto& token : tokensToRemove) {
            auto& session = sessions[token];
            playerToToken.erase(makePlayerKey(session.gameId, session.playerId));
            sessions.erase(token);
        }
        
        return tokensToRemove.size();
    }
    
    // Get count of active sessions
    size_t activeSessionCount() const {
        std::lock_guard<std::mutex> lock(mutex);
        size_t count = 0;
        for (const auto& pair : sessions) {
            if (pair.second.isActive) count++;
        }
        return count;
    }
};

}  // namespace catan

