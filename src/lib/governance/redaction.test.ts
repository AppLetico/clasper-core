import { describe, it, expect, beforeEach } from 'vitest';
import {
  Redactor,
  getRedactor,
  resetRedactor,
  quickRedact,
  needsRedaction,
  DEFAULT_PATTERNS,
} from './redaction.js';

describe('Redaction', () => {
  beforeEach(() => {
    resetRedactor();
  });

  describe('Redactor', () => {
    it('should redact emails', () => {
      const redactor = new Redactor();
      const result = redactor.redact('Contact me at user@example.com');

      expect(result.redacted).toBe('Contact me at [EMAIL]');
      expect(result.hasRedactions).toBe(true);
      expect(result.redactions.length).toBe(1);
      expect(result.redactions[0].pattern).toBe('email');
    });

    it('should redact SSNs', () => {
      const redactor = new Redactor();
      const result = redactor.redact('SSN: 123-45-6789');

      expect(result.redacted).toBe('SSN: [SSN]');
      expect(result.hasRedactions).toBe(true);
    });

    it('should redact phone numbers', () => {
      const redactor = new Redactor();
      const result = redactor.redact('Call me at 555-123-4567');

      expect(result.redacted).toBe('Call me at [PHONE]');
      expect(result.hasRedactions).toBe(true);
    });

    it('should redact credit card numbers', () => {
      const redactor = new Redactor();
      const result = redactor.redact('Card: 4111-1111-1111-1111');

      expect(result.redacted).toBe('Card: [CREDIT_CARD]');
      expect(result.hasRedactions).toBe(true);
    });

    it('should redact multiple patterns', () => {
      const redactor = new Redactor();
      const result = redactor.redact(
        'Email: test@example.com, SSN: 123-45-6789'
      );

      expect(result.redacted).toBe('Email: [EMAIL], SSN: [SSN]');
      expect(result.redactions.length).toBe(2);
    });

    it('should not redact non-sensitive data', () => {
      const redactor = new Redactor();
      const result = redactor.redact('This is just regular text');

      expect(result.redacted).toBe('This is just regular text');
      expect(result.hasRedactions).toBe(false);
      expect(result.redactions.length).toBe(0);
    });

    it('should handle empty strings', () => {
      const redactor = new Redactor();
      const result = redactor.redact('');

      expect(result.redacted).toBe('');
      expect(result.hasRedactions).toBe(false);
    });

    it('should use hash strategy when configured', () => {
      const redactor = new Redactor({
        patterns: [
          {
            name: 'email',
            regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
            strategy: 'hash',
          },
        ],
        defaultStrategy: 'hash',
      });

      const result = redactor.redact('test@example.com');

      expect(result.redacted).toMatch(/^\[HASH:[a-f0-9]{8}\]$/);
    });

    it('should use drop strategy when configured', () => {
      const redactor = new Redactor({
        patterns: [
          {
            name: 'email',
            regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
            strategy: 'drop',
          },
        ],
        defaultStrategy: 'drop',
      });

      const result = redactor.redact('Contact: test@example.com here');

      expect(result.redacted).toBe('Contact:  here');
    });
  });

  describe('redactObject', () => {
    it('should recursively redact object values', () => {
      const redactor = new Redactor();
      const obj = {
        email: 'user@example.com',
        nested: {
          ssn: '123-45-6789',
        },
        array: ['phone: 555-123-4567'],
      };

      const result = redactor.redactObject(obj);

      expect(result).toEqual({
        email: '[EMAIL]',
        nested: {
          ssn: '[SSN]',
        },
        array: ['phone: [PHONE]'],
      });
    });

    it('should handle null and undefined', () => {
      const redactor = new Redactor();

      expect(redactor.redactObject(null)).toBeNull();
      expect(redactor.redactObject(undefined)).toBeUndefined();
    });

    it('should handle numbers and booleans', () => {
      const redactor = new Redactor();

      expect(redactor.redactObject(123)).toBe(123);
      expect(redactor.redactObject(true)).toBe(true);
    });
  });

  describe('containsSensitiveData', () => {
    it('should detect sensitive patterns', () => {
      const redactor = new Redactor();

      expect(redactor.containsSensitiveData('test@example.com')).toBe(true);
      expect(redactor.containsSensitiveData('123-45-6789')).toBe(true);
      expect(redactor.containsSensitiveData('regular text')).toBe(false);
    });
  });

  describe('detectPatterns', () => {
    it('should return matching pattern names', () => {
      const redactor = new Redactor();
      const patterns = redactor.detectPatterns(
        'Email: test@example.com, SSN: 123-45-6789'
      );

      expect(patterns).toContain('email');
      expect(patterns).toContain('ssn');
    });
  });

  describe('addPattern', () => {
    it('should add custom patterns', () => {
      const redactor = new Redactor();
      redactor.addPattern({
        name: 'custom_id',
        regex: /\bCUST-\d{6}\b/g,
        strategy: 'mask',
        replacement: '[CUSTOMER_ID]',
      });

      const result = redactor.redact('Customer: CUST-123456');

      expect(result.redacted).toBe('Customer: [CUSTOMER_ID]');
    });
  });

  describe('quickRedact', () => {
    it('should redact using default redactor', () => {
      const result = quickRedact('Email: test@example.com');

      expect(result).toBe('Email: [EMAIL]');
    });
  });

  describe('needsRedaction', () => {
    it('should detect if text needs redaction', () => {
      expect(needsRedaction('test@example.com')).toBe(true);
      expect(needsRedaction('regular text')).toBe(false);
    });
  });

  describe('DEFAULT_PATTERNS', () => {
    it('should have standard PII patterns', () => {
      const patternNames = DEFAULT_PATTERNS.map((p) => p.name);

      expect(patternNames).toContain('email');
      expect(patternNames).toContain('ssn');
      expect(patternNames).toContain('phone_us');
      expect(patternNames).toContain('credit_card');
      expect(patternNames).toContain('api_key');
    });
  });
});
