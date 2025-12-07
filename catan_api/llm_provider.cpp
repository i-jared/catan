#include "llm_provider.h"
#include <sstream>
#include <fstream>
#include <cstdlib>
#include <stdexcept>
#include <cstring>
#include <array>
#include <memory>
#include <unistd.h>
#include <sys/wait.h>

namespace catan {
namespace ai {

// ============================================================================
// HTTPS CLIENT (using curl subprocess)
// ============================================================================

class CurlHTTPS {
public:
    static std::string post(
        const std::string& url,
        const std::string& body,
        const std::vector<std::pair<std::string, std::string>>& headers
    ) {
        // Create temp file for request body
        char bodyFile[] = "/tmp/llm_request_XXXXXX";
        int bodyFd = mkstemp(bodyFile);
        if (bodyFd < 0) {
            throw std::runtime_error("Failed to create temp file for request body");
        }
        write(bodyFd, body.c_str(), body.length());
        close(bodyFd);
        
        // Create temp file for response
        char responseFile[] = "/tmp/llm_response_XXXXXX";
        int responseFd = mkstemp(responseFile);
        close(responseFd);
        
        // Build curl command
        std::ostringstream cmd;
        cmd << "curl -s -X POST ";
        cmd << "\"" << url << "\" ";
        cmd << "-d @" << bodyFile << " ";
        for (const auto& header : headers) {
            cmd << "-H \"" << header.first << ": " << header.second << "\" ";
        }
        cmd << "-o " << responseFile << " 2>/dev/null";
        
        // Execute curl
        int result = system(cmd.str().c_str());
        
        // Read response
        std::string response;
        std::ifstream responseStream(responseFile);
        if (responseStream) {
            std::ostringstream ss;
            ss << responseStream.rdbuf();
            response = ss.str();
        }
        
        // Cleanup temp files
        unlink(bodyFile);
        unlink(responseFile);
        
        if (result != 0) {
            throw std::runtime_error("curl command failed with code " + std::to_string(result));
        }
        
        return response;
    }
};

// ============================================================================
// HTTP LLM PROVIDER BASE
// ============================================================================

std::string HTTPLLMProvider::httpPost(
    const std::string& url,
    const std::string& body,
    const std::vector<std::pair<std::string, std::string>>& headers
) {
    return CurlHTTPS::post(url, body, headers);
}

// ============================================================================
// MOCK LLM PROVIDER
// ============================================================================

MockLLMProvider::MockLLMProvider(const LLMConfig& config) : config(config) {}

LLMResponse MockLLMProvider::chat(
    const std::vector<LLMMessage>& messages,
    const std::vector<LLMTool>& tools,
    const std::string& systemPrompt
) {
    LLMResponse response;
    response.success = true;
    
    // Parse the last user message to understand the game state
    std::string lastMessage;
    for (const auto& msg : messages) {
        if (msg.role == LLMMessage::Role::User) {
            lastMessage = msg.content;
        }
    }
    
    // Simple mock decision logic based on available tools and game state
    LLMToolCall toolCall;
    
    // Check for phase indicators in the message
    if (lastMessage.find("\"phase\":\"rolling\"") != std::string::npos) {
        toolCall.toolName = "roll_dice";
        toolCall.arguments = "{}";
    }
    else if (lastMessage.find("\"phase\":\"robber\"") != std::string::npos) {
        // Find a hex to move robber to
        toolCall.toolName = "move_robber";
        toolCall.arguments = "{\"hexQ\":0,\"hexR\":1,\"stealFromPlayerId\":-1}";
    }
    else if (lastMessage.find("\"phase\":\"main_turn\"") != std::string::npos) {
        // Check if we can buy a dev card
        bool canBuyDevCard = lastMessage.find("\"buy_dev_card\"") != std::string::npos;
        bool canBankTrade = lastMessage.find("\"bank_trade\"") != std::string::npos;
        
        if (canBuyDevCard) {
            toolCall.toolName = "buy_dev_card";
            toolCall.arguments = "{}";
        }
        else if (canBankTrade) {
            // Try to find which resource we have 4+ of
            if (lastMessage.find("\"wood\":4") != std::string::npos || 
                lastMessage.find("\"wood\":5") != std::string::npos) {
                toolCall.toolName = "bank_trade";
                toolCall.arguments = "{\"give\":\"wood\",\"receive\":\"ore\"}";
            }
            else if (lastMessage.find("\"brick\":4") != std::string::npos ||
                     lastMessage.find("\"brick\":5") != std::string::npos) {
                toolCall.toolName = "bank_trade";
                toolCall.arguments = "{\"give\":\"brick\",\"receive\":\"wheat\"}";
            }
            else {
                toolCall.toolName = "end_turn";
                toolCall.arguments = "{}";
            }
        }
        else {
            toolCall.toolName = "end_turn";
            toolCall.arguments = "{}";
        }
    }
    else {
        // Default: end turn
        toolCall.toolName = "end_turn";
        toolCall.arguments = "{}";
    }
    
    response.toolCall = toolCall;
    response.textContent = "Mock AI decided to use " + toolCall.toolName;
    
    return response;
}

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

AnthropicProvider::AnthropicProvider(const LLMConfig& config) : HTTPLLMProvider(config) {
    if (config.model.empty()) {
        this->config.model = "claude-sonnet-4-20250514";
    }
    if (config.baseUrl.empty()) {
        this->config.baseUrl = "https://api.anthropic.com";
    }
}

// Helper to escape JSON strings
static std::string escapeJson(const std::string& s) {
    std::ostringstream result;
    for (char c : s) {
        switch (c) {
            case '"': result << "\\\""; break;
            case '\\': result << "\\\\"; break;
            case '\n': result << "\\n"; break;
            case '\r': result << "\\r"; break;
            case '\t': result << "\\t"; break;
            default: result << c;
        }
    }
    return result.str();
}

// Simple JSON string parser
static std::string parseJsonString(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\":\"";
    size_t pos = json.find(searchKey);
    if (pos == std::string::npos) {
        // Try without quotes (for nested objects)
        searchKey = "\"" + key + "\":";
        pos = json.find(searchKey);
        if (pos == std::string::npos) return "";
        pos += searchKey.length();
        // Skip whitespace
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
        if (json[pos] == '{' || json[pos] == '[') {
            // Find matching bracket
            char open = json[pos];
            char close = (open == '{') ? '}' : ']';
            int depth = 1;
            size_t start = pos;
            pos++;
            while (pos < json.size() && depth > 0) {
                if (json[pos] == open) depth++;
                else if (json[pos] == close) depth--;
                pos++;
            }
            return json.substr(start, pos - start);
        }
        return "";
    }
    pos += searchKey.length();
    size_t endPos = pos;
    while (endPos < json.size() && json[endPos] != '"') {
        if (json[endPos] == '\\') endPos++;  // Skip escaped chars
        endPos++;
    }
    return json.substr(pos, endPos - pos);
}

LLMResponse AnthropicProvider::chat(
    const std::vector<LLMMessage>& messages,
    const std::vector<LLMTool>& tools,
    const std::string& systemPrompt
) {
    LLMResponse response;
    response.success = false;
    
    // Build request body
    std::ostringstream body;
    body << "{";
    body << "\"model\":\"" << config.model << "\",";
    body << "\"max_tokens\":" << config.maxTokens << ",";
    
    // System prompt
    if (!systemPrompt.empty()) {
        body << "\"system\":\"" << escapeJson(systemPrompt) << "\",";
    }
    
    // Messages
    body << "\"messages\":[";
    bool first = true;
    for (const auto& msg : messages) {
        if (!first) body << ",";
        first = false;
        
        body << "{\"role\":\"";
        switch (msg.role) {
            case LLMMessage::Role::User: body << "user"; break;
            case LLMMessage::Role::Assistant: body << "assistant"; break;
            default: body << "user"; break;
        }
        body << "\",\"content\":\"" << escapeJson(msg.content) << "\"}";
    }
    body << "],";
    
    // Tools
    body << "\"tools\":[";
    first = true;
    for (const auto& tool : tools) {
        if (!first) body << ",";
        first = false;
        
        body << "{";
        body << "\"name\":\"" << tool.name << "\",";
        body << "\"description\":\"" << escapeJson(tool.description) << "\",";
        body << "\"input_schema\":" << tool.parametersSchema;
        body << "}";
    }
    body << "]";
    
    body << "}";
    
    std::string requestBody = body.str();
    
    // Make request
    try {
        std::vector<std::pair<std::string, std::string>> headers = {
            {"Content-Type", "application/json"},
            {"x-api-key", config.apiKey},
            {"anthropic-version", "2023-06-01"}
        };
        
        std::string responseBody = httpPost(
            config.baseUrl + "/v1/messages",
            requestBody,
            headers
        );
        
        response.rawResponse = responseBody;
        
        // Parse response
        // Look for tool_use in content
        if (responseBody.find("\"type\":\"tool_use\"") != std::string::npos) {
            // Extract tool name and input
            size_t toolUsePos = responseBody.find("\"type\":\"tool_use\"");
            size_t namePos = responseBody.find("\"name\":\"", toolUsePos);
            if (namePos != std::string::npos) {
                namePos += 8;
                size_t nameEnd = responseBody.find("\"", namePos);
                std::string toolName = responseBody.substr(namePos, nameEnd - namePos);
                
                // Find input
                size_t inputPos = responseBody.find("\"input\":", toolUsePos);
                if (inputPos != std::string::npos) {
                    inputPos += 8;
                    // Find the JSON object
                    size_t inputStart = responseBody.find("{", inputPos);
                    if (inputStart != std::string::npos) {
                        int depth = 1;
                        size_t inputEnd = inputStart + 1;
                        while (inputEnd < responseBody.size() && depth > 0) {
                            if (responseBody[inputEnd] == '{') depth++;
                            else if (responseBody[inputEnd] == '}') depth--;
                            inputEnd++;
                        }
                        std::string input = responseBody.substr(inputStart, inputEnd - inputStart);
                        
                        LLMToolCall toolCall;
                        toolCall.toolName = toolName;
                        toolCall.arguments = input;
                        response.toolCall = toolCall;
                    }
                }
            }
            response.success = true;
        }
        else if (responseBody.find("\"type\":\"text\"") != std::string::npos) {
            // Text response
            response.textContent = parseJsonString(responseBody, "text");
            response.success = true;
        }
        else if (responseBody.find("\"error\"") != std::string::npos) {
            response.error = parseJsonString(responseBody, "message");
        }
        else {
            response.success = true;
            response.textContent = responseBody;
        }
        
    } catch (const std::exception& e) {
        response.error = e.what();
    }
    
    return response;
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

OpenAIProvider::OpenAIProvider(const LLMConfig& config) : HTTPLLMProvider(config) {
    if (config.model.empty()) {
        this->config.model = "gpt-4";
    }
    if (config.baseUrl.empty()) {
        this->config.baseUrl = "https://api.openai.com";
    }
}

LLMResponse OpenAIProvider::chat(
    const std::vector<LLMMessage>& messages,
    const std::vector<LLMTool>& tools,
    const std::string& systemPrompt
) {
    LLMResponse response;
    response.success = false;
    
    // Build request body
    std::ostringstream body;
    body << "{";
    body << "\"model\":\"" << config.model << "\",";
    body << "\"max_tokens\":" << config.maxTokens << ",";
    
    // Messages
    body << "\"messages\":[";
    
    // Add system message if present
    if (!systemPrompt.empty()) {
        body << "{\"role\":\"system\",\"content\":\"" << escapeJson(systemPrompt) << "\"},";
    }
    
    bool first = true;
    for (const auto& msg : messages) {
        if (!first) body << ",";
        first = false;
        
        body << "{\"role\":\"";
        switch (msg.role) {
            case LLMMessage::Role::User: body << "user"; break;
            case LLMMessage::Role::Assistant: body << "assistant"; break;
            case LLMMessage::Role::System: body << "system"; break;
            default: body << "user"; break;
        }
        body << "\",\"content\":\"" << escapeJson(msg.content) << "\"}";
    }
    body << "],";
    
    // Tools (OpenAI format)
    body << "\"tools\":[";
    first = true;
    for (const auto& tool : tools) {
        if (!first) body << ",";
        first = false;
        
        body << "{";
        body << "\"type\":\"function\",";
        body << "\"function\":{";
        body << "\"name\":\"" << tool.name << "\",";
        body << "\"description\":\"" << escapeJson(tool.description) << "\",";
        body << "\"parameters\":" << tool.parametersSchema;
        body << "}}";
    }
    body << "],";
    body << "\"tool_choice\":\"auto\"";
    
    body << "}";
    
    std::string requestBody = body.str();
    
    // Make request
    try {
        std::vector<std::pair<std::string, std::string>> headers = {
            {"Content-Type", "application/json"},
            {"Authorization", "Bearer " + config.apiKey}
        };
        
        std::string responseBody = httpPost(
            config.baseUrl + "/v1/chat/completions",
            requestBody,
            headers
        );
        
        response.rawResponse = responseBody;
        
        // Parse response - look for tool_calls
        if (responseBody.find("\"tool_calls\"") != std::string::npos) {
            // Extract function name and arguments
            size_t funcPos = responseBody.find("\"function\":");
            if (funcPos != std::string::npos) {
                std::string funcName = parseJsonString(responseBody.substr(funcPos), "name");
                
                // Find arguments
                size_t argsPos = responseBody.find("\"arguments\":", funcPos);
                if (argsPos != std::string::npos) {
                    argsPos += 12;
                    // Skip to start of string
                    while (argsPos < responseBody.size() && responseBody[argsPos] != '"') argsPos++;
                    if (argsPos < responseBody.size()) {
                        argsPos++;
                        size_t argsEnd = argsPos;
                        while (argsEnd < responseBody.size()) {
                            if (responseBody[argsEnd] == '"' && responseBody[argsEnd-1] != '\\') break;
                            argsEnd++;
                        }
                        std::string args = responseBody.substr(argsPos, argsEnd - argsPos);
                        // Unescape the JSON string
                        std::string unescaped;
                        for (size_t i = 0; i < args.size(); i++) {
                            if (args[i] == '\\' && i + 1 < args.size()) {
                                char next = args[i + 1];
                                if (next == 'n') { unescaped += '\n'; i++; }
                                else if (next == 't') { unescaped += '\t'; i++; }
                                else if (next == '"') { unescaped += '"'; i++; }
                                else if (next == '\\') { unescaped += '\\'; i++; }
                                else unescaped += args[i];
                            } else {
                                unescaped += args[i];
                            }
                        }
                        
                        LLMToolCall toolCall;
                        toolCall.toolName = funcName;
                        toolCall.arguments = unescaped;
                        response.toolCall = toolCall;
                    }
                }
            }
            response.success = true;
        }
        else if (responseBody.find("\"content\"") != std::string::npos) {
            // Text response
            response.textContent = parseJsonString(responseBody, "content");
            response.success = true;
        }
        else if (responseBody.find("\"error\"") != std::string::npos) {
            response.error = parseJsonString(responseBody, "message");
        }
        
    } catch (const std::exception& e) {
        response.error = e.what();
    }
    
    return response;
}

// ============================================================================
// LLM PROVIDER FACTORY
// ============================================================================

std::unique_ptr<LLMProvider> LLMProviderFactory::create(const LLMConfig& config) {
    if (config.provider == "anthropic") {
        return std::make_unique<AnthropicProvider>(config);
    }
    else if (config.provider == "openai") {
        return std::make_unique<OpenAIProvider>(config);
    }
    else {
        // Default to mock
        return std::make_unique<MockLLMProvider>(config);
    }
}

std::vector<std::string> LLMProviderFactory::availableProviders() {
    return {"mock", "anthropic", "openai"};
}

// ============================================================================
// LLM CONFIG MANAGER
// ============================================================================

LLMConfigManager::LLMConfigManager() {
    currentConfig.provider = "mock";
    loadFromEnvironment();
}

void LLMConfigManager::loadFromEnvironment() {
    // Check for Anthropic API key
    const char* anthropicKey = std::getenv("ANTHROPIC_API_KEY");
    if (anthropicKey && strlen(anthropicKey) > 0) {
        currentConfig.provider = "anthropic";
        currentConfig.apiKey = anthropicKey;
        currentConfig.model = "claude-sonnet-4-20250514";
        provider = LLMProviderFactory::create(currentConfig);
        return;
    }
    
    // Check for OpenAI API key
    const char* openaiKey = std::getenv("OPENAI_API_KEY");
    if (openaiKey && strlen(openaiKey) > 0) {
        currentConfig.provider = "openai";
        currentConfig.apiKey = openaiKey;
        currentConfig.model = "gpt-4";
        provider = LLMProviderFactory::create(currentConfig);
        return;
    }
    
    // Default to mock
    currentConfig.provider = "mock";
    provider = LLMProviderFactory::create(currentConfig);
}

bool LLMConfigManager::loadFromFile(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        return false;
    }
    
    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string json = buffer.str();
    
    // Parse JSON (simple parsing)
    auto getValue = [&json](const std::string& key) -> std::string {
        std::string searchKey = "\"" + key + "\":\"";
        size_t pos = json.find(searchKey);
        if (pos == std::string::npos) return "";
        pos += searchKey.length();
        size_t endPos = json.find("\"", pos);
        if (endPos == std::string::npos) return "";
        return json.substr(pos, endPos - pos);
    };
    
    std::string provider = getValue("provider");
    if (!provider.empty()) currentConfig.provider = provider;
    
    std::string apiKey = getValue("apiKey");
    if (!apiKey.empty()) currentConfig.apiKey = apiKey;
    
    std::string model = getValue("model");
    if (!model.empty()) currentConfig.model = model;
    
    std::string baseUrl = getValue("baseUrl");
    if (!baseUrl.empty()) currentConfig.baseUrl = baseUrl;
    
    this->provider = LLMProviderFactory::create(currentConfig);
    return true;
}

void LLMConfigManager::setConfig(const LLMConfig& config) {
    currentConfig = config;
    provider = LLMProviderFactory::create(currentConfig);
}

LLMProvider* LLMConfigManager::getProvider() {
    if (!provider) {
        provider = LLMProviderFactory::create(currentConfig);
    }
    return provider.get();
}

bool LLMConfigManager::isConfigured() const {
    if (currentConfig.provider == "mock") {
        return true;
    }
    return !currentConfig.apiKey.empty();
}

std::string LLMConfigManager::toJson() const {
    std::ostringstream json;
    json << "{";
    json << "\"provider\":\"" << currentConfig.provider << "\",";
    json << "\"model\":\"" << currentConfig.model << "\",";
    json << "\"configured\":" << (isConfigured() ? "true" : "false") << ",";
    json << "\"availableProviders\":[";
    auto providers = LLMProviderFactory::availableProviders();
    for (size_t i = 0; i < providers.size(); i++) {
        if (i > 0) json << ",";
        json << "\"" << providers[i] << "\"";
    }
    json << "]";
    json << "}";
    return json.str();
}

}  // namespace ai
}  // namespace catan
