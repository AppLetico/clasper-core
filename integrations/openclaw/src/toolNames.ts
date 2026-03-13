/**
 * Normalize OpenClaw tool names to canonical governance names.
 *
 * OpenClaw 2026.x uses short names like `read` / `write`.
 * Older integrations used `read_file` / `write_file`.
 * bash is an alias for exec; http_request maps to web_fetch.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  delete_file: 'delete',
  http_request: 'web_fetch',
  bash: 'exec',
};

export function normalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}
