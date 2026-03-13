/**
 * Approval polling — wait for a pending decision to be resolved.
 *
 * Polls GET /api/execution/:id every interval until:
 *  - Approved → returns (execution proceeds)
 *  - Denied → throws (execution blocked)
 *  - Timeout → throws (fail-closed)
 */

import type { ClasperClient } from './clasperClient.js';
import type { LogFn } from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ApprovalOptions {
  /** Approval timeout in ms (default: 5 minutes). */
  timeoutMs?: number;
  /** Polling interval in ms (default: 2000). */
  pollIntervalMs?: number;
  /** Logger. */
  log: LogFn;
  /** Decision ID for logging. */
  decisionId?: string;
  /** Clasper Ops Console approvals URL (e.g. http://localhost:8082/ops#approvals) for user-facing hints. */
  approvalsUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_POLL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

/**
 * Block until a pending decision is resolved.
 * Throws on denial, timeout, or Clasper unreachable (fail-closed).
 */
export async function waitForApproval(
  client: ClasperClient,
  executionId: string,
  options: ApprovalOptions
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const log = options.log;
  const decisionId = options.decisionId ?? 'unknown';
  const approvalsUrl = options.approvalsUrl;
  const hint = approvalsUrl
    ? ` Approve or deny at ${approvalsUrl}`
    : ' Approve or deny in Clasper Ops Console (Approvals tab)';

  const deadline = Date.now() + timeoutMs;
  let pollCount = 0;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    pollCount++;

    let status;
    try {
      status = await client.getDecisionStatus(executionId);
    } catch (err) {
      // Fail-closed: if we can't reach Clasper, block.
      log(
        `[clasper] Approval poll failed (decision_id=${decisionId}): ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
      throw new Error(
        `[clasper] Approval check failed — Clasper unreachable. ` +
        `Fail-closed: execution blocked. (decision_id=${decisionId})`
      );
    }

    if (status.effect === 'allow') {
      return; // Approved — proceed with execution
    }

    if (status.effect === 'deny') {
      throw new Error(
        `[clasper] Approval denied for decision_id=${decisionId}. Execution blocked.`
      );
    }

    // Still pending — continue polling
    if (pollCount % 5 === 0) {
      const remainingSec = Math.round((deadline - Date.now()) / 1000);
      log(
        `[clasper] Still awaiting approval (decision_id=${decisionId}, ` +
        `polls=${pollCount}, remaining=${remainingSec}s).${hint}`
      );
    }
  }

  // Timeout — fail closed
  throw new Error(
    `[clasper] Approval still pending after ${Math.round(timeoutMs / 1000)}s ` +
    `(decision_id=${decisionId}).${hint} Then retry the action.`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
