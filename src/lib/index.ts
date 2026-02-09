/**
 * Wombat Ops Library
 *
 * Organized into logical modules:
 * - core: Database, config
 * - tracing: Trace model and storage
 * - skills: Skill manifest, registry, testing
 * - auth: Authentication and local ops context
 * - tools: Tool proxy and permissions
 * - governance: Audit, redaction, budgets
 * - providers: LLM providers and contracts
 * - workspace: Workspace management
 * - evals: Evaluation framework
 * - integrations: External integrations
 * - security: Security utilities (TLS, path validation, prompt injection prevention)
 */

// Re-export modules - use named imports to avoid conflicts
export * from './core/index.js';
export * from './tracing/index.js';
export * from './skills/index.js';
export * from './auth/index.js';
export { ToolProxy, ToolPermissionChecker, getToolProxy, getToolPermissionChecker } from './tools/index.js';
export * from './governance/index.js';
export { llmComplete, llmStream, llmTask, llmCompact, ProviderContractError, parseProviderError } from './providers/index.js';
export * from './workspace/index.js';
export * from './evals/index.js';
export { listTasks, createTask, postMessage, postDocument, fireWebhook, getUsageTracker } from './integrations/index.js';
export * from './adapters/index.js';

// Security utilities (inspired by OpenClaw 2026.2.1)
export {
  enforceTLS13Minimum,
  isPathSafe,
  sanitizePath,
  sanitizeForPrompt,
  detectInjectionPatterns,
  isUrlSafe,
  formatUTCTimestamp,
  nowUTC,
  security
} from './security/index.js';
