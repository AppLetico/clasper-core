// Providers module exports
// LLM Provider - main completion interface
export {
  llmComplete,
  llmStream,
  llmCompact,
  llmTask,
  type ConversationMessage,
  type TokenUsage,
  type CostBreakdown,
  type ClasperStreamEvent,
} from './llmProvider.js';

// OpenAI Client - backward compatible wrapper
export { 
  generateAgentReply, 
  compactHistory, 
  runLLMTask,
  type AgentReplyResult 
} from './openaiClient.js';

// Provider Contract - normalized types
export {
  parseProviderError,
  isRetryableError,
  calculateTotalTokens,
  validateResponse,
  createEmptyResponse,
  mergeResponses,
  ProviderContractError,
  type NormalizedResponse,
  type NormalizedToolCall,
  type ProviderError,
  type ProviderAdapter,
  type ProviderCapabilities,
  type StreamChunk,
  type CompletionRequest,
  type RequestMessage,
  type ToolDefinition as ProviderToolDefinition,
} from './providerContract.js';

// Streaming
export { streamAgentReply, type StreamEvent } from './streaming.js';
