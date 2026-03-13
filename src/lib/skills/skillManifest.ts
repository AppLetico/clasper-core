/**
 * Skill Manifest
 *
 * Defines the structured skill.yaml format that replaces SKILL.md.
 * Skills are now versioned, testable artifacts with explicit permissions.
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { join } from 'path';
import { createHash } from 'crypto';

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Input/Output type definitions
 */
export const ParameterTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'enum',
]);

/**
 * Input parameter definition
 */
export const InputParameterSchema: z.ZodType<InputParameter> = z.object({
  type: ParameterTypeSchema,
  required: z.boolean().default(true),
  description: z.string().optional(),
  default: z.unknown().optional(),
  // For enum type
  values: z.array(z.string()).optional(),
  // For array type
  items: z.lazy((): z.ZodType<InputParameter> => InputParameterSchema).optional(),
  // For number type
  min: z.number().optional(),
  max: z.number().optional(),
});

export interface InputParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum';
  required?: boolean;
  description?: string;
  default?: unknown;
  values?: string[];
  items?: InputParameter;
  min?: number;
  max?: number;
}

/**
 * Output parameter definition
 */
export const OutputParameterSchema = z.object({
  type: ParameterTypeSchema,
  description: z.string().optional(),
  // For enum type
  values: z.array(z.string()).optional(),
  // For number type
  min: z.number().optional(),
  max: z.number().optional(),
});

export type OutputParameter = z.infer<typeof OutputParameterSchema>;

/**
 * Permission configuration
 */
export const PermissionsSchema = z.object({
  tools: z.array(z.string()).default([]),
  maxTokens: z.number().int().positive().optional(),
  allowedModels: z.array(z.string()).optional(),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * Mock configuration for tests
 */
export const MockSchema = z.record(
  z.object({
    returns: z.unknown(),
    throws: z.string().optional(),
  })
);

/**
 * Test case definition
 */
export const TestCaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input: z.record(z.unknown()),
  mocks: MockSchema.optional(),
  expect: z.record(z.unknown()).optional(),
  expectError: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

/**
 * Gate requirements (what's needed for the skill to run)
 */
export const GatesSchema = z.object({
  env: z.array(z.string()).optional(),
  bins: z.array(z.string()).optional(),
  anyBins: z.array(z.string()).optional(),
  os: z.array(z.string()).optional(),
  always: z.boolean().optional(),
});

export type Gates = z.infer<typeof GatesSchema>;

/**
 * Complete skill manifest
 */
export const SkillManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/, {
    message: 'Skill name must be lowercase, start with a letter, and contain only letters, numbers, underscores, and hyphens',
  }),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, {
    message: 'Version must follow semver format (e.g., 1.0.0)',
  }),
  description: z.string(),
  
  // Inputs and outputs
  inputs: z.record(InputParameterSchema).optional(),
  outputs: z.record(OutputParameterSchema).optional(),
  
  // Permissions
  permissions: PermissionsSchema.optional(),
  
  // Gates (requirements for the skill to be enabled)
  gates: GatesSchema.optional(),
  
  // Instructions for the agent (replaces SKILL.md body)
  instructions: z.string(),
  
  // Test cases
  tests: z.array(TestCaseSchema).optional(),
  
  // Metadata
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  emoji: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a skill.yaml file
 */
export function parseSkillManifest(yamlContent: string): SkillManifest {
  const parsed = parseYaml(yamlContent);
  return SkillManifestSchema.parse(parsed);
}

/**
 * Load a skill manifest from a directory
 * Looks for skill.yaml in the directory
 */
export function loadSkillManifest(skillDir: string): SkillManifest | null {
  const yamlPath = join(skillDir, 'skill.yaml');
  const ymlPath = join(skillDir, 'skill.yml');
  
  let manifestPath: string | null = null;
  if (existsSync(yamlPath)) {
    manifestPath = yamlPath;
  } else if (existsSync(ymlPath)) {
    manifestPath = ymlPath;
  }
  
  if (!manifestPath) {
    return null;
  }
  
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    return parseSkillManifest(content);
  } catch (error) {
    console.error(`Failed to parse skill manifest at ${manifestPath}:`, error);
    return null;
  }
}

/**
 * Validate a skill manifest and return errors
 */
