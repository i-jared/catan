#pragma once

#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <optional>

namespace catan {
namespace ai {

// ============================================================================
// LLM PROVIDER ABSTRACTION
// Allows switching between different LLM providers (Anthropic, OpenAI, etc.)
// ============================================================================

// Tool call returned by LLM
struct LLMToolCall {
    std::string toolName;
    std::string arguments;  // JSON string
};

// Message for LLM conversation
struct LLMMessage {
    enum class Role { System, User, Assistant, ToolResult };
    Role role;
    std::string content;
    std::optional<LLMToolCall> toolCall;  // For assistant messages with tool calls
    std::optional<std::string> toolCallId;  // For tool result messages
};

// Tool definition for LLM
struct LLMTool {
    std::string name;
    std::string description;
    std::string parametersSchema;  // JSON schema
};

// Configuration for LLM provider
struct LLMConfig {
    std::string provider;       // "anthropic", "openai", "mock"
    std::string apiKey;
    std::string model;          // e.g., "claude-3-5-sonnet-20241022", "gpt-4"
    std::string baseUrl;        // Optional custom base URL
    int maxTokens = 1024;
    double temperature = 0.7;
};

// Response from LLM
struct LLMResponse {
    bool success;
    std::string error;
    std::optional<LLMToolCall> toolCall;
    std::string textContent;    // If no tool call, may have text response
    std::string rawResponse;    // Full raw response for debugging
};

// ============================================================================
// LLM PROVIDER INTERFACE
// ============================================================================

class LLMProvider {
public:
    virtual ~LLMProvider() = default;
    
    // Get the provider name
    virtual std::string getName() const = 0;
    
    // Send a request to the LLM and get a response
    virtual LLMResponse chat(
        const std::vector<LLMMessage>& messages,
        const std::vector<LLMTool>& tools,
        const std::string& systemPrompt
    ) = 0;
    
    // Check if the provider is properly configured
    virtual bool isConfigured() const = 0;
};

// ============================================================================
// MOCK LLM PROVIDER - For testing without API calls
// ============================================================================

class MockLLMProvider : public LLMProvider {
private:
    LLMConfig config;
    
public:
    explicit MockLLMProvider(const LLMConfig& config);
    
    std::string getName() const override { return "mock"; }
    
    LLMResponse chat(
        const std::vector<LLMMessage>& messages,
        const std::vector<LLMTool>& tools,
        const std::string& systemPrompt
    ) override;
    
    bool isConfigured() const override { return true; }
};

// ============================================================================
// HTTP LLM PROVIDER BASE - Common functionality for API-based providers
// ============================================================================

class HTTPLLMProvider : public LLMProvider {
protected:
    LLMConfig config;
    
    // Make HTTP POST request and return response body
    std::string httpPost(
        const std::string& url,
        const std::string& body,
        const std::vector<std::pair<std::string, std::string>>& headers
    );
    
public:
    explicit HTTPLLMProvider(const LLMConfig& config) : config(config) {}
    
    bool isConfigured() const override {
        return !config.apiKey.empty();
    }
};

// ============================================================================
// ANTHROPIC PROVIDER - Claude models
// ============================================================================

class AnthropicProvider : public HTTPLLMProvider {
public:
    explicit AnthropicProvider(const LLMConfig& config);
    
    std::string getName() const override { return "anthropic"; }
    
    LLMResponse chat(
        const std::vector<LLMMessage>& messages,
        const std::vector<LLMTool>& tools,
        const std::string& systemPrompt
    ) override;
};

// ============================================================================
// OPENAI PROVIDER - GPT models
// ============================================================================

class OpenAIProvider : public HTTPLLMProvider {
public:
    explicit OpenAIProvider(const LLMConfig& config);
    
    std::string getName() const override { return "openai"; }
    
    LLMResponse chat(
        const std::vector<LLMMessage>& messages,
        const std::vector<LLMTool>& tools,
        const std::string& systemPrompt
    ) override;
};

// ============================================================================
// LLM PROVIDER FACTORY
// ============================================================================

class LLMProviderFactory {
public:
    static std::unique_ptr<LLMProvider> create(const LLMConfig& config);
    
    // List available provider names
    static std::vector<std::string> availableProviders();
};

// ============================================================================
// LLM CONFIGURATION MANAGER
// ============================================================================

class LLMConfigManager {
private:
    LLMConfig currentConfig;
    std::unique_ptr<LLMProvider> provider;
    
public:
    LLMConfigManager();
    
    // Load config from environment variables
    void loadFromEnvironment();
    
    // Load config from JSON file
    bool loadFromFile(const std::string& path);
    
    // Set config directly
    void setConfig(const LLMConfig& config);
    
    // Get current config
    const LLMConfig& getConfig() const { return currentConfig; }
    
    // Get the current provider
    LLMProvider* getProvider();
    
    // Check if configured
    bool isConfigured() const;
    
    // Get config as JSON string
    std::string toJson() const;
};

}  // namespace ai
}  // namespace catan
