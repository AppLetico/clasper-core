import { describe, it, expect } from 'vitest';
import {
  parseSkillManifest,
  validateSkillManifest,
  formatSkillForPrompt,
  skillToOpenAITool,
  calculateSkillChecksum,
  checkSkillGates,
  type SkillManifest,
} from './skillManifest.js';

describe('SkillManifest', () => {
  const validManifest = `
name: ticket_summarizer
version: 1.0.0
description: Summarizes support tickets

inputs:
  ticket_id:
    type: string
    required: true
    description: The ticket ID to summarize

outputs:
  summary:
    type: string
    description: One-paragraph summary
  sentiment:
    type: enum
    values: [positive, neutral, negative]

permissions:
  tools:
    - read_ticket
    - get_customer

instructions: |
  You are a support ticket analyst.
  Summarize the ticket concisely.

tests:
  - name: happy_path
    input:
      ticket_id: "TICKET-123"
    expect:
      sentiment: negative
`;

  describe('parseSkillManifest', () => {
    it('should parse valid YAML manifest', () => {
      const manifest = parseSkillManifest(validManifest);

      expect(manifest.name).toBe('ticket_summarizer');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.description).toBe('Summarizes support tickets');
      expect(manifest.inputs?.ticket_id.type).toBe('string');
      expect(manifest.outputs?.sentiment.type).toBe('enum');
      expect(manifest.permissions?.tools).toContain('read_ticket');
      expect(manifest.tests?.length).toBe(1);
    });

    it('should reject invalid name format', () => {
      const invalid = `
name: Invalid-Name-With-Caps
version: 1.0.0
description: Test
instructions: Test
`;
      expect(() => parseSkillManifest(invalid)).toThrow();
    });

    it('should reject invalid version format', () => {
      const invalid = `
name: test_skill
version: v1
description: Test
instructions: Test
`;
      expect(() => parseSkillManifest(invalid)).toThrow();
    });
  });

  describe('validateSkillManifest', () => {
    it('should validate correct manifest', () => {
      const manifest = parseSkillManifest(validManifest);
      const result = validateSkillManifest(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report missing required fields', () => {
      const result = validateSkillManifest({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('formatSkillForPrompt', () => {
    it('should format manifest for prompt injection', () => {
      const manifest = parseSkillManifest(validManifest);
      const formatted = formatSkillForPrompt(manifest);

      expect(formatted).toContain('ticket_summarizer');
      expect(formatted).toContain('v1.0.0');
      expect(formatted).toContain('Inputs:');
      expect(formatted).toContain('Outputs:');
      expect(formatted).toContain('Allowed tools:');
      expect(formatted).toContain('Instructions:');
    });
  });

  describe('skillToOpenAITool', () => {
    it('should convert skill to OpenAI tool format', () => {
      const manifest = parseSkillManifest(validManifest);
      const tool = skillToOpenAITool(manifest);

      expect(tool).not.toBeNull();
      expect(tool?.type).toBe('function');
      expect(tool?.function.name).toBe('ticket_summarizer');
      expect(tool?.function.parameters.properties).toHaveProperty('ticket_id');
      expect(tool?.function.parameters.required).toContain('ticket_id');
    });

    it('should return null for skill without inputs', () => {
      const manifest: SkillManifest = {
        name: 'no_inputs',
        version: '1.0.0',
        description: 'Test',
        instructions: 'Test',
      };
      const tool = skillToOpenAITool(manifest);

      expect(tool).toBeNull();
    });
  });

  describe('calculateSkillChecksum', () => {
    it('should calculate consistent checksum', () => {
      const manifest = parseSkillManifest(validManifest);
      const checksum1 = calculateSkillChecksum(manifest);
      const checksum2 = calculateSkillChecksum(manifest);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(16);
    });

    it('should generate different checksums for different manifests', () => {
      const manifest1 = parseSkillManifest(validManifest);
      const manifest2: SkillManifest = {
        ...manifest1,
        version: '2.0.0',
      };

      const checksum1 = calculateSkillChecksum(manifest1);
      const checksum2 = calculateSkillChecksum(manifest2);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('checkSkillGates', () => {
    it('should return enabled for skill without gates', () => {
      const manifest: SkillManifest = {
        name: 'no_gates',
        version: '1.0.0',
        description: 'Test',
        instructions: 'Test',
      };
      const result = checkSkillGates(manifest);

      expect(result.enabled).toBe(true);
    });

    it('should return enabled for gates with always: true', () => {
      const manifest: SkillManifest = {
        name: 'always_on',
        version: '1.0.0',
        description: 'Test',
        instructions: 'Test',
        gates: {
          always: true,
        },
      };
      const result = checkSkillGates(manifest);

      expect(result.enabled).toBe(true);
    });

    it('should check for required env vars', () => {
      const manifest: SkillManifest = {
        name: 'needs_env',
        version: '1.0.0',
        description: 'Test',
        instructions: 'Test',
        gates: {
          env: ['DEFINITELY_NOT_SET_VAR_12345'],
        },
      };
      const result = checkSkillGates(manifest);

      expect(result.enabled).toBe(false);
      expect(result.reason).toContain('Missing env var');
    });
  });
});
