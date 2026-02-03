/**
 * Streaming support for agent responses.
 * Provides Server-Sent Events (SSE) streaming for real-time output.
 * 
 * Security enhancements inspired by OpenClaw 2026.2.1:
 * - Maximum streaming duration timeout
 * - Graceful AbortError handling
 */

import { config } from "../core/config.js";
import { type TokenUsage, type ConversationMessage } from "./openaiClient.js";
import { getWorkspaceLoader, type PromptMode } from "../workspace/workspace.js";
import { getUsageTracker, type CostBreakdown } from "../integrations/costs.js";
import { llmStream, type WombatStreamEvent } from "./llmProvider.js";
import { nowUTC } from "../security/index.js";
import type { FastifyReply } from "fastify";

/**
 * Maximum duration for a streaming response (in milliseconds).
 * Prevents indefinite hangs and resource exhaustion.
 * 
 * @see OpenClaw PR: "fix (#4954): add timeout to GatewayClient.request"
 */
const MAX_STREAMING_DURATION_MS = 120_000; // 2 minutes

/**
 * Streaming event types.
 */
export type StreamEventType = "start" | "chunk" | "done" | "error";

/**
 * Streaming event payload.
 */
export interface StreamEvent {
  type: StreamEventType;
  data?: string;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  error?: string;
}

/**
 * Format a streaming event for SSE.
 */
export function formatSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Generate a streaming agent reply.
 * Streams chunks via SSE to the reply object.
 * 
 * Security features:
 * - Maximum duration timeout (prevents indefinite hangs)
 * - Graceful AbortError handling during shutdown
 * - UTC timestamps on timeout events for debugging
 */
export async function streamAgentReply(
  reply: FastifyReply,
  params: {
    role: string;
    userMessage: string;
    messages?: ConversationMessage[];
    metadata?: Record<string, unknown> | null;
    promptMode?: PromptMode;
    timezone?: string;
    /** Maximum streaming duration in ms (default: 120000) */
    maxDurationMs?: number;
  }
): Promise<void> {
  const { 
    role, 
    userMessage, 
    messages = [], 
    metadata, 
    promptMode = "full", 
    timezone,
    maxDurationMs = MAX_STREAMING_DURATION_MS
  } = params;

  // Set SSE headers
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  // Track whether we've already ended the stream
  let streamEnded = false;
  
  // Set up maximum duration timeout to prevent indefinite hangs
  // @see OpenClaw PR: "fix (#4954): add timeout to GatewayClient.request"
  const timeoutId = setTimeout(() => {
    if (!streamEnded) {
      streamEnded = true;
      const timeoutError = `Stream timeout after ${maxDurationMs}ms ${nowUTC()}`;
      reply.raw.write(formatSSE({ type: "error", error: timeoutError }));
      reply.raw.end();
    }
  }, maxDurationMs);

  try {
    // Build system prompt
    const workspace = getWorkspaceLoader();
    let systemPrompt: string;

    if (metadata?.system_prompt) {
      systemPrompt = metadata.system_prompt as string;
    } else {
      systemPrompt = workspace.buildSystemPrompt(role, promptMode);

      const memoryContext = workspace.loadMemoryContext();
      if (memoryContext) {
        systemPrompt += "\n\n" + memoryContext;
      }
    }

    // Add time context if enabled
    if (config.includeTimeContext) {
      const timeContext = workspace.buildTimeContext(
        timezone || (metadata?.timezone as string | undefined)
      );
      systemPrompt += "\n\n" + timeContext;
    }

    // Build user prompt
    const kickoffNote =
      (metadata?.kickoff_note as string | undefined) ||
      "Draft a concise plan based on the user's request.";

    const prompt = metadata?.kickoff_plan
      ? `${kickoffNote}\n\nUser request: ${userMessage}`
      : userMessage;

    // Use multi-provider streaming
    const streamGenerator = llmStream({
      systemPrompt,
      messages,
      userMessage: prompt,
      model: config.llmModelDefault,
      temperature: 0.4
    });

    // Process streaming events
    for await (const event of streamGenerator) {
      // Check if stream was ended by timeout
      if (streamEnded) {
        break;
      }
      
      switch (event.type) {
        case "start":
          reply.raw.write(formatSSE({ type: "start" }));
          break;
        case "chunk":
          reply.raw.write(formatSSE({ type: "chunk", data: event.data }));
          break;
        case "done":
          if (event.usage) {
            getUsageTracker().track(event.usage, config.llmModelDefault);
          }
          reply.raw.write(formatSSE({ type: "done", usage: event.usage, cost: event.cost }));
          break;
        case "error":
          reply.raw.write(formatSSE({ type: "error", error: event.error }));
          break;
      }
    }
  } catch (error) {
    // Graceful AbortError handling during shutdown
    // @see OpenClaw PR: "fix(gateway): suppress AbortError during shutdown"
    if (error instanceof Error && error.name === 'AbortError') {
      // Silently handle abort - this is expected during shutdown
      if (!streamEnded) {
        reply.raw.write(formatSSE({ type: "error", error: `Stream aborted ${nowUTC()}` }));
      }
    } else {
      const message = error instanceof Error ? error.message : "Streaming failed";
      if (!streamEnded) {
        reply.raw.write(formatSSE({ type: "error", error: message }));
      }
    }
  } finally {
    // Clear the timeout
    clearTimeout(timeoutId);
    
    // End the stream if not already ended
    if (!streamEnded) {
      streamEnded = true;
      reply.raw.end();
    }
  }
}
