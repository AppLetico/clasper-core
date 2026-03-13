/**
 * Governance mode and status semantics.
 *
 * ## Governance Modes
 * - **permissive**: No-match => allow (current default). Status: DISABLED.
 * - **guarded**: No-match requires fallback policy; if fallback missing => block with governance outcome. Status: ENFORCED when fallback present, DEGRADED when missing.
 * - **strict**: No-match => deny. Status: ENFORCED.
 *
 * ## Status Semantics (source-of-truth for contributors)
 * - **ENFORCED**: Mode is active and fallback (if required) is present. Decisions are governed.
 * - **DEGRADED**: guarded mode but fallback policy missing. Some requests may be blocked.
 * - **DISABLED**: permissive mode; no-match allows. No governance guarantee.
 */
import type { PolicyObject } from '../policy/policySchema.js';

export type GovernanceMode = 'permissive' | 'guarded' | 'strict';

export type GovernanceStatus = 'ENFORCED' | 'DEGRADED' | 'DISABLED';

/**
 * Deterministic status computation for API/CLI/tests.
 * - strict => ENFORCED
 * - guarded + fallback present => ENFORCED
 * - guarded + fallback missing => DEGRADED
 * - permissive => DISABLED
 */
export function computeGovernanceStatus(
  mode: GovernanceMode,
  fallbackPresent: boolean
): GovernanceStatus {
  if (mode === 'strict') return 'ENFORCED';
  if (mode === 'permissive') return 'DISABLED';
  return fallbackPresent ? 'ENFORCED' : 'DEGRADED';
}

/**
 * Heuristic: a policy acts as fallback if it matches any tool and has low precedence.
 * Typical fallback: subject.type === 'tool', no subject.name, precedence <= 0.
 */
export function hasFallbackPolicy(policies: PolicyObject[]): boolean {
  return policies.some((p) => {
    const subject = p.subject;
    if (subject?.type !== 'tool') return false;
    if (subject.name) return false;
    const prec = p.precedence ?? 0;
    return prec <= 0;
  });
}
