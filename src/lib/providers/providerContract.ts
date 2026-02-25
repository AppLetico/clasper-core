/**
 * Provider Contract
 *
 * Defines a normalized interface for LLM providers.
 * Providers adapt to Clasper - not the other way around.
 *
 * Features:
 * - Unified response format across all providers
 * - Standardized error taxonomy
 * - Tool calling normalization
 * - Streaming semantics
 */

import { z } from 'zod';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Normalized tool call format (provider-agnostic)
 */
export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Cost breakdown
 */
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: 'USD';
}

/**
 * Reason why generation finished
 */
export type FinishReason =
  | 'stop'           // Natural completion
  | 'tool_calls'     // Model wants to call tools
  | 'length'         // Hit max tokens
  | 'content_filter' // Content filtered
  | 'error';         // Error occurred

/**
 * Refusal information when model declines
 */
export interface RefusalInfo {
  type: 'content_policy' | 'capability' | 'safety' | 'unknown';
  message: string;
}

/**
 * Normalized response from any provider
 */
export interface NormalizedResponse {
  // Content
  content: string | null;
  toolCalls: NormalizedToolCall[];
  
  // Usage
  usage: TokenUsage;
  cost?: CostBreakdown;
  
  // Status
  finishReason: FinishReason;
  refusal?: RefusalInfo;
  
  // Metadata
  model: string;
  provider: string;
  latencyMs?: number;
}

/**
 * Message format for requests
 */
export interface RequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: NormalizedToolCall[];
}

/**
 * Tool definition format
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Request to the provider
 */
export interface CompletionRequest {
  messages: RequestMessage[];
  model: string;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes from providers
 */
export type ProviderErrorCode =
  | 'rate_limit'        // Too many requests
  | 'context_length'    // Input too long
  | 'invalid_request'   // Bad request format
  | 'auth'              // Authentication failed
  | 'server'            // Provider server error
  | 'timeout'           // Request timed out
  | 'unknown';          // Unknown error

/**
 * Normalized provider error
 */
export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  provider: string;
  originalError?: unknown;
}

/**
 * Provider error class
 */
export class ProviderContractError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
  provider: string;
  originalError?: unknown;

  constructor(error: ProviderError) {
    super(error.message);
    this.name = 'ProviderContractError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.retryAfterMs = error.retryAfterMs;
    this.provider = error.provider;
    this.originalError = error.originalError;
  }
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Streaming chunk types
 */
export type StreamChunkType =
  | 'start'
  | 'text_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'done'
  | 'error';

/**
 * Base streaming chunk
 */
export interface StreamChunkBase {
  type: StreamChunkType;
  timestamp: number;
}

/**
 * Start chunk
 */
export interface StartChunk extends StreamChunkBase {
  type: 'start';
  model: string;
}

/**
 * Text delta chunk
 */
export interface TextDeltaChunk extends StreamChunkBase {
  type: 'text_delta';
  text: string;
}

/**
 * Tool call start chunk
 */
export interface ToolCallStartChunk extends StreamChunkBase {
  type: 'tool_call_start';
  id: string;
  name: string;
}

/**
 * Tool call delta chunk (arguments streaming)
 */
export interface ToolCallDeltaChunk extends StreamChunkBase {
  type: 'tool_call_delta';
  id: string;
  argumentsDelta: string;
}

/**
 * Tool call end chunk
 */
export interface ToolCallEndChunk extends StreamChunkBase {
  type: 'tool_call_end';
  id: string;
  arguments: Record<string, unknown>;
}

/**
 * Done chunk
 */
export interface DoneChunk extends StreamChunkBase {
  type: 'done';
  finishReason: FinishReason;
  usage: TokenUsage;
  cost?: CostBreakdown;
}

/**
 * Error chunk
 */
export interface ErrorChunk extends StreamChunkBase {
  type: 'error';
  error: ProviderError;
}

/**
 * Union of all stream chunk types
 */
