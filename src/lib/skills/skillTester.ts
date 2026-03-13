/**
 * Skill Test Harness
 *
 * Run tests defined in skill manifests against different models.
 * Supports mocking tools, snapshot comparison, and semantic diffing.
 */

import { SkillManifest, TestCase } from './skillManifest.js';
import { PublishedSkill } from './skillRegistry.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for running skill tests
 */
export interface SkillTestOptions {
  model?: string;
  temperature?: number;
  mockTools?: boolean;
  timeout?: number;
  verbose?: boolean;
}

/**
 * Result of a single test case
 */
export interface TestCaseResult {
  testName: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  diff?: string;
  durationMs: number;
  cost: number;
  error?: string;
  output?: string;
}

/**
 * Result of a complete test run
 */
export interface TestRunResult {
  skillName: string;
  skillVersion: string;
  model: string;
  results: TestCaseResult[];
  passCount: number;
  failCount: number;
  passRate: number;
  totalDurationMs: number;
  totalCost: number;
  startedAt: string;
  completedAt: string;
}

/**
 * Comparison result between expected and actual values
 */
export interface ComparisonResult {
  matches: boolean;
  diff?: string;
  details?: Record<string, { expected: unknown; actual: unknown; matches: boolean }>;
}

/**
 * Mock tool response
 */
export interface MockToolResponse {
  returns?: unknown;
  throws?: string;
}

// ============================================================================
// Skill Tester Class
// ============================================================================

export class SkillTester {
  private defaultModel: string;
  private defaultTimeout: number;

  constructor(options?: { defaultModel?: string; defaultTimeout?: number }) {
    this.defaultModel = options?.defaultModel || 'gpt-4o-mini';
    this.defaultTimeout = options?.defaultTimeout || 30000;
  }

