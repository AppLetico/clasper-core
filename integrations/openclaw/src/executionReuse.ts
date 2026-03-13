/**
 * Helpers for reusing pending execution IDs for the same request fingerprint.
 *
 * Governance intent:
 * - Reuse applies only to the same request shape (not broad "similar" requests).
 * - Entries are short-lived and adapter-local (in-memory).
 */

export interface InFlightExecution {
  executionId: string;
  createdAtMs: number;
}

export function normalizeTargets(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return [...new Set(normalized)];
}

function normalizeCommandClass(params: Record<string, unknown>): string {
  const commandRaw =
    typeof params.command === "string"
      ? params.command
      : typeof params.cmd === "string"
        ? params.cmd
        : "";
  const command = commandRaw.trim().toLowerCase();
  if (!command) return "none";

  const token = command.split(/\s+/)[0] || "";
  if (token === "npm" || token === "pnpm" || token === "yarn" || token === "bun") {
    return "package_manager";
  }
  if (token === "python" || token === "python3" || token === "node" || token === "tsx") {
    return "script_runtime";
  }
  if (token === "git") return "git";
  if (token === "curl" || token === "wget") return "network_cli";
  if (token === "ls" || token === "cat" || token === "cp" || token === "mv" || token === "rm") {
    return "shell_fs";
  }
  return token || "unknown";
}

export function extractSessionKey(context: Record<string, unknown>): string {
  // IMPORTANT: do not use per-call IDs (e.g. traceId) here; that breaks
  // same-request reuse across retries inside one user session.
  const candidates = [
    context.sessionKey,
    context.sessionId,
    context.agentId,
    context.threadId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "unknown-session";
}

export function buildRequestFingerprint(options: {
  adapterId: string;
  toolName: string;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
  mappedTargets?: unknown;
}): string {
  const sessionKey = extractSessionKey(options.context);
  const targetCandidates = normalizeTargets(options.mappedTargets ?? options.params.targets ?? options.params.paths);
  const targetKey = targetCandidates.length > 0 ? targetCandidates.join("|") : "no-target";
  const commandClass = normalizeCommandClass(options.params);

  return [
    options.adapterId,
    options.toolName,
    sessionKey,
    targetKey,
    commandClass,
  ].join("::");
}

export function getReusableExecutionId(
  cache: Map<string, InFlightExecution>,
  fingerprint: string,
  nowMs: number,
  reuseWindowMs: number
): string | null {
  const existing = cache.get(fingerprint);
  if (!existing) return null;
  if (nowMs - existing.createdAtMs > reuseWindowMs) {
    cache.delete(fingerprint);
    return null;
  }
  return existing.executionId;
}

export function setReusableExecutionId(
  cache: Map<string, InFlightExecution>,
  fingerprint: string,
  executionId: string,
  nowMs: number
): void {
  cache.set(fingerprint, { executionId, createdAtMs: nowMs });
}

export function clearReusableExecutionId(
  cache: Map<string, InFlightExecution>,
  fingerprint: string
): void {
  cache.delete(fingerprint);
}
