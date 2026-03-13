/**
 * Best-effort heuristic intent inference.
 *
 * All inferred intents are tagged with intent_source: "heuristic" by the caller.
 * Intent is an ASSISTIVE SIGNAL, never authoritative.
 * Policies must never require intent — they should match on tool/tool_group/capability
 * which are deterministic.
 */

import type { OpenClawTool } from './types.js';
import path from 'node:path';

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

  // Exec / shell commands (bash is alias for exec)
  if (name === 'exec' || name === 'bash' || name === 'shell' || name === 'run_command') {
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
  if (name === 'edit' || name === 'apply_patch') {
    return 'edit_file';
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
  if (name === 'message') {
    return 'channel_send';
  }

  // UI tools
  if (name === 'browser') {
    return 'browser_automation';
  }
  if (name === 'canvas') {
    return 'canvas_render';
  }

  // Node / device tools
  if (name === 'nodes') {
    return 'node_operation';
  }

  // Session tools
  if (
    name === 'sessions_list' ||
    name === 'sessions_history' ||
    name === 'sessions_send' ||
    name === 'sessions_spawn' ||
    name === 'session_status'
  ) {
    return 'session_operation';
  }

  // Memory tools
  if (name === 'memory_search' || name === 'memory_get') {
    return 'memory_access';
  }

  // Automation tools
  if (name === 'cron') {
    return 'cron_manage';
  }
  if (name === 'gateway') {
    return 'gateway_operation';
  }

  // Process management
  if (name === 'process') {
    return 'process_manage';
  }

  // Document / media analysis
  if (name === 'image') {
    return 'image_analysis';
  }
  if (name === 'pdf') {
    return 'pdf_analysis';
  }

  if (name === 'agents_list') {
    return 'list_agents';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Context mapping
// ---------------------------------------------------------------------------

/** Optional session/event context for tools that derive target from session (e.g. message). */
export interface MapToolContextOptions {
  /** Raw before_tool_call event (may contain session, channel, target). */
  event?: Record<string, unknown>;
  /** Hook context (session, channel binding when tool is session-bound). */
  sessionContext?: Record<string, unknown>;
}

/**
 * Map tool invocation to Clasper execution context signals.
 */
export function mapToolContext(
  tool: OpenClawTool,
  args: Record<string, unknown>,
  options?: MapToolContextOptions
): {
  external_network?: boolean;
  writes_files?: boolean;
  elevated_privileges?: boolean;
  package_manager?: string;
  targets?: string[] | { paths?: string[]; hosts?: string[] };
  exec?: {
    argv0?: string;
    argv?: string[];
    cwd?: string;
  };
  side_effects?: {
    writes_possible?: boolean;
    network_possible?: boolean;
  };
  channel?: string;
  recipient?: string;
  channel_display?: string;
  url?: string;
  query?: string;
} {
  const normalizePath = (input: string): string | null => {
    try {
      return path.resolve(input);
    } catch {
      return null;
    }
  };

  const tokenizeCommand = (command: string): string[] =>
    command
      .trim()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

  const extractHost = (input: string): string | null => {
    try {
      const parsed = new URL(input);
      return parsed.hostname || null;
    } catch {
      return null;
    }
  };

  const name = tool.name.toLowerCase();
  const argsStr = JSON.stringify(args).toLowerCase();

  const context: {
    external_network?: boolean;
    writes_files?: boolean;
    elevated_privileges?: boolean;
    package_manager?: string;
    targets?: string[] | { paths?: string[]; hosts?: string[] };
    exec?: {
      argv0?: string;
      argv?: string[];
      cwd?: string;
    };
    side_effects?: {
      writes_possible?: boolean;
      network_possible?: boolean;
    };
    /** Message tool: platform (e.g. whatsapp, discord) */
    channel?: string;
    /** Message tool: recipient (e.g. +1234567890, channel:123) */
    recipient?: string;
    /** Message tool: combined display for Ops UI */
    channel_display?: string;
    /** web_fetch/http_request: full URL */
    url?: string;
    /** web_search: search query */
    query?: string;
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
    name === 'remove_file' ||
    name === 'edit' ||
    name === 'apply_patch'
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

  const networkPossible = context.external_network === true;
  const writesPossible =
    context.writes_files === true ||
    name === 'exec' ||
    name === 'bash' ||
    name === 'shell' ||
    name === 'run_command' ||
    name === 'gateway' ||
    name === 'cron';
  context.side_effects = {
    writes_possible: writesPossible,
    network_possible: networkPossible,
  };

  const paths = new Set<string>();
  const hosts = new Set<string>();
  const pathArgs = [
    'path',
    'file',
    'cwd',
    'workdir',
    'filePath',
    'file_path',
    'dest',
    'destination',
    'input_path',
    'output_path',
  ] as const;
  for (const key of pathArgs) {
    const val = (args as Record<string, unknown>)[key];
    if (typeof val === 'string') {
      const normalized = normalizePath(val);
      if (normalized) paths.add(normalized);
    }
  }
  if (typeof args.url === 'string') {
    const host = extractHost(args.url);
    if (host) hosts.add(host);
  }

  // Image: path or URL
  if (name === 'image' && typeof args.image === 'string') {
    if (args.image.startsWith('http://') || args.image.startsWith('https://')) {
      context.url = args.image;
      const host = extractHost(args.image);
      if (host) hosts.add(host);
    } else {
      const normalized = normalizePath(args.image);
      if (normalized) paths.add(normalized);
    }
  }

  // PDF: path
  if (name === 'pdf') {
    const pathArg = args.path ?? args.file ?? args.filePath;
    if (typeof pathArg === 'string') {
      const normalized = normalizePath(pathArg);
      if (normalized) paths.add(normalized);
    }
  }

  // Nodes: node target
  if (name === 'nodes' && typeof args.node === 'string') {
    hosts.add(`node:${args.node}`);
  }

  // Process: sessionId
  if (name === 'process' && typeof args.sessionId === 'string') {
    hosts.add(`session:${args.sessionId}`);
  }

  // Sessions: sessionKey/sessionId
  if (
    (name === 'sessions_send' || name === 'sessions_spawn' || name === 'session_status' || name === 'sessions_history') &&
    (typeof args.sessionKey === 'string' || typeof args.sessionId === 'string')
  ) {
    const key = (args.sessionKey ?? args.sessionId) as string;
    hosts.add(`session:${key}`);
  }

  // Exec metadata: tokenized command, with argv0 from first token only.
  if (
    (name === 'exec' || name === 'bash' || name === 'shell' || name === 'run_command') &&
    typeof args.command === 'string'
  ) {
    const argv = tokenizeCommand(args.command);
    context.exec = {
      argv0: argv[0],
      argv,
      cwd: typeof args.cwd === 'string' ? normalizePath(args.cwd) || args.cwd : undefined,
    };
  }

  if (paths.size > 0 || hosts.size > 0) {
    context.targets = {
      paths: paths.size > 0 ? Array.from(paths) : undefined,
      hosts: hosts.size > 0 ? Array.from(hosts) : undefined,
    };
  }

  // web_fetch / http_request: full URL for display
  if (
    (name === 'web_fetch' || name === 'http_request' || name === 'fetch') &&
    typeof args.url === 'string'
  ) {
    context.url = args.url;
  }

  // web_search: query for display
  if (name === 'web_search' && typeof args.query === 'string') {
    context.query = args.query;
  }

  // Message tool: channel (platform) and recipient (target)
  // When session-bound, channel/target may be in event or sessionContext, not params.
  if (name === 'message') {
    const event = options?.event;
    const sessionCtx = options?.sessionContext;
    const session = (sessionCtx?.session ?? event?.session) as Record<string, unknown> | undefined;
    const binding =
      (sessionCtx?.channelBinding ?? event?.channelBinding ?? session?.channelBinding ??
        sessionCtx?.threadBinding ?? event?.threadBinding) as Record<string, unknown> | undefined;
    const pick = (objs: (Record<string, unknown> | undefined)[], ...keys: string[]): string | null => {
      for (const obj of objs) {
        if (!obj) continue;
        for (const k of keys) {
          const v = obj[k];
          if (typeof v === 'string' && v.trim()) return v;
        }
      }
      return null;
    };
    const channel =
      pick(
        [args, event, sessionCtx, session, binding],
        'channel',
        'provider',
        'platform',
        'plugin'
      ) ?? null;
    const recipient =
      pick(
        [args, event, sessionCtx, session, binding],
        'target',
        'to',
        'recipient',
        'destination',
        'channelId'
      ) ?? null;
    if (channel || recipient) {
      context.channel = channel ?? undefined;
      context.recipient = recipient ?? undefined;
      context.channel_display =
        channel && recipient ? `${channel}: ${recipient}` : (channel || recipient) ?? undefined;
    } else if (typeof args.action === 'string' || typeof args.message === 'string') {
      context.channel_display = 'session-bound';
    }
  }

  // Channel gateway tools (whatsapp_login, slack, discord, etc.): platform for approval display
  const channelGatewayMap: Record<string, string> = {
    whatsapp_login: 'WhatsApp',
    slack: 'Slack',
    discord: 'Discord',
    telegram_login: 'Telegram',
    msteams_login: 'Microsoft Teams',
  };
  const channelDisplay = channelGatewayMap[name];
  if (channelDisplay) {
    context.channel = name.split('_')[0] ?? name;
    context.channel_display = channelDisplay;
  } else if (name.endsWith('_login')) {
    const platform = name.replace(/_login$/, '');
    context.channel = platform;
    context.channel_display = platform.charAt(0).toUpperCase() + platform.slice(1);
  }

  // Browser: url when navigating
  if (name === 'browser') {
    const url =
      (args.action === 'navigate' && typeof args.url === 'string' ? args.url : null) ||
      (typeof args.url === 'string' ? args.url : null);
    if (url) context.url = url;
  }

  // Nodes: run command (argv array)
  if (name === 'nodes' && Array.isArray(args.command) && args.command.length > 0 && !context.exec) {
    const argv = args.command.filter((c): c is string => typeof c === 'string');
    if (argv.length > 0) {
      context.exec = { argv0: argv[0], argv, cwd: typeof args.cwd === 'string' ? args.cwd : undefined };
    }
  }

  // Targets (file paths or URLs)
  if (typeof args.command === 'string' && !context.exec) {
    const commandTokens = tokenizeCommand(args.command);
    if (commandTokens[0]) {
      context.exec = {
        argv0: commandTokens[0],
        argv: commandTokens,
      };
    }
  }

  return context;
}
