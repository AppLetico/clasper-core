import type { AgentTrace, TraceStep } from './trace.js';
import { sha256Json, formatSha256 } from '../security/sha256.js';
import type { JsonValue } from '../security/stableJson.js';

export type TraceIntegrityStatus =
  | 'verified'
  | 'compromised'
  | 'unsigned'
  | 'unverified';

export interface TraceIntegrityResult {
  status: TraceIntegrityStatus;
  failures: string[];
}

function buildStepPayload(step: TraceStep): JsonValue {
  return {
    step_id: step.step_id || null,
    prev_step_hash: step.prev_step_hash ?? null,
    type: step.type,
    timestamp: step.timestamp,
    durationMs: step.durationMs,
    data: step.data as unknown as JsonValue,
  };
}

function computeStepHash(step: TraceStep): string {
  const payload = buildStepPayload(step);
  return formatSha256(sha256Json(payload));
}

export function verifyTraceIntegrity(trace: AgentTrace): TraceIntegrityResult {
  const failures: string[] = [];
  const steps = trace.steps || [];

  if (steps.length === 0) {
    return { status: 'unverified', failures: ['no_steps'] };
  }

  const hasAnyHash = steps.some((step) => !!step.step_hash);
  if (!hasAnyHash) {
    return { status: 'unsigned', failures: ['missing_step_hashes'] };
  }

  let prevHash: string | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const expectedPrev = i === 0 ? null : prevHash;

    if (!step.step_hash) {
      failures.push(`step_${i}_missing_hash`);
      prevHash = step.step_hash || null;
      continue;
    }

    if (step.prev_step_hash !== expectedPrev) {
      failures.push(`step_${i}_prev_hash_mismatch`);
    }

    const computed = computeStepHash(step);
    if (computed !== step.step_hash) {
      failures.push(`step_${i}_hash_mismatch`);
    }

    prevHash = step.step_hash;
  }

  if (failures.length > 0) {
    return { status: 'compromised', failures };
  }

  return { status: 'verified', failures: [] };
}
