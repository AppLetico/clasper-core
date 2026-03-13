import { describe, it, expect } from 'vitest';
import { normalizeToolName, toolNamesMatch } from './toolIdentity.js';

describe('toolIdentity', () => {
  describe('normalizeToolName', () => {
    it('replaces hyphens with dots', () => {
      expect(normalizeToolName('shell-exec')).toBe('shell.exec');
    });
    it('replaces underscores with dots', () => {
      expect(normalizeToolName('shell_exec')).toBe('shell.exec');
    });
    it('handles empty and whitespace', () => {
      expect(normalizeToolName('')).toBe('');
      expect(normalizeToolName('  ')).toBe('');
    });
    it('trims input', () => {
      expect(normalizeToolName('  exec  ')).toBe('exec');
    });
    it('leaves already-normalized names unchanged', () => {
      expect(normalizeToolName('shell.exec')).toBe('shell.exec');
    });
  });

  describe('toolNamesMatch', () => {
    it('matches after normalization', () => {
      expect(toolNamesMatch('shell.exec', 'shell_exec')).toBe(true);
      expect(toolNamesMatch('shell-exec', 'shell.exec')).toBe(true);
    });
    it('returns false for different tools', () => {
      expect(toolNamesMatch('exec', 'read')).toBe(false);
    });
  });
});
