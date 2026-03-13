/**
 * Evaluation Framework
 *
 * Golden datasets, scored outputs, and drift detection.
 * Features:
 * - Define evaluation datasets
 * - Run evaluations against different models/skills
 * - Compare to baselines
 * - Detect behavioral drift over time
 */

import { v7 as uuidv7 } from 'uuid';
import { getDatabase } from '../core/db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A single evaluation case
 */
export interface EvalCase {
  id?: string;
  name?: string;
  input: string;
  expectedOutput?: string;
  expectedToolCalls?: string[];
  acceptableOutputs?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * A dataset of evaluation cases
 */
export interface EvalDataset {
  name: string;
  description?: string;
  cases: EvalCase[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Options for running an evaluation
 */
export interface EvalOptions {
  model: string;
  skillName?: string;
  skillVersion?: string;
  temperature?: number;
  timeout?: number;
  mockTools?: boolean;
}

/**
 * Result of evaluating a single case
 */
export interface CaseResult {
  caseId: string;
  caseName?: string;
  passed: boolean;
  input: string;
  expectedOutput?: string;
  actualOutput: string;
  expectedToolCalls?: string[];
  actualToolCalls?: string[];
  score: number;
  scores: {
    exactMatch: number;
    semanticSimilarity: number;
    toolCallMatch: number;
  };
  durationMs: number;
  cost: number;
  error?: string;
  tags?: string[];
}

/**
 * Aggregate scores for an evaluation run
 */
export interface EvalScores {
  accuracy: number;
  passRate: number;
  avgExactMatch: number;
  avgSemanticSimilarity: number;
  avgToolCallMatch: number;
  avgDurationMs: number;
  totalCost: number;
}

/**
 * Drift analysis comparing two eval runs
 */
export interface DriftAnalysis {
  baselineId: string;
  currentId: string;
  driftScore: number;
  regressions: CaseRegression[];
  improvements: CaseImprovement[];
  summary: {
    regressedCount: number;
    improvedCount: number;
    unchangedCount: number;
    newCasesCount: number;
    removedCasesCount: number;
  };
}

/**
 * A regression from baseline to current
 */
export interface CaseRegression {
  caseId: string;
  caseName?: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

/**
 * An improvement from baseline to current
 */
export interface CaseImprovement {
  caseId: string;
  caseName?: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

/**
 * Complete result of an evaluation run
 */
export interface EvalResult {
  id: string;
  datasetName: string;
  model: string;
  skillName?: string;
  skillVersion?: string;
  scores: EvalScores;
  cases: CaseResult[];
  drift?: DriftAnalysis;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ============================================================================
// Evaluation Runner Class
// ============================================================================

export class EvalRunner {
  /**
   * Run an evaluation dataset
   */
  async run(dataset: EvalDataset, options: EvalOptions): Promise<EvalResult> {
    const id = uuidv7();
    const startedAt = new Date().toISOString();
    const caseResults: CaseResult[] = [];

    for (const evalCase of dataset.cases) {
      const result = await this.runCase(evalCase, options);
      caseResults.push(result);
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    // Calculate aggregate scores
    const scores = this.calculateScores(caseResults);

    const evalResult: EvalResult = {
      id,
      datasetName: dataset.name,
      model: options.model,
      skillName: options.skillName,
      skillVersion: options.skillVersion,
      scores,
      cases: caseResults,
      startedAt,
      completedAt,
      durationMs,
    };

    // Save to database
    this.saveResult(evalResult);

    return evalResult;
  }

  /**
   * Run a single evaluation case
   */
  private async runCase(evalCase: EvalCase, options: EvalOptions): Promise<CaseResult> {
    const caseId = evalCase.id || uuidv7();
    const start = Date.now();

    try {
      // TODO: Integrate with actual LLM provider
      // For now, return a placeholder result
      const actualOutput = await this.executeLLM(evalCase.input, options);
      const actualToolCalls: string[] = [];

      const durationMs = Date.now() - start;

      // Calculate scores
      const exactMatch = this.calculateExactMatch(
        evalCase.expectedOutput,
        actualOutput,
        evalCase.acceptableOutputs
      );
      const semanticSimilarity = this.calculateSemanticSimilarity(
        evalCase.expectedOutput,
        actualOutput
      );
      const toolCallMatch = this.calculateToolCallMatch(
        evalCase.expectedToolCalls,
        actualToolCalls
      );

      const score = (exactMatch + semanticSimilarity + toolCallMatch) / 3;
      const passed = score >= 0.7; // Threshold for passing

      return {
        caseId,
        caseName: evalCase.name,
        passed,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        actualOutput,
        expectedToolCalls: evalCase.expectedToolCalls,
        actualToolCalls,
        score,
        scores: {
          exactMatch,
          semanticSimilarity,
          toolCallMatch,
        },
        durationMs,
        cost: 0, // Would be calculated from LLM response
        tags: evalCase.tags,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      return {
        caseId,
        caseName: evalCase.name,
        passed: false,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        actualOutput: '',
        score: 0,
        scores: {
          exactMatch: 0,
          semanticSimilarity: 0,
          toolCallMatch: 0,
        },
        durationMs,
        cost: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        tags: evalCase.tags,
      };
    }
  }

  /**
   * Execute LLM for evaluation (placeholder)
   */
  private async executeLLM(input: string, options: EvalOptions): Promise<string> {
    // TODO: Integrate with actual LLM provider
    console.log(`Would execute LLM with model: ${options.model}`);
    console.log(`Input: ${input.substring(0, 100)}...`);

    return '[Placeholder output - LLM integration pending]';
  }

  /**
   * Calculate exact match score
   */
  private calculateExactMatch(
    expected: string | undefined,
    actual: string,
    acceptable?: string[]
  ): number {
    if (!expected) return 1; // No expected output means any output is fine

    // Normalize strings for comparison
    const normalizedExpected = this.normalizeString(expected);
    const normalizedActual = this.normalizeString(actual);

    if (normalizedExpected === normalizedActual) return 1;

    // Check acceptable alternatives
    if (acceptable) {
      for (const alt of acceptable) {
        if (this.normalizeString(alt) === normalizedActual) return 1;
      }
    }

    return 0;
  }

  /**
   * Calculate semantic similarity score (simplified)
   */
  private calculateSemanticSimilarity(
    expected: string | undefined,
    actual: string
  ): number {
    if (!expected) return 1;

    // Simplified: calculate word overlap (Jaccard similarity)
    const expectedWords = new Set(this.tokenize(expected));
    const actualWords = new Set(this.tokenize(actual));

    const intersection = new Set(
      [...expectedWords].filter((w) => actualWords.has(w))
    );
    const union = new Set([...expectedWords, ...actualWords]);

    if (union.size === 0) return 1;
    return intersection.size / union.size;
  }

  /**
   * Calculate tool call match score
   */
  private calculateToolCallMatch(
    expected: string[] | undefined,
    actual: string[]
  ): number {
    if (!expected || expected.length === 0) return 1;

    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);

    // Check how many expected calls were made
    let matches = 0;
    for (const tool of expected) {
      if (actualSet.has(tool)) matches++;
    }

    // Also penalize extra tool calls
    const extraCalls = actual.filter((t) => !expectedSet.has(t)).length;
    const penalty = extraCalls * 0.1;

    return Math.max(0, matches / expected.length - penalty);
  }

  /**
   * Calculate aggregate scores from case results
   */
  private calculateScores(cases: CaseResult[]): EvalScores {
    if (cases.length === 0) {
      return {
        accuracy: 0,
        passRate: 0,
        avgExactMatch: 0,
        avgSemanticSimilarity: 0,
        avgToolCallMatch: 0,
        avgDurationMs: 0,
        totalCost: 0,
      };
    }

    const passCount = cases.filter((c) => c.passed).length;
    const totalScore = cases.reduce((sum, c) => sum + c.score, 0);

    return {
      accuracy: totalScore / cases.length,
      passRate: passCount / cases.length,
      avgExactMatch: cases.reduce((sum, c) => sum + c.scores.exactMatch, 0) / cases.length,
      avgSemanticSimilarity:
        cases.reduce((sum, c) => sum + c.scores.semanticSimilarity, 0) / cases.length,
      avgToolCallMatch:
        cases.reduce((sum, c) => sum + c.scores.toolCallMatch, 0) / cases.length,
      avgDurationMs: cases.reduce((sum, c) => sum + c.durationMs, 0) / cases.length,
      totalCost: cases.reduce((sum, c) => sum + c.cost, 0),
    };
  }

  /**
   * Compare current results to a baseline
   */
  compareToBaseline(current: EvalResult, baseline: EvalResult): DriftAnalysis {
    const currentCases = new Map(current.cases.map((c) => [c.caseId, c]));
    const baselineCases = new Map(baseline.cases.map((c) => [c.caseId, c]));

    const regressions: CaseRegression[] = [];
    const improvements: CaseImprovement[] = [];
    let regressedCount = 0;
    let improvedCount = 0;
    let unchangedCount = 0;

    // Compare cases that exist in both
    for (const [caseId, currentCase] of currentCases) {
      const baselineCase = baselineCases.get(caseId);
      if (!baselineCase) continue;

      const delta = currentCase.score - baselineCase.score;

      if (delta < -0.1) {
        regressions.push({
          caseId,
          caseName: currentCase.caseName,
          baselineScore: baselineCase.score,
          currentScore: currentCase.score,
          delta,
        });
        regressedCount++;
      } else if (delta > 0.1) {
        improvements.push({
          caseId,
          caseName: currentCase.caseName,
          baselineScore: baselineCase.score,
          currentScore: currentCase.score,
          delta,
        });
        improvedCount++;
      } else {
        unchangedCount++;
      }
    }

    // Count new and removed cases
    const newCasesCount = [...currentCases.keys()].filter(
      (id) => !baselineCases.has(id)
    ).length;
    const removedCasesCount = [...baselineCases.keys()].filter(
      (id) => !currentCases.has(id)
    ).length;

    // Calculate overall drift score
    const driftScore =
      (regressions.reduce((sum, r) => sum + Math.abs(r.delta), 0) -
        improvements.reduce((sum, i) => sum + i.delta, 0)) /
      Math.max(1, current.cases.length);

    return {
      baselineId: baseline.id,
      currentId: current.id,
      driftScore,
      regressions: regressions.sort((a, b) => a.delta - b.delta),
      improvements: improvements.sort((a, b) => b.delta - a.delta),
      summary: {
        regressedCount,
        improvedCount,
        unchangedCount,
        newCasesCount,
        removedCasesCount,
      },
    };
  }

  /**
   * Save evaluation result to database
   */
  private saveResult(result: EvalResult): void {
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO eval_results (
        id, dataset_name, skill_name, skill_version, model,
        scores, cases, drift, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      result.id,
      result.datasetName,
      result.skillName || null,
      result.skillVersion || null,
      result.model,
      JSON.stringify(result.scores),
      JSON.stringify(result.cases),
      result.drift ? JSON.stringify(result.drift) : null,
      result.startedAt
    );
  }

  /**
   * Get an evaluation result by ID
   */
  getResult(id: string): EvalResult | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM eval_results WHERE id = ?')
      .get(id) as EvalRow | undefined;

    if (!row) return null;

    return this.rowToResult(row);
  }

  /**
   * List evaluation results
   */
  listResults(options?: {
    datasetName?: string;
    skillName?: string;
    model?: string;
    limit?: number;
    offset?: number;
  }): { results: EvalResult[]; total: number } {
    const db = getDatabase();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.datasetName) {
      conditions.push('dataset_name = ?');
      params.push(options.datasetName);
    }

    if (options?.skillName) {
      conditions.push('skill_name = ?');
      params.push(options.skillName);
    }

    if (options?.model) {
      conditions.push('model = ?');
      params.push(options.model);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM eval_results ${whereClause}`)
      .get(...params) as { count: number };

    const rows = db
      .prepare(
        `
        SELECT * FROM eval_results
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as EvalRow[];

    return {
      results: rows.map((row) => this.rowToResult(row)),
      total: countRow.count,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private normalizeString(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private tokenize(s: string): string[] {
    return s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  private rowToResult(row: EvalRow): EvalResult {
    return {
      id: row.id,
      datasetName: row.dataset_name,
      model: row.model,
      skillName: row.skill_name || undefined,
      skillVersion: row.skill_version || undefined,
      scores: JSON.parse(row.scores),
      cases: JSON.parse(row.cases),
      drift: row.drift ? JSON.parse(row.drift) : undefined,
      startedAt: row.created_at,
      completedAt: row.created_at,
      durationMs: 0,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface EvalRow {
  id: string;
  dataset_name: string;
  skill_name: string | null;
  skill_version: string | null;
  model: string;
  scores: string;
  cases: string;
  drift: string | null;
  created_at: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let evalRunnerInstance: EvalRunner | null = null;

/**
 * Get or create the EvalRunner instance
 */
export function getEvalRunner(): EvalRunner {
  if (!evalRunnerInstance) {
    evalRunnerInstance = new EvalRunner();
  }
  return evalRunnerInstance;
}

/**
 * Reset the eval runner instance (for testing)
 */
export function resetEvalRunner(): void {
  evalRunnerInstance = null;
}
