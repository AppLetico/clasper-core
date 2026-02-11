/**
 * Typed HTTP client for communicating with Clasper Core.
 *
 * All calls include the X-Adapter-Token header.
 * Connection failures are treated as DENY (fail-closed).
 */

import type {
  AdapterRegistration,
  ExecutionRequest,
  ExecutionDecision,
  DecisionStatusResponse,
  AuditEventIngest,
  TraceIngest,
  CostMetricIngest,
  LogFn,
} from './types.js';
import { SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ClasperClientOptions {
  baseUrl: string;
  adapterId: string;
  tenantId: string;
  workspaceId: string;
  adapterSecret?: string;
  log: LogFn;
  /** Request timeout in ms (default: 10 000) */
  timeoutMs?: number;
  /** Max retries on transient errors (default: 2) */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ClasperClient {
  private readonly baseUrl: string;
  private readonly adapterId: string;
  private readonly tenantId: string;
  private readonly workspaceId: string;
  private readonly adapterSecret?: string;
  private readonly log: LogFn;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  /** JWT obtained from adapter registration. */
  private adapterToken: string | null = null;

  constructor(opts: ClasperClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.adapterId = opts.adapterId;
    this.tenantId = opts.tenantId;
    this.workspaceId = opts.workspaceId;
    this.adapterSecret = opts.adapterSecret;
    this.log = opts.log;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  // -----------------------------------------------------------------------
  // Adapter registration
  // -----------------------------------------------------------------------

  async registerAdapter(registration: AdapterRegistration): Promise<void> {
    // Bootstrap auth: mint an adapter JWT from shared secret if we don't already have one.
    if (!this.adapterToken) {
      if (!this.adapterSecret) {
        throw new Error(
          'Missing adapterSecret for adapter registration. ' +
            'Set plugins.entries.clasper-openclaw.config.adapterSecret to match ADAPTER_JWT_SECRET.'
        );
      }
      this.adapterToken = await this.buildBootstrapToken(registration.capabilities);
    }

    const res = await this.post('/adapters/register', registration, true);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Adapter registration failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.token === 'string') {
      this.adapterToken = json.token;
    }
  }

  /** Manually set the adapter JWT (e.g. when pre-provisioned). */
  setToken(token: string): void {
    this.adapterToken = token;
  }

  private async buildBootstrapToken(capabilities: string[]): Promise<string> {
    if (!this.adapterSecret) {
      throw new Error('Missing adapter secret');
    }
    const encoder = new TextEncoder();
    const secret = encoder.encode(this.adapterSecret);
    const alg = process.env.ADAPTER_JWT_ALGORITHM || 'HS256';
    return new SignJWT({
      type: 'adapter',
      adapter_id: this.adapterId,
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      allowed_capabilities: capabilities,
      sub: `adapter:${this.adapterId}`,
    })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(secret);
  }

  // -----------------------------------------------------------------------
  // Execution decisions
  // -----------------------------------------------------------------------

  /**
   * Request a pre-execution decision from Clasper Core.
   * Fail-closed: any network/server error throws so the caller blocks execution.
   */
  async requestDecision(req: ExecutionRequest): Promise<ExecutionDecision> {
    const res = await this.post('/api/execution/request', req);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `[clasper] Decision request failed (${res.status}): ${body}. ` +
        `Fail-closed: execution blocked.`
      );
    }
    return (await res.json()) as ExecutionDecision;
  }

  /**
   * Poll for the current decision state (used during approval flow).
   */
  async getDecisionStatus(executionId: string): Promise<DecisionStatusResponse> {
    const res = await this.get(`/api/execution/${encodeURIComponent(executionId)}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `[clasper] Decision status check failed (${res.status}): ${body}. ` +
        `Fail-closed: execution blocked.`
      );
    }
    return (await res.json()) as DecisionStatusResponse;
  }

  // -----------------------------------------------------------------------
  // Telemetry ingestion
  // -----------------------------------------------------------------------

  async ingestAudit(event: AuditEventIngest): Promise<void> {
    try {
      const res = await this.post('/api/ingest/audit', event);
      if (!res.ok) {
        this.log(`[clasper] Audit ingest failed (${res.status}) — non-fatal`);
      }
    } catch (err) {
      // Telemetry failures are non-fatal; governance was already enforced.
      this.log(
        `[clasper] Audit ingest error (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async ingestTrace(payload: TraceIngest): Promise<void> {
    try {
      const res = await this.post('/api/ingest/trace', payload);
      if (!res.ok) {
        this.log(`[clasper] Trace ingest failed (${res.status}) — non-fatal`);
      }
    } catch (err) {
      this.log(
        `[clasper] Trace ingest error (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async ingestCost(metric: CostMetricIngest): Promise<void> {
    try {
      const res = await this.post('/api/ingest/cost', metric);
      if (!res.ok) {
        this.log(`[clasper] Cost ingest failed (${res.status}) — non-fatal`);
      }
    } catch (err) {
      this.log(
        `[clasper] Cost ingest error (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal HTTP helpers
  // -----------------------------------------------------------------------

  private async post(
    path: string,
    body: unknown,
    requireAuth: boolean = true
  ): Promise<Response> {
    return this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(requireAuth),
      body: JSON.stringify(body),
    });
  }

  private async get(path: string): Promise<Response> {
    return this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(true),
    });
  }

  private headers(requireAuth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (requireAuth) {
      if (!this.adapterToken) {
        throw new Error('[clasper] No adapter token — register adapter first.');
      }
      h['X-Adapter-Token'] = this.adapterToken;
    }
    return h;
  }

  /**
   * Fetch with timeout and retry.
   * Retries on network errors and 5xx responses.
   * Non-retryable failures (4xx, timeout exhaustion) throw immediately.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempt: number = 0
  ): Promise<Response> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // Retry on 5xx if attempts remain
      if (res.status >= 500 && attempt < this.maxRetries) {
        const delay = Math.min(500 * 2 ** attempt, 4000);
        await sleep(delay);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return res;
    } catch (err) {
      if (attempt < this.maxRetries) {
        const delay = Math.min(500 * 2 ** attempt, 4000);
        this.log(
          `[clasper] Request to ${url} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms`
        );
        await sleep(delay);
        return this.fetchWithRetry(url, init, attempt + 1);
      }
      throw new Error(
        `[clasper] Request to ${url} failed after ${attempt + 1} attempts: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
