import { config } from "../core/config.js";

export type OpsRole = "viewer" | "operator" | "release_manager" | "admin";

export interface OpsContext {
  userId: string;
  tenantId: string;
  workspaceId: string;
  roles: OpsRole[];
  role: OpsRole;
  allowedTenants: string[];
  raw: Record<string, unknown>;
}

export type Permission = string;

export class OpsAuthError extends Error {
  code: "missing_token" | "invalid_token" | "config_error";

  constructor(message: string, code: OpsAuthError["code"]) {
    super(message);
    this.name = "OpsAuthError";
    this.code = code;
  }
}

export class PermissionError extends Error {
  permission: Permission;
  requiredRoles: OpsRole[];

  constructor(permission: Permission, _role: OpsRole) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionError";
    this.permission = permission;
    this.requiredRoles = ["operator"];
  }
}

export async function requireOpsContextFromHeaders(
  headers: Record<string, unknown>
): Promise<OpsContext> {
  const requiredKey = config.opsLocalApiKey;
  if (requiredKey) {
    const provided = headers["x-ops-api-key"];
    if (!provided || typeof provided !== "string") {
      throw new OpsAuthError("Missing ops API key", "missing_token");
    }
    if (provided !== requiredKey) {
      throw new OpsAuthError("Invalid ops API key", "invalid_token");
    }
  }

  return {
    userId: "local-operator",
    tenantId: config.localTenantId,
    workspaceId: config.localWorkspaceId,
    roles: ["operator"],
    role: "operator",
    allowedTenants: [],
    raw: {}
  };
}

export function canAccessTenant(context: OpsContext, tenantId: string): boolean {
  return context.tenantId === tenantId;
}

export function canAccessWorkspace(context: OpsContext, workspaceId?: string): boolean {
  if (!workspaceId) return true;
  return context.workspaceId === workspaceId;
}

export function requireRole(_context: OpsContext, _minimumRole: OpsRole): void {
  // Single-tenant local ops: no role gating.
}

export function requirePermission(_context: OpsContext, _permission: Permission): void {
  // Single-tenant local ops: no permission registry.
}

export function getContextPermissions(_context: OpsContext): Permission[] {
  return [];
}
