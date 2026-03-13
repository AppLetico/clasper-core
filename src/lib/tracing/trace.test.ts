import { describe, it, expect } from 'vitest';
import {
  TraceBuilder,
  generateTraceId,
  extractToolCallTraces,
  calculateUsageFromSteps,
  type TraceStep,
  type LLMCallStep,
  type ToolCallStep,
  type ToolResultStep,
} from './trace.js';

describe('Trace', () => {
  describe('generateTraceId', () => {
    it('should generate a valid UUID v7', () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('TraceBuilder', () => {
    it('should create a trace with required fields', () => {
      const builder = new TraceBuilder({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        model: 'gpt-4o',
        provider: 'openai',
        inputMessage: 'Hello world',
      });

      const trace = builder.getTrace();

      expect(trace.tenantId).toBe('tenant-1');
      expect(trace.workspaceId).toBe('workspace-1');
      expect(trace.model).toBe('gpt-4o');
      expect(trace.provider).toBe('openai');
      expect(trace.input.message).toBe('Hello world');
      expect(trace.id).toBeDefined();
      expect(trace.startedAt).toBeDefined();
    });

    it('should add LLM call steps', () => {
      const builder = new TraceBuilder({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        model: 'gpt-4o',
        provider: 'openai',
        inputMessage: 'Hello',
      });

      builder.addLLMCall(
        {
          model: 'gpt-4o',
          provider: 'openai',
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.01,
          hasToolCalls: false,
        },
        500
      );

      const trace = builder.getTrace();

      expect(trace.steps.length).toBe(1);
      expect(trace.steps[0].type).toBe('llm_call');
      expect(trace.steps[0].durationMs).toBe(500);
      expect(trace.usage.inputTokens).toBe(100);
      expect(trace.usage.outputTokens).toBe(50);
      expect(trace.usage.totalCost).toBe(0.01);
    });

    it('should add tool call and result steps', () => {
      const builder = new TraceBuilder({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        model: 'gpt-4o',
        provider: 'openai',
        inputMessage: 'Hello',
      });

      builder.addToolCall(
        {
          toolCallId: 'call-1',
          toolName: 'search',
          arguments: { query: 'test' },
          permitted: true,
        },
        0
      );

      builder.addToolResult(
        {
          toolCallId: 'call-1',
          toolName: 'search',
          success: true,
          result: { items: [] },
        },
        100
      );

      const trace = builder.getTrace();

      expect(trace.steps.length).toBe(2);
      expect(trace.steps[0].type).toBe('tool_call');
      expect(trace.steps[1].type).toBe('tool_result');
    });

    it('should complete trace with duration', () => {
      const builder = new TraceBuilder({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        model: 'gpt-4o',
        provider: 'openai',
        inputMessage: 'Hello',
      });

      const trace = builder.complete();

      expect(trace.completedAt).toBeDefined();
      expect(trace.durationMs).toBeDefined();
      expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should set output message and tool calls', () => {
      const builder = new TraceBuilder({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        model: 'gpt-4o',
        provider: 'openai',
        inputMessage: 'Hello',
      });

      builder.setOutput('Response message', [
        {
          id: 'call-1',
          name: 'search',
          arguments: {},
          result: {},
          durationMs: 100,
          permitted: true,
          success: true,
        },
      ]);

      const trace = builder.getTrace();

      expect(trace.output?.message).toBe('Response message');
      expect(trace.output?.toolCalls.length).toBe(1);
    });
  });

  describe('extractToolCallTraces', () => {
    it('should extract tool call traces from steps', () => {
      const steps: TraceStep[] = [
        {
          type: 'tool_call',
          timestamp: new Date().toISOString(),
          durationMs: 0,
          data: {
            toolCallId: 'call-1',
            toolName: 'search',
            arguments: { q: 'test' },
            permitted: true,
          } as ToolCallStep,
        },
        {
          type: 'tool_result',
          timestamp: new Date().toISOString(),
          durationMs: 100,
          data: {
            toolCallId: 'call-1',
            toolName: 'search',
            success: true,
            result: { data: [] },
          } as ToolResultStep,
        },
      ];

      const toolCalls = extractToolCallTraces(steps);

      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].id).toBe('call-1');
      expect(toolCalls[0].name).toBe('search');
      expect(toolCalls[0].success).toBe(true);
      expect(toolCalls[0].durationMs).toBe(100);
    });
  });

  describe('calculateUsageFromSteps', () => {
    it('should calculate total usage from LLM steps', () => {
      const steps: TraceStep[] = [
        {
          type: 'llm_call',
          timestamp: new Date().toISOString(),
          durationMs: 100,
          data: {
            model: 'gpt-4o',
            provider: 'openai',
            inputTokens: 100,
            outputTokens: 50,
            cost: 0.01,
            hasToolCalls: false,
          } as LLMCallStep,
        },
        {
          type: 'llm_call',
          timestamp: new Date().toISOString(),
          durationMs: 100,
          data: {
            model: 'gpt-4o',
            provider: 'openai',
            inputTokens: 200,
            outputTokens: 100,
            cost: 0.02,
            hasToolCalls: false,
          } as LLMCallStep,
        },
      ];

      const usage = calculateUsageFromSteps(steps);

      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.totalCost).toBe(0.03);
    });
  });
});
