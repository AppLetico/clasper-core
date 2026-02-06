import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../core/config.js';

export interface DecisionTokenClaims {
  tenant_id: string;
  workspace_id: string;
  adapter_id: string;
  execution_id: string;
  decision_id: string;
  granted_scope: Record<string, unknown>;
}

export interface IssuedDecisionToken {
  token: string;
  jti: string;
  expires_at: string;
}

export class DecisionTokenError extends Error {
  code: 'config_error' | 'invalid_token' | 'expired' | 'used';

  constructor(message: string, code: DecisionTokenError['code']) {
    super(message);
    this.name = 'DecisionTokenError';
    this.code = code;
  }
}

export async function issueDecisionToken(
  claims: DecisionTokenClaims
): Promise<IssuedDecisionToken> {
  if (!config.decisionTokenSecret) {
    throw new DecisionTokenError('CLASPER_DECISION_TOKEN_SECRET is required', 'config_error');
  }

  const jti = uuidv7();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + config.decisionTokenTtlSeconds;

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.decisionTokenSecret);

  const token = await new SignJWT({
    typ: 'decision_token',
    tenant_id: claims.tenant_id,
    workspace_id: claims.workspace_id,
    adapter_id: claims.adapter_id,
    execution_id: claims.execution_id,
    decision_id: claims.decision_id,
    granted_scope: claims.granted_scope,
  })
    .setProtectedHeader({ alg: config.decisionTokenAlgorithm })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(secret);

  return {
    token,
    jti,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyDecisionToken(token: string): Promise<{ payload: Record<string, unknown> }> {
  if (!config.decisionTokenSecret) {
    throw new DecisionTokenError('CLASPER_DECISION_TOKEN_SECRET is required', 'config_error');
  }

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.decisionTokenSecret);

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [config.decisionTokenAlgorithm],
    });
    return { payload };
  } catch {
    throw new DecisionTokenError('Invalid decision token', 'invalid_token');
  }
}
