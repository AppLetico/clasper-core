import { describe, it, expect } from 'vitest';
import { resolveTrustStatus } from './trustStatus.js';

describe('resolveTrustStatus', () => {
  it('returns verified when integrity ok and no violations', () => {
    const status = resolveTrustStatus({
      integrity_status: 'verified',
      integrity_failures: [],
      violations: [],
    });
    expect(status).toBe('verified');
  });

  it('returns verified_with_violations when integrity ok and violations present', () => {
    const status = resolveTrustStatus({
      integrity_status: 'verified',
      integrity_failures: [],
      violations: [{ type: 'tool_violation', message: 'x', timestamp: 't' }],
    });
    expect(status).toBe('verified_with_violations');
  });

  it('returns compromised when integrity compromised', () => {
    const status = resolveTrustStatus({
      integrity_status: 'compromised',
      integrity_failures: ['step_1_hash_mismatch'],
      violations: [],
    });
    expect(status).toBe('compromised');
  });

  it('returns unverified when integrity missing or unsigned', () => {
    const unsignedStatus = resolveTrustStatus({
      integrity_status: 'unsigned',
      integrity_failures: ['missing_step_hashes'],
      violations: [],
    });
    expect(unsignedStatus).toBe('unverified');
  });
});
