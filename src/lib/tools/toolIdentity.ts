/**
 * Canonical tool name normalization for policy matching, posture coverage, and probe logic.
 * Ensures consistent identity across engine, posture analyzer, tests, and probes.
 */

/**
 * Normalize a tool name to a canonical form for comparison.
 * Handles common variants: shell.exec, shell_exec, shell-exec → shell.exec
 */
export function normalizeToolName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.replace(/-/g, '.').replace(/_/g, '.');
}

/**
 * Check if two tool names refer to the same tool after normalization.
 */
export function toolNamesMatch(a: string, b: string): boolean {
  return normalizeToolName(a) === normalizeToolName(b);
}
