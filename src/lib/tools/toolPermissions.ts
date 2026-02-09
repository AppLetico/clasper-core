/**
 * Tool Permission System
 *
 * Two-layer permission checking:
 * 1. Skill layer: Fast local check against skill manifest
 * 2. Backend layer: Authoritative tenant-level validation (via proxy)
 *
 * If skill doesn't allow a tool, we fail fast without hitting backend.
 */

import { SkillManifest } from '../skills/skillManifest.js';
import { ToolProxy, ToolCall, ToolResult, ToolContext } from './toolProxy.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a permission check
 */
export interface PermissionResult {
  allowed: boolean;
  reason?: PermissionDeniedReason;
  details?: string;
}

/**
 * Reasons why a tool call might be denied
 */
export type PermissionDeniedReason =
  | 'not_in_skill_manifest'
  | 'not_in_tenant_permissions'
  | 'skill_not_specified'
  | 'budget_exceeded'
  | 'model_not_allowed'
  | 'rate_limited';

/**
 * Audit event for tool permission checks
 */
export interface ToolPermissionEvent {
  timestamp: string;
  traceId: string;
  tenantId: string;
  toolName: string;
  allowed: boolean;
  reason?: PermissionDeniedReason;
  skillName?: string;
  skillVersion?: string;
  durationMs?: number;
}

/**
 * Logger interface for permission events
 */
export interface PermissionLogger {
  log(event: ToolPermissionEvent): void;
}

// ============================================================================
// Permission Checker Class
// ============================================================================

export class ToolPermissionChecker {
  private toolProxy: ToolProxy;
  private logger?: PermissionLogger;

  constructor(options: {
    toolProxy: ToolProxy;
    logger?: PermissionLogger;
  }) {
    this.toolProxy = options.toolProxy;
    this.logger = options.logger;
  }

  /**
   * Check if a tool call is allowed by the skill manifest (fast, local)
   */
  checkSkillPermission(toolName: string, skill?: SkillManifest): PermissionResult {
    // If no skill is specified, we can't validate against skill permissions
    if (!skill) {
      return {
        allowed: true, // Allow by default if no skill context
      };
    }

    // Get allowed tools from skill permissions
    const allowedTools = skill.permissions?.tools || [];

    // Check if tool is in the allowed list
    if (allowedTools.length === 0) {
      // No tools specified = no tools allowed
      return {
        allowed: false,
        reason: 'not_in_skill_manifest',
        details: `Skill ${skill.name} does not permit any tools`,
      };
    }

    // Check for wildcard
    if (allowedTools.includes('*')) {
      return { allowed: true };
    }

    // Check for exact match
    if (allowedTools.includes(toolName)) {
      return { allowed: true };
    }

    // Check for namespace match (e.g., "tickets:*" matches "tickets:read")
    const toolNamespace = toolName.split(':')[0];
    if (allowedTools.some((t) => t === `${toolNamespace}:*`)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'not_in_skill_manifest',
      details: `Skill ${skill.name} does not permit tool: ${toolName}. Allowed: ${allowedTools.join(', ')}`,
    };
  }

  /**
   * Full permission check: skill-only (single-tenant OSS)
   */
  checkPermission(toolName: string, skill?: SkillManifest): PermissionResult {
    // First, check skill permissions (fast, local)
    const skillCheck = this.checkSkillPermission(toolName, skill);
    if (!skillCheck.allowed) {
      return skillCheck;
    }
    return { allowed: true };
  }

  /**
   * Validate and proxy a tool call
   * Performs permission checks before proxying to backend
   */
  async validateAndProxy(
    call: ToolCall,
    context: {
      tenantId: string;
      workspaceId: string;
      userId: string;
      traceId: string;
      agentToken: string;
      skill?: SkillManifest;
    }
  ): Promise<ToolResult> {
    const start = Date.now();

    // Check permissions first
    const permission = this.checkPermission(call.name, context.skill);

    if (!permission.allowed) {
      const durationMs = Date.now() - start;

      // Log the denied permission
      this.logPermissionEvent({
        timestamp: new Date().toISOString(),
        traceId: context.traceId,
      tenantId: context.tenantId,
        toolName: call.name,
        allowed: false,
        reason: permission.reason,
        skillName: context.skill?.name,
        skillVersion: context.skill?.version,
        durationMs,
      });

      return {
        toolCallId: call.id,
        success: false,
        error: `Permission denied: ${permission.details || permission.reason}`,
        durationMs,
      };
    }

    // Proxy to backend
    const toolContext: ToolContext = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      traceId: context.traceId,
      agentToken: context.agentToken,
      userId: context.userId,
    };

