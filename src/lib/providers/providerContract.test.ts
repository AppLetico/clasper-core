import { describe, it, expect } from 'vitest';
import {
  parseProviderError,
  isRetryableError,
  calculateTotalTokens,
  validateResponse,
  createEmptyResponse,
  mergeResponses,
  ProviderContractError,
  type ProviderError,
  type NormalizedResponse,
} from './providerContract.js';

describe('ProviderContract', () => {
  describe('parseProviderError', () => {
    it('should parse rate limit errors', () => {
      const error = new Error('Rate limit exceeded');
      const parsed = parseProviderError(error, 'openai');

      expect(parsed.code).toBe('rate_limit');
      expect(parsed.retryable).toBe(true);
      expect(parsed.provider).toBe('openai');
    });

    it('should parse context length errors', () => {
      const error = new Error('Maximum context length exceeded');
      const parsed = parseProviderError(error, 'openai');

      expect(parsed.code).toBe('context_length');
      expect(parsed.retryable).toBe(false);
    });

    it('should parse auth errors', () => {
      const error = new Error('Invalid API key');
      const parsed = parseProviderError(error, 'anthropic');

      expect(parsed.code).toBe('auth');
      expect(parsed.retryable).toBe(false);
    });

    it('should parse timeout errors', () => {
      const error = new Error('Request timed out');
      const parsed = parseProviderError(error, 'openai');

      expect(parsed.code).toBe('timeout');
      expect(parsed.retryable).toBe(true);
    });

    it('should parse server errors', () => {
      const error = new Error('502 Bad Gateway');
      const parsed = parseProviderError(error, 'openai');

      expect(parsed.code).toBe('server');
      expect(parsed.retryable).toBe(true);
    });

    it('should handle ProviderContractError', () => {
      const contractError = new ProviderContractError({
        code: 'rate_limit',
        message: 'Too many requests',
        retryable: true,
        retryAfterMs: 1000,
        provider: 'openai',
      });

      const parsed = parseProviderError(contractError, 'openai');

      expect(parsed.code).toBe('rate_limit');
      expect(parsed.retryAfterMs).toBe(1000);
    });

    it('should return unknown for unrecognized errors', () => {
      const error = new Error('Something weird happened');
      const parsed = parseProviderError(error, 'openai');

      expect(parsed.code).toBe('unknown');
      expect(parsed.retryable).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable errors', () => {
      const error: ProviderError = {
        code: 'rate_limit',
        message: 'Rate limited',
        retryable: true,
        provider: 'openai',
      };

      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error: ProviderError = {
        code: 'auth',
        message: 'Invalid key',
        retryable: false,
        provider: 'openai',
      };

      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('calculateTotalTokens', () => {
    it('should sum input and output tokens', () => {
      expect(calculateTotalTokens({ inputTokens: 100, outputTokens: 50 })).toBe(150);
    });

    it('should handle missing values', () => {
      expect(calculateTotalTokens({})).toBe(0);
      expect(calculateTotalTokens({ inputTokens: 100 })).toBe(100);
    });
  });

  describe('validateResponse', () => {
    it('should validate correct response', () => {
      const response: NormalizedResponse = {
        content: 'Hello',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        model: 'gpt-4o',
        provider: 'openai',
      };

      const result = validateResponse(response);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid response', () => {
      const response = {
        content: 'Hello',
        // Missing required fields
      };

      const result = validateResponse(response);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('createEmptyResponse', () => {
    it('should create empty response with defaults', () => {
      const response = createEmptyResponse('gpt-4o', 'openai');

      expect(response.content).toBeNull();
      expect(response.toolCalls).toEqual([]);
      expect(response.usage.inputTokens).toBe(0);
      expect(response.finishReason).toBe('stop');
      expect(response.model).toBe('gpt-4o');
      expect(response.provider).toBe('openai');
    });
  });

  describe('mergeResponses', () => {
    it('should merge multiple responses', () => {
      const responses: NormalizedResponse[] = [
        {
          content: 'Part 1',
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          finishReason: 'length',
          model: 'gpt-4o',
          provider: 'openai',
        },
        {
          content: 'Part 2',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
          finishReason: 'stop',
          model: 'gpt-4o',
          provider: 'openai',
        },
      ];

      const merged = mergeResponses(responses);

      expect(merged.content).toBe('Part 2'); // Uses last response content
      expect(merged.usage.inputTokens).toBe(150);
      expect(merged.usage.outputTokens).toBe(75);
      expect(merged.finishReason).toBe('stop'); // Uses last response
    });

    it('should throw for empty array', () => {
      expect(() => mergeResponses([])).toThrow();
    });

    it('should return single response unchanged', () => {
      const response: NormalizedResponse = {
        content: 'Hello',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        model: 'gpt-4o',
        provider: 'openai',
      };

      const merged = mergeResponses([response]);

      expect(merged).toEqual(response);
    });
  });
});