export type StreamChunk =
  | StartChunk
  | TextDeltaChunk
  | ToolCallStartChunk
  | ToolCallDeltaChunk
  | ToolCallEndChunk
  | DoneChunk
  | ErrorChunk;

// ============================================================================
// Provider Adapter Interface
// ============================================================================

/**
 * Capabilities that a provider may support
 */
export interface ProviderCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  jsonMode: boolean;
  functionCalling: boolean;
}

/**
 * Provider adapter interface
 * Each provider must implement this to work with Clasper
 */
export interface ProviderAdapter {
  // Identity
  name: string;
  displayName: string;
  
  // Capabilities
  capabilities: ProviderCapabilities;
  maxContextTokens: number;
  
  // Completion
  complete(request: CompletionRequest): Promise<NormalizedResponse>;
  
  // Streaming
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const NormalizedToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

export const NormalizedResponseSchema = z.object({
  content: z.string().nullable(),
  toolCalls: z.array(NormalizedToolCallSchema),
  usage: TokenUsageSchema,
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'content_filter', 'error']),
  model: z.string(),
  provider: z.string(),
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse error from provider response
 */
export function parseProviderError(
  error: unknown,
  provider: string
): ProviderError {
  if (error instanceof ProviderContractError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      provider: error.provider,
      originalError: error.originalError,
    };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Rate limit detection
    if (message.includes('rate') || message.includes('429') || message.includes('too many')) {
      return {
        code: 'rate_limit',
        message: error.message,
        retryable: true,
        retryAfterMs: 60000, // Default 1 minute
        provider,
        originalError: error,
      };
    }

    // Context length detection
    if (message.includes('context') || message.includes('token') || message.includes('length')) {
      return {
        code: 'context_length',
        message: error.message,
        retryable: false,
        provider,
        originalError: error,
      };
    }

    // Auth detection
    if (message.includes('auth') || message.includes('401') || message.includes('api key')) {
      return {
        code: 'auth',
        message: error.message,
        retryable: false,
        provider,
        originalError: error,
      };
    }

    // Timeout detection
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        code: 'timeout',
        message: error.message,
        retryable: true,
        provider,
        originalError: error,
      };
    }

    // Server error detection
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return {
        code: 'server',
        message: error.message,
        retryable: true,
        retryAfterMs: 5000,
        provider,
        originalError: error,
      };
    }
  }

  // Unknown error
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : 'Unknown error',
    retryable: false,
    provider,
    originalError: error,
  };
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: ProviderError): boolean {
  return error.retryable;
}

/**
 * Calculate total tokens from usage
 */
export function calculateTotalTokens(usage: Partial<TokenUsage>): number {
  return (usage.inputTokens || 0) + (usage.outputTokens || 0);
}

/**
 * Validate a response against the contract
 */
export function validateResponse(response: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = NormalizedResponseSchema.safeParse(response);
  
  if (result.success) {
    return { valid: true, errors: [] };
  }
  
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

/**
 * Create an empty/default response
 */
export function createEmptyResponse(
  model: string,
  provider: string
): NormalizedResponse {
  return {
    content: null,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
    model,
    provider,
  };
}

/**
 * Merge multiple responses (for retry scenarios)
 */
export function mergeResponses(responses: NormalizedResponse[]): NormalizedResponse {
  if (responses.length === 0) {
    throw new Error('Cannot merge empty response list');
  }
  
  if (responses.length === 1) {
    return responses[0];
  }
  
  const last = responses[responses.length - 1];
  const totalUsage: TokenUsage = {
    inputTokens: responses.reduce((sum, r) => sum + r.usage.inputTokens, 0),
    outputTokens: responses.reduce((sum, r) => sum + r.usage.outputTokens, 0),
    totalTokens: 0,
  };
  totalUsage.totalTokens = totalUsage.inputTokens + totalUsage.outputTokens;
  
  return {
    ...last,
    usage: totalUsage,
  };
}