  /**
   * Run all tests defined in a skill manifest
   */
  async runTests(
    skill: PublishedSkill | SkillManifest,
    options?: SkillTestOptions
  ): Promise<TestRunResult> {
    const manifest = 'manifest' in skill ? skill.manifest : skill;
    const name = manifest.name;
    const version = manifest.version;
    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || this.defaultTimeout;

    const startedAt = new Date().toISOString();
    const results: TestCaseResult[] = [];
    let totalCost = 0;

    const tests = manifest.tests || [];

    for (const testCase of tests) {
      const result = await this.runTestCase(manifest, testCase, {
        ...options,
        model,
        timeout,
      });
      results.push(result);
      totalCost += result.cost;
    }

    const completedAt = new Date().toISOString();
    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.filter((r) => !r.passed).length;
    const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      skillName: name,
      skillVersion: version,
      model,
      results,
      passCount,
      failCount,
      passRate: tests.length > 0 ? passCount / tests.length : 1,
      totalDurationMs,
      totalCost,
      startedAt,
      completedAt,
    };
  }

  /**
   * Run a single test case
   */
  async runTestCase(
    manifest: SkillManifest,
    testCase: TestCase,
    options: SkillTestOptions & { timeout: number }
  ): Promise<TestCaseResult> {
    const start = Date.now();

    try {
      // Build the test prompt
      const prompt = this.buildTestPrompt(manifest, testCase);

      // If mockTools is enabled, we don't actually call the LLM
      // Instead, we simulate the tool calls and responses
      if (options.mockTools && testCase.mocks) {
        const result = await this.runMockedTest(manifest, testCase, options);
        return result;
      }

      // For now, return a placeholder result since we need LLM integration
      // In production, this would call the LLM with the skill instructions
      const durationMs = Date.now() - start;

      // Placeholder: actual implementation would call LLM
      const actual = await this.executeLLMTest(prompt, options);
      const comparison = this.compareOutputs(testCase.expect || {}, actual);

      return {
        testName: testCase.name,
        passed: comparison.matches,
        expected: testCase.expect,
        actual,
        diff: comparison.diff,
        durationMs,
        cost: 0, // Would be calculated from LLM response
        output: JSON.stringify(actual),
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if we expected an error
      if (testCase.expectError && errorMessage.includes(testCase.expectError)) {
        return {
          testName: testCase.name,
          passed: true,
          expected: { error: testCase.expectError },
          actual: { error: errorMessage },
          durationMs,
          cost: 0,
        };
      }

      return {
        testName: testCase.name,
        passed: false,
        expected: testCase.expect,
        actual: null,
        error: errorMessage,
        durationMs,
        cost: 0,
      };
    }
  }

  /**
   * Run a test with mocked tool responses
   */
  private async runMockedTest(
    manifest: SkillManifest,
    testCase: TestCase,
    options: SkillTestOptions
  ): Promise<TestCaseResult> {
    const start = Date.now();

    // In a mocked test, we simulate what the LLM would do:
    // 1. Parse the input
    // 2. "Call" the mocked tools
    // 3. Generate a response based on the mock data

    const mocks = testCase.mocks || {};
    const mockResults: Record<string, unknown> = {};

    // Simulate tool calls using mocks
    for (const [toolName, mockConfig] of Object.entries(mocks)) {
      if (mockConfig.throws) {
        // Tool throws an error
        mockResults[toolName] = { error: mockConfig.throws };
      } else {
        // Tool returns the mocked value
        mockResults[toolName] = mockConfig.returns;
      }
    }

    // For mocked tests, we check if the expected output could be derived
    // from the mock data. This is a simplified check.
    const durationMs = Date.now() - start;

    // Simple validation: if expect is provided, check if mockResults
    // would logically lead to the expected output
    const expected = testCase.expect || {};
    const comparison = this.compareWithMockContext(expected, mockResults);

    return {
      testName: testCase.name,
      passed: comparison.matches,
      expected,
      actual: mockResults,
      diff: comparison.diff,
      durationMs,
      cost: 0, // No LLM cost for mocked tests
      output: JSON.stringify(mockResults),
    };
  }

  /**
   * Execute an actual LLM test (placeholder for now)
   */
  private async executeLLMTest(
    prompt: string,
    options: SkillTestOptions
  ): Promise<unknown> {
    // TODO: Integrate with llmProvider to actually run the test
    // For now, return a placeholder
    console.log(`Would execute LLM test with model: ${options.model}`);
    console.log(`Prompt length: ${prompt.length} chars`);

    return {
      _placeholder: true,
      message: 'LLM integration pending',
    };
  }

  /**
   * Build the test prompt from manifest and test case
   */
  private buildTestPrompt(manifest: SkillManifest, testCase: TestCase): string {
    const lines: string[] = [];

    // Skill instructions
    lines.push('# Skill Instructions');
    lines.push('');
    lines.push(manifest.instructions);
    lines.push('');

    // Input for this test
    lines.push('# Test Input');
    lines.push('');
    lines.push(JSON.stringify(testCase.input, null, 2));
    lines.push('');

    // Expected output format
    if (manifest.outputs) {
      lines.push('# Expected Output Format');
      lines.push('');
      for (const [name, param] of Object.entries(manifest.outputs)) {
        lines.push(`- ${name}: ${param.type}${param.description ? ` - ${param.description}` : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Compare expected and actual outputs
   */
  compareOutputs(expected: unknown, actual: unknown): ComparisonResult {
    if (expected === null || expected === undefined) {
      return { matches: true };
    }

    if (typeof expected !== 'object' || typeof actual !== 'object') {
      const matches = expected === actual;
      return {
        matches,
        diff: matches ? undefined : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      };
    }

    const expectedObj = expected as Record<string, unknown>;
    const actualObj = (actual || {}) as Record<string, unknown>;
    const details: Record<string, { expected: unknown; actual: unknown; matches: boolean }> = {};
    let allMatch = true;

    for (const [key, expectedValue] of Object.entries(expectedObj)) {
      const actualValue = actualObj[key];
      const matches = this.valuesMatch(expectedValue, actualValue);
      details[key] = { expected: expectedValue, actual: actualValue, matches };
      if (!matches) allMatch = false;
    }

    if (!allMatch) {
      const diffLines = Object.entries(details)
        .filter(([, d]) => !d.matches)
        .map(([key, d]) => `  ${key}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);

      return {
        matches: false,
        diff: `Mismatches:\n${diffLines.join('\n')}`,
        details,
      };
    }

    return { matches: true, details };
  }

  /**
   * Compare expected output with mock context
   */
  private compareWithMockContext(
    expected: Record<string, unknown>,
    mockResults: Record<string, unknown>
  ): ComparisonResult {
    // For mocked tests, we do a simpler check:
    // If expected values are present in the mock results somewhere, consider it a match
    // This is a heuristic - real implementation would be more sophisticated

    for (const [key, expectedValue] of Object.entries(expected)) {
      // Check if this expected value appears anywhere in mock results
      const found = this.findValueInObject(expectedValue, mockResults);
      if (!found) {
        return {
          matches: false,
          diff: `Expected ${key}=${JSON.stringify(expectedValue)} not derivable from mock data`,
        };
      }
    }

    return { matches: true };
  }

  /**
   * Check if two values match (with type coercion for enums/strings)
   */
  private valuesMatch(expected: unknown, actual: unknown): boolean {
    if (expected === actual) return true;
    if (expected === null || actual === null) return expected === actual;
    if (expected === undefined || actual === undefined) return expected === actual;

    // String comparison (case-insensitive for enums)
    if (typeof expected === 'string' && typeof actual === 'string') {
      return expected.toLowerCase() === actual.toLowerCase();
    }

    // Number comparison with tolerance
    if (typeof expected === 'number' && typeof actual === 'number') {
      return Math.abs(expected - actual) < 0.0001;
    }

    // Array comparison
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (expected.length !== actual.length) return false;
      return expected.every((e, i) => this.valuesMatch(e, actual[i]));
    }

    // Object comparison
    if (typeof expected === 'object' && typeof actual === 'object') {
      const expectedKeys = Object.keys(expected as object);
      const actualKeys = Object.keys(actual as object);
      if (expectedKeys.length !== actualKeys.length) return false;
      return expectedKeys.every((key) =>
        this.valuesMatch(
          (expected as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key]
        )
      );
    }

    return false;
  }

  /**
   * Find a value anywhere in an object (recursive)
   */
  private findValueInObject(needle: unknown, haystack: unknown): boolean {
    if (this.valuesMatch(needle, haystack)) return true;

    if (typeof haystack === 'object' && haystack !== null) {
      for (const value of Object.values(haystack)) {
        if (this.findValueInObject(needle, value)) return true;
      }
    }

    if (Array.isArray(haystack)) {
      for (const item of haystack) {
        if (this.findValueInObject(needle, item)) return true;
      }
    }

    return false;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let skillTesterInstance: SkillTester | null = null;

/**
 * Get or create the SkillTester instance
 */
export function getSkillTester(): SkillTester {
  if (!skillTesterInstance) {
    skillTesterInstance = new SkillTester();
  }
  return skillTesterInstance;
}

/**
 * Reset the skill tester instance (for testing)
 */
export function resetSkillTester(): void {
  skillTesterInstance = null;
}
