/**
 * Best-effort heuristic intent inference.
 *
 * All inferred intents are tagged with intent_source: "heuristic" by the caller.
 * Intent is an ASSISTIVE SIGNAL, never authoritative.
 * Policies must never require intent — they should match on tool/tool_group/capability
 * which are deterministic.
 */

import type { OpenClawTool } from './types.js';

// ---------------------------------------------------------------------------
// Intent inference
// ---------------------------------------------------------------------------

/**
 * Infer a human-readable intent string from the tool and its arguments.
 * Returns a best-effort classification; callers must tag this with
 * `intent_source: "heuristic"`.
 */
export function inferIntent(
  tool: OpenClawTool,
  args: Record<string, unknown>
): string {
  const name = tool.name.toLowerCase();
  const argsStr = JSON.stringify(args).toLowerCase();

  // Exec / shell commands
  if (name === 'exec' || name === 'shell' || name === 'run_command') {
    if (/\brm\s+-rf?\b/.test(argsStr) || /\brmdir\b/.test(argsStr)) {
      return 'destructive_command';
    }
    if (/\b(npm|yarn|pnpm|pip|apt|brew)\s+install\b/.test(argsStr)) {
      return 'install_dependencies';
    }
    if (/\bcurl\b.*\|.*\bsh\b/.test(argsStr) || /\bwget\b.*\|.*\bsh\b/.test(argsStr)) {
      return 'remote_code_execution';
    }
    if (/\bcurl\b|\bwget\b/.test(argsStr)) {
      return 'download_resource';
    }
    if (/\bgit\s+(push|clone|pull)\b/.test(argsStr)) {
      return 'git_operation';
    }
    if (/\bdocker\b|\bkubectl\b/.test(argsStr)) {
      return 'infrastructure_command';
    }
    return 'shell_command';
  }

  // File operations (canonical + legacy names)
  if (name === 'write' || name === 'write_file' || name === 'create_file') {
    return 'write_file';
  }
  if (name === 'delete' || name === 'delete_file' || name === 'remove_file') {
    return 'delete_file';
  }
  if (name === 'read' || name === 'read_file') {
    return 'read_file';
  }

  // Network operations (canonical + legacy names)
  if (name === 'web_fetch' || name === 'http_request' || name === 'fetch') {
    if (/\b(post|put|patch|delete)\b/i.test(argsStr)) {
      return 'external_request_mutating';
    }
    return 'external_request';
  }
  if (name === 'web_search') {
    return 'web_search';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Context mapping
// ---------------------------------------------------------------------------

/**
 * Map tool invocation to Clasper execution context signals.
 */
export function mapToolContext(
  tool: OpenClawTool,
  args: Record<string, unknown>
): {
  external_network?: boolean;
  writes_files?: boolean;
  elevated_privileges?: boolean;
  package_manager?: string;
  targets?: string[];
} {
  const name = tool.name.toLowerCase();
  const argsStr = JSON.stringify(args).toLowerCase();

  const context: {
    external_network?: boolean;
    writes_files?: boolean;
    elevated_privileges?: boolean;
    package_manager?: string;
    targets?: string[];
  } = {};

  // Network signals (canonical + legacy)
  if (
    name === 'web_search' ||
    name === 'web_fetch' ||
    name === 'http_request' ||
    name === 'fetch' ||
    /\bcurl\b|\bwget\b|\bhttp/.test(argsStr)
  ) {
    context.external_network = true;
  }

  // File write signals (canonical + legacy)
  if (
    name === 'write' ||
    name === 'write_file' ||
    name === 'delete' ||
    name === 'delete_file' ||
    name === 'create_file' ||
    name === 'remove_file'
  ) {
    context.writes_files = true;
  }

  // Elevated privileges
  if (/\bsudo\b/.test(argsStr) || /\b--privileged\b/.test(argsStr)) {
    context.elevated_privileges = true;
  }

  // Package manager detection
  const pmMatch = argsStr.match(/\b(npm|yarn|pnpm|pip|apt|brew|cargo|go)\b/);
  if (pmMatch) {
    context.package_manager = pmMatch[1];
  }

  // Targets (file paths or URLs)
  const targets: string[] = [];
  if (typeof args.path === 'string') targets.push(args.path);
  if (typeof args.file === 'string') targets.push(args.file);
  if (typeof args.url === 'string') targets.push(args.url);
  if (typeof args.command === 'string') targets.push(args.command);
  if (typeof args.cwd === 'string') targets.push(args.cwd);
  if (targets.length > 0) {
    context.targets = targets;
  }

  return context;
}
