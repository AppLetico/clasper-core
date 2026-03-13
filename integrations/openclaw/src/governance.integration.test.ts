/**
 * OpenClaw governance integration tests.
 *
 * Tests adversarial scenarios: allow, deny, require_approval, unknown-tool fallback.
 * Requires Clasper server + seeded policies. Uses adapter JWT for auth.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAdapterToken } from '../../../src/lib/adapters/auth.js';
import { upsertPolicy } from '../../../src/lib/policy/policyStore.js';

vi.mock('../../../src/lib/providers/openaiClient.js', () => ({
  generateAgentReply: vi.fn(async () => 'Plan response'),
}));

vi.mock('../../../src/lib/integrations/missionControl.js', () => ({
  listTasks: vi.fn(async () => []),
  createTask: vi.fn(async () => ({ id: 'task-1' })),
  postMessage: vi.fn(async () => ({})),
  postDocument: vi.fn(async () => ({})),
}));

let buildApp: () => { inject: (opts: { method: string; url: string; payload?: object; headers?: Record<string, string> }) => Promise<{ statusCode: number; json: () => object }> };
let adapterToken: string;

const tenantId = 'local';
const workspaceId = 'local';
const adapterId = 'openclaw-local';

function seedOpenClawPolicies() {
  upsertPolicy({
    tenantId,
    policy: {
      policy_id: 'openclaw-allow-read',
      subject: { type: 'tool', name: 'read' },
      conditions: { tool: 'read', tool_group: 'fs' },
      effect: { decision: 'allow' },
      precedence: 10,
      enabled: true,
    },
  });
  upsertPolicy({
    tenantId,
    policy: {
      policy_id: 'openclaw-deny-delete',
      subject: { type: 'tool', name: 'delete' },
      conditions: { tool: 'delete', tool_group: 'fs' },
      effect: { decision: 'deny' },
      precedence: 30,
      enabled: true,
    },
  });
  upsertPolicy({
    tenantId,
    policy: {
      policy_id: 'openclaw-require-approval-exec',
      subject: { type: 'tool', name: 'exec' },
      conditions: { tool: 'exec', tool_group: 'runtime' },
      effect: { decision: 'require_approval' },
      precedence: 20,
      enabled: true,
    },
  });
  upsertPolicy({
    tenantId,
    policy: {
      policy_id: 'openclaw-fallback-require-approval',
      subject: { type: 'tool' },
      effect: { decision: 'require_approval' },
      precedence: -100,
      enabled: true,
    },
  });
}

beforeAll(async () => {
  process.env.CLASPER_TEST_MODE = 'true';
  process.env.AGENT_JWT_SECRET = 'test-secret';
  process.env.ADAPTER_JWT_SECRET = process.env.ADAPTER_JWT_SECRET || 'test-adapter-secret';
  process.env.AGENT_DAEMON_API_KEY = '';
  process.env.BACKEND_URL = 'http://localhost:8000';
  process.env.CLASPER_WORKSPACE = './test-workspace';
  process.env.CLASPER_POLICY_OPERATORS = 'true';

  const mod = await import('../../../src/server/index.js');
  buildApp = mod.buildApp;

  adapterToken = await buildAdapterToken({
    adapter_id: adapterId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    allowed_capabilities: ['read', 'delete', 'exec', 'send_payment', 'unknown_tool'],
  });
});

beforeEach(() => {
  seedOpenClawPolicies();
});

describe('OpenClaw execution request', () => {
  it('allows read tool', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/request',
      headers: { 'X-Adapter-Token': adapterToken },
      payload: {
        adapter_id: adapterId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        requested_capabilities: ['read'],
        tool: 'read',
        tool_group: 'fs',
        tool_count: 1,
        context: {},
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.allowed).toBe(true);
    expect(body.decision).toBe('allow');
  });

  it('denies delete tool', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/request',
      headers: { 'X-Adapter-Token': adapterToken },
      payload: {
        adapter_id: adapterId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        requested_capabilities: ['delete'],
        tool: 'delete',
        tool_group: 'fs',
        tool_count: 1,
        context: { writes_files: true, targets: { paths: ['/tmp/foo'] } },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.allowed).toBe(false);
    expect(body.decision).toBe('deny');
    expect(body.blocked_reason).toBeDefined();
  });

  it('requires approval for exec tool (or auto-allowed in simulate mode)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/request',
      headers: { 'X-Adapter-Token': adapterToken },
      payload: {
        adapter_id: adapterId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        requested_capabilities: ['exec'],
        tool: 'exec',
        tool_group: 'runtime',
        tool_count: 1,
        context: { exec: { argv0: 'rm', argv: ['rm', '-rf', '/'] } },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Enforce: require_approval/pending. Simulate: allow (auto-allowed from require_approval).
    const decision = body.decision as string;
    expect(['require_approval', 'pending', 'allow']).toContain(decision);
    if (decision !== 'allow') {
      expect(body.decision_id).toBeDefined();
    }
  });

  it('unknown tool hits fallback and requires approval', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/request',
      headers: { 'X-Adapter-Token': adapterToken },
      payload: {
        adapter_id: adapterId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        requested_capabilities: ['send_payment'],
        tool: 'send_payment',
        tool_group: 'custom',
        tool_count: 1,
        context: {},
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(['require_approval', 'pending']).toContain(body.decision);
  });
});

describe('OpenClaw policy posture', () => {
  it('returns fallback status for adapter', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/adapter/policy-posture',
      headers: { 'X-Adapter-Token': adapterToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.fallback_present).toBe(true);
    expect(body.fallback_enabled).toBe(true);
    expect(Array.isArray(body.covered_tools)).toBe(true);
  });
});
