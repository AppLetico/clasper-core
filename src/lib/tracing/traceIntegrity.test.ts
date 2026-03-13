import { describe, it, expect } from 'vitest';
import { verifyTraceIntegrity } from './traceIntegrity.js';
import type { AgentTrace, TraceStep } from './trace.js';
import { sha256Json, formatSha256 } from '../security/sha256.js';
import type { JsonValue } from '../security/stableJson.js';

function hashStep(step: TraceStep): string {
  return formatSha256(
    sha256Json({
      step_id: step.step_id || null,
      prev_step_hash: step.prev_step_hash ?? null,
      type: step.type,
      timestamp: step.timestamp,
      durationMs: step.durationMs,
      data: step.data as unknown as JsonValue,
    })
  );
}

function buildTrace(steps: TraceStep[]): AgentTrace {
  return {
    id: 'trace-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    startedAt: new Date().toISOString(),
    skillVersions: {},
    model: 'gpt-4o',
    provider: 'openai',
    input: { message: 'hi', messageHistory: 0 },
    steps,
    usage: { inputTokens: 1, outputTokens: 1, totalCost: 0 },
  };
}

describe('Trace integrity', () => {
  it('verifies a valid hash chain', () => {
    const step1: TraceStep = {
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      durationMs: 1,
      data: { toolCallId: '1', toolName: 'fs.read', arguments: {}, permitted: true },
      step_id: 'step-1',
      prev_step_hash: null,
    };
    step1.step_hash = hashStep(step1);

    const step2: TraceStep = {
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      durationMs: 1,
      data: { toolCallId: '1', toolName: 'fs.read', success: true, result: {} },
      step_id: 'step-2',
      prev_step_hash: step1.step_hash,
    };
    step2.step_hash = hashStep(step2);

    const trace = buildTrace([step1, step2]);
    const result = verifyTraceIntegrity(trace);
    expect(result.status).toBe('verified');
    expect(result.failures.length).toBe(0);
  });

  it('detects hash mismatches', () => {
    const step1: TraceStep = {
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      durationMs: 1,
      data: { toolCallId: '1', toolName: 'fs.read', arguments: {}, permitted: true },
      step_id: 'step-1',
      prev_step_hash: null,
      step_hash: 'sha256:deadbeef',
    };
    const trace = buildTrace([step1]);
    const result = verifyTraceIntegrity(trace);
    expect(result.status).toBe('compromised');
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