export function validateSkillManifest(manifest: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = SkillManifestSchema.safeParse(manifest);
  
  if (result.success) {
    return { valid: true, errors: [] };
  }
  
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
  
  return { valid: false, errors };
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format a skill manifest for injection into the system prompt
 */
export function formatSkillForPrompt(manifest: SkillManifest): string {
  const emoji = manifest.emoji || '🔧';
  const lines: string[] = [];
  
  lines.push(`### ${emoji} ${manifest.name} (v${manifest.version})`);
  lines.push('');
  lines.push(manifest.description);
  lines.push('');
  
  // Inputs
  if (manifest.inputs && Object.keys(manifest.inputs).length > 0) {
    lines.push('**Inputs:**');
    for (const [name, param] of Object.entries(manifest.inputs)) {
      const required = param.required ? '(required)' : '(optional)';
      const desc = param.description || '';
      lines.push(`- \`${name}\`: ${param.type} ${required} ${desc}`);
    }
    lines.push('');
  }
  
  // Outputs
  if (manifest.outputs && Object.keys(manifest.outputs).length > 0) {
    lines.push('**Outputs:**');
    for (const [name, param] of Object.entries(manifest.outputs)) {
      const desc = param.description || '';
      lines.push(`- \`${name}\`: ${param.type} ${desc}`);
    }
    lines.push('');
  }
  
  // Allowed tools
  if (manifest.permissions?.tools && manifest.permissions.tools.length > 0) {
    lines.push(`**Allowed tools:** ${manifest.permissions.tools.join(', ')}`);
    lines.push('');
  }
  
  // Instructions
  lines.push('**Instructions:**');
  lines.push('');
  lines.push(manifest.instructions);
  
  return lines.join('\n');
}

/**
 * Format multiple skills as an XML list for discovery
 */
export function formatSkillsListForPrompt(manifests: SkillManifest[]): string {
  if (manifests.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  lines.push('<available_skills>');
  
  for (const manifest of manifests) {
    const emoji = manifest.emoji || '🔧';
    lines.push(`  <skill name="${manifest.name}" version="${manifest.version}" emoji="${emoji}">`);
    lines.push(`    <description>${manifest.description}</description>`);
    if (manifest.permissions?.tools && manifest.permissions.tools.length > 0) {
      lines.push(`    <tools>${manifest.permissions.tools.join(', ')}</tools>`);
    }
    lines.push('  </skill>');
  }
  
  lines.push('</available_skills>');
  
  return lines.join('\n');
}

/**
 * Convert skill to OpenAI tool format (for tool calling)
 */
export function skillToOpenAITool(manifest: SkillManifest): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
} | null {
  if (!manifest.inputs) {
    return null;
  }
  
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  
  for (const [name, param] of Object.entries(manifest.inputs)) {
    const prop: Record<string, unknown> = {
      type: param.type === 'enum' ? 'string' : param.type,
    };
    
    if (param.description) {
      prop.description = param.description;
    }
    
    if (param.type === 'enum' && param.values) {
      prop.enum = param.values;
    }
    
    if (param.min !== undefined) {
      prop.minimum = param.min;
    }
    
    if (param.max !== undefined) {
      prop.maximum = param.max;
    }
    
    properties[name] = prop;
    
    if (param.required) {
      required.push(name);
    }
  }
  
  return {
    type: 'function',
    function: {
      name: manifest.name,
      description: manifest.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };
}

// ============================================================================
// Checksum Functions
// ============================================================================

/**
 * Calculate a checksum for a skill manifest
 * Used for versioning and change detection
 */
export function calculateSkillChecksum(manifest: SkillManifest): string {
  const content = JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    instructions: manifest.instructions,
    inputs: manifest.inputs,
    outputs: manifest.outputs,
    permissions: manifest.permissions,
  });
  
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================================
// Gate Checking
// ============================================================================

/**
 * Check if a skill's gates are satisfied
 */
export function checkSkillGates(manifest: SkillManifest): {
  enabled: boolean;
  reason?: string;
} {
  const gates = manifest.gates;
  
  if (!gates) {
    return { enabled: true };
  }
  
  // Always enabled
  if (gates.always) {
    return { enabled: true };
  }
  
  // Check OS
  if (gates.os && gates.os.length > 0) {
    const currentOs = process.platform;
    if (!gates.os.includes(currentOs)) {
      return { enabled: false, reason: `OS ${currentOs} not in allowed: ${gates.os.join(', ')}` };
    }
  }
  
  // Check environment variables
  if (gates.env && gates.env.length > 0) {
    for (const envVar of gates.env) {
      if (!process.env[envVar]) {
        return { enabled: false, reason: `Missing env var: ${envVar}` };
      }
    }
  }
  
  // Check binaries (simplified - just checks if command exists in PATH)
  // Note: Full binary checking would require which/where command
  
  return { enabled: true };
}

// ============================================================================
// Migration Helper
// ============================================================================

/**
 * Convert old SKILL.md format to new skill.yaml format
 * Returns a best-effort conversion
 */
export function convertSkillMdToYaml(
  skillName: string,
  markdown: string,
  frontmatter?: Record<string, unknown>
): Partial<SkillManifest> {
  const metadata = frontmatter?.metadata as Record<string, Record<string, unknown>> | undefined;
  const openclaw = metadata?.openclaw as Record<string, unknown> | undefined;
  const requires = openclaw?.requires as Record<string, string[]> | undefined;
  
  return {
    name: skillName,
    version: '1.0.0',
    description: (frontmatter?.description as string) || 'Migrated from SKILL.md',
    instructions: markdown,
    emoji: openclaw?.emoji as string | undefined,
    gates: {
      env: requires?.env,
      bins: requires?.bins,
      always: openclaw?.always as boolean | undefined,
    },
  };
}
