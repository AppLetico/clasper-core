import { describe, it, expect } from 'vitest';
import {
  computeGovernanceStatus,
  hasFallbackPolicy,
  type GovernanceMode,
} from './governanceMode.js';

describe('governanceMode', () => {
  describe('computeGovernanceStatus', () => {
    it('strict => ENFORCED', () => {
      expect(computeGovernanceStatus('strict', false)).toBe('ENFORCED');
      expect(computeGovernanceStatus('strict', true)).toBe('ENFORCED');
    });
    it('permissive => DISABLED', () => {
      expect(computeGovernanceStatus('permissive', false)).toBe('DISABLED');
      expect(computeGovernanceStatus('permissive', true)).toBe('DISABLED');
    });
    it('guarded + fallback present => ENFORCED', () => {
      expect(computeGovernanceStatus('guarded', true)).toBe('ENFORCED');
    });
    it('guarded + fallback missing => DEGRADED', () => {
      expect(computeGovernanceStatus('guarded', false)).toBe('DEGRADED');
    });
  });

  describe('hasFallbackPolicy', () => {
    it('returns true when subject type tool, no name, precedence <= 0', () => {
      expect(
        hasFallbackPolicy([
          {
            policy_id: 'fb',
            subject: { type: 'tool' },
            effect: { decision: 'require_approval' },
            precedence: -100,
          },
        ])
      ).toBe(true);
    });
    it('returns false when subject has name', () => {
      expect(
        hasFallbackPolicy([
          {
            policy_id: 'fb',
            subject: { type: 'tool', name: 'exec' },
            effect: { decision: 'require_approval' },
            precedence: -100,
          },
        ])
      ).toBe(false);
    });
    it('returns false when precedence > 0', () => {
      expect(
        hasFallbackPolicy([
          {
            policy_id: 'fb',
            subject: { type: 'tool' },
            effect: { decision: 'require_approval' },
            precedence: 10,
          },
        ])
      ).toBe(false);
    });
    it('returns false for empty policies', () => {
      expect(hasFallbackPolicy([])).toBe(false);
    });
  });
});
