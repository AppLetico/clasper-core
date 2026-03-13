/**
 * Security Utilities
 * 
 * Inspired by OpenClaw's security hardening PRs (2026.2.1 release):
 * - Path traversal prevention
 * - Prompt injection sanitization
 * - TLS hardening
 * - Input validation
 */

import * as tls from 'node:tls';
import * as path from 'node:path';

// ============================================================================
// TLS Hardening
// ============================================================================

/**
 * Enforce TLS 1.3 as minimum version.
 * Call this at application startup before any HTTPS connections.
 * 
 * @see OpenClaw PR: "require TLS 1.3 as minimum"
 */
export function enforceTLS13Minimum(): void {
  // TypeScript types show this as readonly, but it's writable at runtime
  (tls as { DEFAULT_MIN_VERSION: string }).DEFAULT_MIN_VERSION = 'TLSv1.3';
}

// ============================================================================
// Path Security
// ============================================================================

/**
 * Validate that a path is safe and doesn't escape the allowed root.
 * Prevents path traversal attacks (LFI/directory traversal).
 * 
 * @see OpenClaw PR: "security(message-tool): validate filePath/path against sandbox root"
 * @see OpenClaw PR: "fix(security): restrict local path extraction in media parser to prevent LFI"
 */
export function isPathSafe(inputPath: string, allowedRoot: string): boolean {
  if (!inputPath || !allowedRoot) {
    return false;
  }

  try {
    // Normalize both paths to handle . and ..
    const normalizedRoot = path.resolve(allowedRoot);
    const normalizedPath = path.resolve(allowedRoot, inputPath);

    // Check if the resolved path starts with the allowed root
    // This prevents ../../../etc/passwd style attacks
    if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
      return false;
    }

    // Additional checks for suspicious patterns
    const suspiciousPatterns = [
      /\.\./,           // Parent directory reference
      /^\/etc\//,       // Unix sensitive paths
      /^\/proc\//,      // Linux proc filesystem
      /^\/dev\//,       // Device files
      /^[A-Z]:\\Windows/i,  // Windows system paths
      /^[A-Z]:\\Users\\[^\\]+\\AppData/i, // Windows user data
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(inputPath)) {
        return false;
      }
    }

    return true;
  } catch {
    // Any path resolution error means the path is unsafe
    return false;
  }
}

/**
 * Sanitize a path by removing dangerous components.
 * Returns null if the path cannot be made safe.
 */
export function sanitizePath(inputPath: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  // Remove null bytes (can bypass checks in some systems)
  let sanitized = inputPath.replace(/\0/g, '');

  // Remove leading slashes to prevent absolute paths
  sanitized = sanitized.replace(/^[/\\]+/, '');

  // Remove parent directory references
  sanitized = sanitized.replace(/\.\.[/\\]/g, '');

  // Remove any remaining ..
  sanitized = sanitized.replace(/\.\./g, '');

  // If nothing left, return null
  if (!sanitized || sanitized === '.' || sanitized === '/' || sanitized === '\\') {
    return null;
  }

  return sanitized;
}

// ============================================================================
// Prompt Injection Prevention
// ============================================================================

