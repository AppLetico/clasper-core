import { v7 as uuidv7 } from 'uuid';
import { TraceBuilder } from '../tracing/trace.js';
import { ingestCost, ingestMetrics, ingestTrace } from './ingest.js';
import { evaluateExecutionDecision } from '../governance/executionDecision.js';
import { generateAgentReply, type AgentReplyResult } from '../providers/openaiClient.js';
import { config } from '../core/config.js';

export const BUILTIN_RUNTIME_ADAPTER_ID = 'builtin_runtime';

export interface BuiltinRuntimeRequest {
  tenant_id: string;
  workspace_id: string;
  user_message: string;
  messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  metadata?: Record<string, any> | null;
  role: string;
}

export interface BuiltinRuntimeResult {
  execution_id: string;
  trace_id: string;
  response: string;
  usage: AgentReplyResult['usage'];
  cost: AgentReplyResult['cost'];
  context_warning?: string;
}

export async function runBuiltinRuntime(
  request: BuiltinRuntimeRequest
): Promise<BuiltinRuntimeResult> {
  const executionId = uuidv7();
  const traceId = uuidv7();

  const decision = evaluateExecutionDecision({
    execution_id: executionId,
    tenant_id: request.tenant_id,
    workspace_id: request.workspace_id,
    adapter_id: BUILTIN_RUNTIME_ADAPTER_ID,
    requested_capabilities: ['llm'],
    tool_count: 0,
  });

  if (!decision.allowed) {
    throw new Error(decision.blocked_reason || 'execution_blocked');
  }

  const traceBuilder = new TraceBuilder({
    tenantId: request.tenant_id,
    workspaceId: request.workspace_id,
    model: config.llmModelDefault,
    provider: config.llmProvider,
    agentRole: request.role,
    inputMessage: request.user_message,
    messageHistory: request.messages?.length || 0,
  });

  const llmStart = Date.now();
  const rawResult = await generateAgentReply({
    role: request.role,
    userMessage: request.user_message,
    messages: request.messages,
    metadata: request.metadata,
  });
  const result = normalizeAgentReply(rawResult);
  const llmDuration = Date.now() - llmStart;

  traceBuilder.addLLMCall(
    {
      model: config.llmModelDefault,
      provider: config.llmProvider,
      inputTokens: result.usage.prompt_tokens,
      outputTokens: result.usage.completion_tokens,
      cost: result.cost.totalCost,
      hasToolCalls: false,
    },
    llmDuration
  );

  traceBuilder.setOutput(result.response, []);

  const trace = traceBuilder.complete();
  trace.id = traceId;
  trace.adapter_id = BUILTIN_RUNTIME_ADAPTER_ID;
  trace.granted_scope = decision.granted_scope;
  trace.used_scope = {
    capabilities: decision.granted_scope?.capabilities || [],
    step_count: 1,
    actual_cost: result.cost.totalCost,
  };

  ingestTrace({
    tenant_id: request.tenant_id,
    workspace_id: request.workspace_id,
    execution_id: executionId,
    trace_id: traceId,
    adapter_id: BUILTIN_RUNTIME_ADAPTER_ID,
    trace,
  });

  ingestCost({
    tenant_id: request.tenant_id,
    workspace_id: request.workspace_id,
    execution_id: executionId,
    trace_id: traceId,
    adapter_id: BUILTIN_RUNTIME_ADAPTER_ID,
    cost_usd: result.cost.totalCost,
    input_tokens: result.usage.prompt_tokens,
    output_tokens: result.usage.completion_tokens,
    model: result.cost.model,
    provider: config.llmProvider,
    recorded_at: new Date().toISOString(),
  });

  ingestMetrics({
    tenant_id: request.tenant_id,
    workspace_id: request.workspace_id,
    execution_id: executionId,
    trace_id: traceId,
    adapter_id: BUILTIN_RUNTIME_ADAPTER_ID,
    step_count: 1,
    duration_ms: trace.durationMs || 0,
    recorded_at: new Date().toISOString(),
  });

  return {
    execution_id: executionId,
    trace_id: traceId,
    response: result.response,
    usage: result.usage,
    cost: result.cost,
    context_warning: result.contextWarning,
  };
}

function normalizeAgentReply(result: AgentReplyResult | string): AgentReplyResult {
  if (typeof result === 'string') {
    return {
      response: result,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      cost: {
        model: config.llmModelDefault,
        inputTokens: 0,
        outputTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: 'USD',
      },
    };
  }

  if (!result.usage) {
    result.usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
  }

  if (!result.cost) {
    result.cost = {
      model: config.llmModelDefault,
      inputTokens: 0,
      outputTokens: 0,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  return result;
}
