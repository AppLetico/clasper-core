import type { AgentTrace } from './trace.js';

export type TrustStatus =
  | 'verified'
  | 'verified_with_violations'
  | 'unverified'
  | 'compromised';

export function resolveTrustStatus(trace: Pick<
  AgentTrace,
  'integrity_status' | 'integrity_failures' | 'violations'
>): TrustStatus {
  const integrity = trace.integrity_status || 'unverified';
  if (integrity === 'compromised') {
    return 'compromised';
  }

  if (integrity !== 'verified') {
    return 'unverified';
  }

  const hasViolations = (trace.violations || []).length > 0;
  return hasViolations ? 'verified_with_violations' : 'verified';
}