/**
 * Known prompt injection patterns to sanitize.
 * These patterns can trick the LLM into ignoring instructions.
 * 
 * @see OpenClaw PR: "fix(security): prevent prompt injection via external hooks"
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI-style tokens
  { pattern: /<\|im_start\|>/gi, replacement: '[removed:im_start]' },
  { pattern: /<\|im_end\|>/gi, replacement: '[removed:im_end]' },
  { pattern: /<\|endoftext\|>/gi, replacement: '[removed:endoftext]' },
  { pattern: /<\|system\|>/gi, replacement: '[removed:system]' },
  { pattern: /<\|user\|>/gi, replacement: '[removed:user]' },
  { pattern: /<\|assistant\|>/gi, replacement: '[removed:assistant]' },
  
  // Anthropic/Claude format
  { pattern: /\[INST\]/gi, replacement: '[removed:INST]' },
  { pattern: /\[\/INST\]/gi, replacement: '[removed:/INST]' },
  { pattern: /<<SYS>>/gi, replacement: '[removed:SYS]' },
  { pattern: /<<\/SYS>>/gi, replacement: '[removed:/SYS]' },
  
  // Llama/generic format
  { pattern: /Human:\s*$/gim, replacement: 'Human (sanitized):' },
  { pattern: /Assistant:\s*$/gim, replacement: 'Assistant (sanitized):' },
  { pattern: /System:\s*$/gim, replacement: 'System (sanitized):' },
  
  // Common injection attempts
  { pattern: /ignore (?:all )?(?:previous|prior|above) instructions?/gi, replacement: '[removed:instruction_override]' },
  { pattern: /disregard (?:all )?(?:previous|prior|above)/gi, replacement: '[removed:instruction_override]' },
  { pattern: /forget (?:everything|all) (?:you know|above)/gi, replacement: '[removed:instruction_override]' },
  { pattern: /you are now/gi, replacement: '[removed:role_hijack]' },
  { pattern: /pretend you are/gi, replacement: '[removed:role_hijack]' },
  { pattern: /act as if you/gi, replacement: '[removed:role_hijack]' },
  
  // XML/tag-based injection
  { pattern: /<\/?system>/gi, replacement: '[removed:xml_system]' },
  { pattern: /<\/?instructions?>/gi, replacement: '[removed:xml_instructions]' },
  { pattern: /<\/?rules?>/gi, replacement: '[removed:xml_rules]' },
];

/**
 * Sanitize external content to prevent prompt injection.
 * Use this before including any external data in prompts.
 * 
 * @param content - Raw content from external source (API, webhook, user input)
 * @param options - Sanitization options
 * @returns Sanitized content safe to include in prompts
 * 
 * @see OpenClaw PR: "fix(security): prevent prompt injection via external hooks (gmail, webhooks)"
 */
export function sanitizeForPrompt(
  content: string,
  options: {
    /** Maximum length to allow (truncates if exceeded) */
    maxLength?: number;
    /** Replace suspicious patterns vs. just flag them */
    mode?: 'replace' | 'flag';
    /** Source identifier for audit logging */
    source?: string;
  } = {}
): { content: string; sanitized: boolean; patterns: string[] } {
  const { maxLength = 50000, mode = 'replace' } = options;
  
  if (!content || typeof content !== 'string') {
    return { content: '', sanitized: false, patterns: [] };
  }

  let result = content;
  const foundPatterns: string[] = [];

  // Apply all sanitization patterns
  for (const { pattern, replacement } of INJECTION_PATTERNS) {
    if (pattern.test(result)) {
      foundPatterns.push(replacement.replace(/\[removed:|\]/g, ''));
      if (mode === 'replace') {
        result = result.replace(pattern, replacement);
      }
    }
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
  }

  // Truncate if too long
  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + '\n[content truncated]';
    foundPatterns.push('length_exceeded');
  }

  return {
    content: result,
    sanitized: foundPatterns.length > 0,
    patterns: foundPatterns
  };
}

/**
 * Check if content contains potential injection patterns without modifying it.
 * Useful for logging/alerting without blocking.
 */
export function detectInjectionPatterns(content: string): string[] {
  const patterns: string[] = [];
  
  for (const { pattern, replacement } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      patterns.push(replacement.replace(/\[removed:|\]/g, ''));
    }
    pattern.lastIndex = 0;
  }
  
  return patterns;
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Validate that a URL is safe to fetch.
 * Prevents SSRF (Server-Side Request Forgery) attacks.
 */
export function isUrlSafe(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Block private/internal IPs
    const hostname = parsed.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
      /\.local$/,
      /\.internal$/,
      /^metadata\./,  // Cloud metadata endpoints
      /^169\.254\./,  // Link-local / cloud metadata
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Format a timestamp in UTC with explicit timezone marker.
 * Useful for debugging async/out-of-order events.
 * 
 * @see OpenClaw PR: "Add UTC timestamp to background exec exit notifications"
 */
export function formatUTCTimestamp(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  
  return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC]`;
}

/**
 * Get current UTC timestamp string.
 */
export function nowUTC(): string {
  return formatUTCTimestamp(new Date());
}

// ============================================================================
// Exports
// ============================================================================

export const security = {
  // TLS
  enforceTLS13Minimum,
  
  // Paths
  isPathSafe,
  sanitizePath,
  
  // Prompts
  sanitizeForPrompt,
  detectInjectionPatterns,
  
  // URLs
  isUrlSafe,
  
  // Timing
  formatUTCTimestamp,
  nowUTC,
};
