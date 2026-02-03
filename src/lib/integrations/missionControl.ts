/**
 * Mission Control Integration
 * 
 * Communicates with the backend Control Plane API.
 * 
 * Security enhancements inspired by OpenClaw 2026.2.1:
 * - Prompt injection sanitization for external content
 * - Request timeouts to prevent hangs
 */

import { config } from "../core/config.js";
import { sanitizeForPrompt, nowUTC } from "../security/index.js";

/** Default request timeout for Control Plane calls */
const REQUEST_TIMEOUT_MS = 30_000;

export type MissionControlMessage = {
  task_id: string;
  content: string;
  actor_type?: "agent" | "user";
  actor_id?: string;
  agent_role?: string;
  attachments?: Record<string, any> | null;
  idempotency_key?: string;
};

export type MissionControlDocument = {
  title: string;
  content: string;
  doc_type?: string;
  task_id?: string;
  idempotency_key?: string;
};

export type MissionControlTask = {
  id: string;
  title: string;
  status: string;
  description?: string;
};

/**
 * Sanitize task content before including in prompts.
 * Prevents prompt injection attacks via task titles/descriptions.
 * 
 * @see OpenClaw PR: "fix(security): prevent prompt injection via external hooks"
 */
export function sanitizeTaskForPrompt(task: MissionControlTask): MissionControlTask {
  const sanitizedTitle = sanitizeForPrompt(task.title, { source: 'task.title' });
  const sanitizedDesc = task.description 
    ? sanitizeForPrompt(task.description, { source: 'task.description' })
    : undefined;
  
  return {
    ...task,
    title: sanitizedTitle.content,
    description: sanitizedDesc?.content
  };
}

/**
 * Sanitize an array of tasks for safe prompt inclusion.
 */
export function sanitizeTasksForPrompt(tasks: MissionControlTask[]): MissionControlTask[] {
  return tasks.map(sanitizeTaskForPrompt);
}

/**
 * Helper to create a fetch request with timeout.
 * @see OpenClaw PR: "fix (#4954): add timeout to GatewayClient.request"
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms ${nowUTC()}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function listTasks(agentToken: string): Promise<MissionControlTask[]> {
  const resp = await fetchWithTimeout(
    `${config.backendUrl}/api/mission-control/tasks?limit=50`,
    { headers: { "X-Agent-Token": agentToken } }
  );
  if (!resp.ok) {
    throw new Error(`Failed to list tasks: ${resp.status}`);
  }
  const payload = await resp.json();
  return payload.items || [];
}

export async function createTask(agentToken: string, payload: {
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, any>;
}) {
  const resp = await fetchWithTimeout(
    `${config.backendUrl}/api/mission-control/tasks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Token": agentToken
      },
      body: JSON.stringify(payload)
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to create task: ${resp.status}`);
  }
  return resp.json();
}

export async function postMessage(agentToken: string, message: MissionControlMessage) {
  const resp = await fetchWithTimeout(
    `${config.backendUrl}/api/mission-control/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Token": agentToken
      },
      body: JSON.stringify(message)
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to post message: ${resp.status}`);
  }
  return resp.json();
}

export async function postDocument(agentToken: string, doc: MissionControlDocument) {
  const resp = await fetchWithTimeout(
    `${config.backendUrl}/api/mission-control/documents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Token": agentToken
      },
      body: JSON.stringify(doc)
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to post document: ${resp.status}`);
  }
  return resp.json();
}