    const result = await this.toolProxy.execute(call, toolContext);

    // Log the successful permission check
    this.logPermissionEvent({
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      tenantId: context.tenantId,
      toolName: call.name,
      allowed: true,
      skillName: context.skill?.name,
      skillVersion: context.skill?.version,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Validate and proxy multiple tool calls
   */
  async validateAndProxyMany(
    calls: ToolCall[],
    context: {
      tenantId: string;
      workspaceId: string;
      userId: string;
      traceId: string;
      agentToken: string;
      skill?: SkillManifest;
    }
  ): Promise<ToolResult[]> {
    return Promise.all(
      calls.map((call) => this.validateAndProxy(call, context))
    );
  }

  /**
   * Pre-validate tool calls without executing
   * Useful for checking permissions before starting a multi-tool operation
   */
  preValidate(
    toolNames: string[],
    skill?: SkillManifest
  ): Map<string, PermissionResult> {
    const results = new Map<string, PermissionResult>();

    for (const toolName of toolNames) {
      results.set(toolName, this.checkPermission(toolName, skill));
    }

    return results;
  }

  /**
   * Get all tools that a tenant+skill combination can use
   */
  getAllowedTools(
    availableTools: string[],
    skill?: SkillManifest
  ): string[] {
    return availableTools.filter((toolName) => {
      const result = this.checkPermission(toolName, skill);
      return result.allowed;
    });
  }

  /**
   * Log a permission event
   */
  private logPermissionEvent(event: ToolPermissionEvent): void {
    if (this.logger) {
      this.logger.log(event);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let permissionCheckerInstance: ToolPermissionChecker | null = null;

/**
 * Get or create the ToolPermissionChecker instance
 */
export function getToolPermissionChecker(
  toolProxy?: ToolProxy,
  logger?: PermissionLogger
): ToolPermissionChecker {
  if (!permissionCheckerInstance) {
    if (!toolProxy) {
      throw new Error('ToolProxy is required to create ToolPermissionChecker');
    }
    permissionCheckerInstance = new ToolPermissionChecker({
      toolProxy,
      logger,
    });
  }
  return permissionCheckerInstance;
}

/**
 * Reset the permission checker instance (for testing)
 */
export function resetToolPermissionChecker(): void {
  permissionCheckerInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a simple console logger for permission events
 */
export function createConsolePermissionLogger(): PermissionLogger {
  return {
    log(event: ToolPermissionEvent): void {
      const status = event.allowed ? 'ALLOWED' : 'DENIED';
      const reason = event.reason ? ` (${event.reason})` : '';
      console.log(
        `[PERMISSION] ${status}${reason} tool=${event.toolName} tenant=${event.tenantId} trace=${event.traceId}`
      );
    },
  };
}

/**
 * Parse permission errors into user-friendly messages
 */
export function formatPermissionError(result: PermissionResult): string {
  if (result.allowed) {
    return 'Permission granted';
  }

  switch (result.reason) {
    case 'not_in_skill_manifest':
      return 'This tool is not permitted by the current skill';
    case 'not_in_tenant_permissions':
      return 'Your account does not have permission to use this tool';
    case 'skill_not_specified':
      return 'No skill context available for permission check';
    case 'budget_exceeded':
      return 'Budget limit exceeded for this operation';
    case 'model_not_allowed':
      return 'The requested model is not available for your account';
    case 'rate_limited':
      return 'Too many requests. Please try again later.';
    default:
      return result.details || 'Permission denied';
  }
}
