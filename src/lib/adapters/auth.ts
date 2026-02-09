import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../core/config.js';

export interface AdapterAuthContext {
  adapterId: string;
  tenantId: string;
  workspaceId: string;
  allowedCapabilities: string[];
  raw: JWTPayload;
}

export class AdapterAuthError extends Error {
  code: 'missing_token' | 'invalid_token' | 'config_error' | 'missing_claim';

  constructor(message: string, code: AdapterAuthError['code']) {
    super(message);
    this.name = 'AdapterAuthError';
    this.code = code;
  }
}

export interface AdapterTokenClaims {
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  allowed_capabilities: string[];
}

export async function buildAdapterToken(
  claims: AdapterTokenClaims,
  expiresIn: string = '2h'
): Promise<string> {
  if (!config.adapterJwtSecret) {
    throw new AdapterAuthError('ADAPTER_JWT_SECRET is required to mint adapter tokens.', 'config_error');
  }

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.adapterJwtSecret);

  return await new SignJWT({
    type: 'adapter',
    adapter_id: claims.adapter_id,
    tenant_id: claims.tenant_id,
    workspace_id: claims.workspace_id,
    allowed_capabilities: claims.allowed_capabilities,
    sub: `adapter:${claims.adapter_id}`,
  })
    .setProtectedHeader({ alg: config.adapterJwtAlgorithm })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyAdapterToken(token: string): Promise<AdapterAuthContext> {
  if (!config.adapterJwtSecret) {
    throw new AdapterAuthError('ADAPTER_JWT_SECRET is required to verify adapter tokens.', 'config_error');
  }

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.adapterJwtSecret);
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: [config.adapterJwtAlgorithm] }));
  } catch (error) {
    throw new AdapterAuthError('Invalid adapter token', 'invalid_token');
  }

  if (payload.type !== 'adapter') {
    throw new AdapterAuthError('Invalid adapter token type', 'invalid_token');
  }

  const adapterId = payload.adapter_id;
  const tenantId = payload.tenant_id;
  const workspaceId = payload.workspace_id;
  const allowedCapabilities = payload.allowed_capabilities;

  if (
    typeof adapterId !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof workspaceId !== 'string' ||
    !Array.isArray(allowedCapabilities)
  ) {
    throw new AdapterAuthError('Missing required adapter claims', 'missing_claim');
  }

  if (tenantId !== config.localTenantId) {
    throw new AdapterAuthError('Tenant mismatch for single-tenant Core', 'invalid_token');
  }
  if (config.localWorkspaceId && workspaceId !== config.localWorkspaceId) {
    throw new AdapterAuthError('Workspace mismatch for single-tenant Core', 'invalid_token');
  }

  return {
    adapterId,
    tenantId,
    workspaceId,
    allowedCapabilities: allowedCapabilities.filter((c): c is string => typeof c === 'string'),
    raw: payload,
  };
}

export async function requireAdapterContextFromHeaders(
  headers: Record<string, unknown>
): Promise<AdapterAuthContext> {
  const token = headers['x-adapter-token'];
  if (!token || typeof token !== 'string') {
    throw new AdapterAuthError('Missing adapter token', 'missing_token');
  }

  return verifyAdapterToken(token);
}
