import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPolicy } from "../lib/policy/policyStore.js";
import { getAuditLog } from "../lib/governance/auditLog.js";
import { createDecision, getDecision, resolveDecision } from "../lib/governance/decisions.js";

vi.mock("../lib/providers/openaiClient.js", () => ({
  generateAgentReply: vi.fn(async () => "Plan response")
}));

vi.mock("../lib/integrations/missionControl.js", () => ({
  listTasks: vi.fn(async () => []),
  createTask: vi.fn(async () => ({ id: "task-1" })),
  postMessage: vi.fn(async () => ({})),
  postDocument: vi.fn(async () => ({}))
}));

let buildApp: () => any;

async function buildAppWithEnv(overrides: Record<string, string>) {
  vi.resetModules();
  process.env = {
    ...process.env,
    CLASPER_TEST_MODE: "true",
    AGENT_JWT_SECRET: "test-secret",
    AGENT_DAEMON_API_KEY: "",
    BACKEND_URL: "http://localhost:8000",
    CLASPER_WORKSPACE: "./test-workspace",
    ...overrides
  };
  const mod = await import("./index.js");
  return mod.buildApp;
}

beforeAll(async () => {
  process.env.CLASPER_TEST_MODE = "true";
  process.env.AGENT_JWT_SECRET = "test-secret";
  process.env.AGENT_DAEMON_API_KEY = "";
  process.env.BACKEND_URL = "http://localhost:8000";
  process.env.CLASPER_WORKSPACE = "./test-workspace";
  const mod = await import("./index.js");
  buildApp = mod.buildApp;
});

describe("/api/agents/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates task with task_title, posts message and plan doc", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:jarvis",
        message: "Generate plan",
        task_title: "Test Task",
        metadata: { kickoff_plan: true }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("task-1");
  });

  it("uses provided task_id directly", async () => {
    const { postMessage } = await import("../lib/integrations/missionControl.js");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello",
        task_id: "existing-task-123"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("existing-task-123");
  });

  it("uses CLASPER_DEFAULT_TASK when no task_id or task_title provided", async () => {
    // Config is loaded at module import time, so we must build an app with
    // CLASPER_DEFAULT_TASK set in the env for this test.
    const buildAppWithDefaultTask = await buildAppWithEnv({
      CLASPER_DEFAULT_TASK: "Default Task"
    });
    const app = buildAppWithDefaultTask();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello"
        // No task_id or task_title - uses CLASPER_DEFAULT_TASK from env
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBeDefined();
  });

  it("rejects mismatched user_id", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-2",
        session_key: "user:user-1:jarvis",
        message: "Generate plan",
        task_title: "Test Task"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("finds existing task by title instead of creating new one", async () => {
    const { listTasks, createTask } = await import("../lib/integrations/missionControl.js");
    // Mock listTasks to return an existing task
    vi.mocked(listTasks).mockResolvedValueOnce([
      { id: "existing-task", title: "Existing Task", status: "in_progress" }
    ]);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello",
        task_title: "Existing Task"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("existing-task");
    // Should not have called createTask since task exists
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("Smart context endpoints", () => {
  it("returns context stats", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/context/stats"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("indexedChunks");
    expect(body).toHaveProperty("indexedSkills");
    expect(body).toHaveProperty("indexedMemoryChunks");
    expect(body).toHaveProperty("embeddingProvider");
  });

  it("reindexes workspace", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/workspace/reindex"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("indexedChunks");
    expect(body).toHaveProperty("indexedSkills");
    expect(body).toHaveProperty("indexedMemoryChunks");
    expect(body).toHaveProperty("embeddingProvider");
  });
});

describe("Smart context daemon key guardrails", () => {
  it("rejects missing daemon key when configured", async () => {
    const build = await buildAppWithEnv({ AGENT_DAEMON_API_KEY: "secret-key" });
    const app = build();
    const response = await app.inject({
      method: "GET",
      url: "/context/stats"
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects incorrect daemon key", async () => {
    const build = await buildAppWithEnv({ AGENT_DAEMON_API_KEY: "secret-key" });
    const app = build();
    const response = await app.inject({
      method: "POST",
      url: "/workspace/reindex",
      headers: {
        "x-agent-daemon-key": "wrong-key"
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("accepts correct daemon key", async () => {
    const build = await buildAppWithEnv({ AGENT_DAEMON_API_KEY: "secret-key" });
    const app = build();
    const response = await app.inject({
      method: "POST",
      url: "/workspace/reindex",
      headers: {
        "x-agent-daemon-key": "secret-key"
      }
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Ops console auth guardrails", () => {
  it("requires Authorization header for /ops/api/me", async () => {
    // Require ops API key so auth is enforced
    const buildAppWithAuth = await buildAppWithEnv({
      OPS_LOCAL_API_KEY: "ops-secret"
    });
    const app = buildAppWithAuth();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/me"
    });

    expect(response.statusCode).toBe(401);
  });

  it("requires Authorization header for /ops/api/traces", async () => {
    const buildAppWithAuth = await buildAppWithEnv({
      OPS_LOCAL_API_KEY: "ops-secret"
    });
    const app = buildAppWithAuth();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/traces"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns policy manage permission for local operator", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/me",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.permissions)).toBe(true);
    expect(body.permissions).toContain("policy:manage");
  });
});

describe("Policy wizard guardrails", () => {
  it("rejects allow wizard policy without acknowledgement and has no side effects", async () => {
    const app = buildApp();
    const policyId = "policy-wizard-ack-required-test";
    const sourceTraceId = "018f84d8-8c6e-7a7a-8b8b-9b9b9b9b9b9b";
    const tenantId = "local";
    const workspaceId = "local";

    const response = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: policyId,
        scope: { tenant_id: tenantId, workspace_id: workspaceId },
        subject: { type: "tool", name: "exec" },
        conditions: { tool: "exec" },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _source_trace_id: sourceTraceId,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: ["high_risk_allow_attempt"],
          wizard_acknowledged_allow: false,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "wizard_allow_ack_required",
    });

    const policy = getPolicy(tenantId, policyId);
    expect(policy).toBeNull();

    const audit = getAuditLog().query({
      tenantId,
      traceId: sourceTraceId,
      eventTypes: ["policy_created_from_trace", "policy_created_via_wizard"],
      limit: 10,
      offset: 0,
    });
    expect(audit.entries.length).toBe(0);
  });

  it("updates existing wizard policy and emits policy_updated_via_wizard", async () => {
    const app = buildApp();
    const tenantId = "local";
    const policyId = "policy-wizard-update-test";

    const createResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: policyId,
        scope: { tenant_id: tenantId, workspace_id: "local" },
        subject: { type: "tool", name: "exec" },
        conditions: {
          tool: "exec",
          "context.exec.argv0": { in: ["ls"] },
        },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: true,
        },
      },
    });
    expect(createResponse.statusCode).toBe(200);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: policyId,
        scope: { tenant_id: tenantId, workspace_id: "local" },
        subject: { type: "tool", name: "exec" },
        conditions: {
          tool: "exec",
          "context.exec.argv0": { in: ["ls", "pwd"] },
          "context.targets.paths": { all_under: ["{{workspace.root}}"] },
        },
        effect: { decision: "allow" },
        precedence: 40,
        enabled: true,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "list",
          warnings_shown: ["broad_scope"],
          wizard_acknowledged_allow: true,
        },
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updatedPolicy = getPolicy(tenantId, policyId);
    expect(updatedPolicy).not.toBeNull();
    expect(updatedPolicy?.precedence).toBe(40);

    const audit = getAuditLog().query({
      tenantId,
      eventTypes: ["policy_updated_via_wizard"],
      limit: 10,
      offset: 0,
    });
    expect(audit.entries.length).toBeGreaterThan(0);
    const match = audit.entries.find((entry) => {
      const data = entry.eventData as Record<string, unknown>;
      return data.policy_id === policyId;
    });
    expect(match).toBeDefined();
    const eventData = match!.eventData as Record<string, unknown>;
    expect(eventData.policy_summary_before).toBeDefined();
    expect(eventData.policy_summary_after).toBeDefined();
    expect(eventData.policy_summary_before_hash).toBeDefined();
    expect(eventData.policy_summary_after_hash).toBeDefined();
  });

  it("rejects wizard policy update to allow without acknowledgement and has no side effects", async () => {
    const app = buildApp();
    const tenantId = "local";
    const policyId = "policy-wizard-update-ack-required-test";

    const createResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: policyId,
        scope: { tenant_id: tenantId, workspace_id: "local" },
        subject: { type: "tool", name: "exec" },
        conditions: { tool: "exec" },
        effect: { decision: "require_approval" },
        precedence: 20,
        enabled: true,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "require_approval",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: false,
        },
      },
    });
    expect(createResponse.statusCode).toBe(200);

    const before = getPolicy(tenantId, policyId);
    expect(before).not.toBeNull();
    expect(before?.effect.decision).toBe("require_approval");

    const updateAuditBefore = getAuditLog().query({
      tenantId,
      eventTypes: ["policy_updated_via_wizard"],
      limit: 200,
      offset: 0,
    });
    const updateAuditCountBefore = updateAuditBefore.entries.filter((entry) => {
      const eventData = entry.eventData as Record<string, unknown>;
      return eventData.policy_id === policyId;
    }).length;

    const updateResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: policyId,
        scope: { tenant_id: tenantId, workspace_id: "local" },
        subject: { type: "tool", name: "exec" },
        conditions: { tool: "exec" },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: ["high_risk_allow_attempt"],
          wizard_acknowledged_allow: false,
        },
      },
    });

    expect(updateResponse.statusCode).toBe(400);
    expect(updateResponse.json()).toMatchObject({
      code: "wizard_allow_ack_required",
    });

    const after = getPolicy(tenantId, policyId);
    expect(after).not.toBeNull();
    expect(after?.effect.decision).toBe("require_approval");
    expect(after?.precedence).toBe(before?.precedence);

    const updateAudit = getAuditLog().query({
      tenantId,
      eventTypes: ["policy_updated_via_wizard"],
      limit: 200,
      offset: 0,
    });
    const updateAuditCountAfter = updateAudit.entries.filter((entry) => {
      const eventData = entry.eventData as Record<string, unknown>;
      return eventData.policy_id === policyId;
    }).length;
    expect(updateAuditCountAfter).toBe(updateAuditCountBefore);
  });

  it("auto-approves source pending decision when creating allow exception from approval", async () => {
    const app = buildApp();
    const tenantId = "local";
    const workspaceId = "local";
    const sourceDecision = createDecision({
      tenantId,
      workspaceId,
      executionId: "exec-auto-resolve-1",
      adapterId: "openclaw-local",
      requiredRole: "release_manager",
      requestSnapshot: {
        request: {
          tool: "exec",
          context: { targets: ["/tmp/example"] },
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: "policy-auto-resolve-source-decision",
        scope: { tenant_id: tenantId, workspace_id: workspaceId },
        subject: { type: "tool", name: "exec" },
        conditions: {
          tool: "exec",
          "context.exec.argv0": { in: ["ls"] },
          "context.targets.paths": { all_under: ["{{workspace.root}}"] },
        },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _source_trace_id: sourceDecision.decision_id,
        _source_adapter_id: sourceDecision.adapter_id,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: true,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source_decision).toMatchObject({
      decision_id: sourceDecision.decision_id,
      source_trace_id: sourceDecision.decision_id,
      resolved: true,
      status_before: "pending",
      status_after: "approved",
      reason: "policy_exception_created",
    });

    const updatedDecision = getDecision(sourceDecision.decision_id);
    expect(updatedDecision?.status).toBe("approved");
    expect(updatedDecision?.resolution).toMatchObject({
      justification: "policy_exception_created",
    });

    const audit = getAuditLog().query({
      tenantId,
      eventTypes: ["policy_decision_resolved"],
      limit: 20,
      offset: 0,
    });
    const matchingAudit = audit.entries.find(
      (entry) => (entry.eventData as Record<string, unknown>)?.decision_id === sourceDecision.decision_id
    );
    expect(matchingAudit).toBeDefined();
  });

  it("returns source decision metadata without re-resolving already-resolved source decision", async () => {
    const app = buildApp();
    const tenantId = "local";
    const workspaceId = "local";
    const sourceDecision = createDecision({
      tenantId,
      workspaceId,
      executionId: "exec-auto-resolve-2",
      adapterId: "openclaw-local",
      requiredRole: "release_manager",
      requestSnapshot: {
        request: {
          tool: "exec",
          context: { targets: ["/tmp/example-2"] },
        },
      },
    });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: "policy-auto-resolve-idempotent",
        scope: { tenant_id: tenantId, workspace_id: workspaceId },
        subject: { type: "tool", name: "exec" },
        conditions: { tool: "exec" },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _source_trace_id: sourceDecision.decision_id,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: true,
        },
      },
    });
    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: "policy-auto-resolve-idempotent",
        scope: { tenant_id: tenantId, workspace_id: workspaceId },
        subject: { type: "tool", name: "exec" },
        conditions: { tool: "exec" },
        effect: { decision: "allow" },
        precedence: 40,
        enabled: true,
        _source_trace_id: sourceDecision.decision_id,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: true,
        },
      },
    });

    expect(secondResponse.statusCode).toBe(200);
    const body = secondResponse.json();
    expect(body.source_decision).toMatchObject({
      decision_id: sourceDecision.decision_id,
      resolved: false,
      status_before: "approved",
      status_after: "approved",
    });
  });

  it("reconcile endpoint auto-resolves matching pending approvals", async () => {
    const app = buildApp();
    const tenantId = "local";
    const workspaceId = "local";
    const pendingDecision = createDecision({
      tenantId,
      workspaceId,
      executionId: "exec-reconcile-1",
      adapterId: "openclaw-local",
      requiredRole: "release_manager",
      requestSnapshot: {
        request: {
          tool: "exec",
          tool_group: "runtime",
          requested_capabilities: ["shell_command"],
          context: {
            targets: ["/Users/jasongelinas/.openclaw/workspace"],
            exec: { argv0: "ls", cwd: "/Users/jasongelinas/.openclaw/workspace" },
          },
          templateVars: {
            "workspace.root": "/Users/jasongelinas/.openclaw/workspace",
          },
        },
      },
    });

    const createPolicyResponse = await app.inject({
      method: "POST",
      url: "/ops/api/policies",
      payload: {
        policy_id: "policy-reconcile-endpoint-test",
        scope: { tenant_id: tenantId, workspace_id: workspaceId },
        subject: { type: "tool", name: "exec" },
        conditions: {
          tool: "exec",
          tool_group: "runtime",
          "context.exec.argv0": { in: ["ls"] },
          "context.targets.paths": { all_under: ["{{workspace.root}}"] },
        },
        effect: { decision: "allow" },
        precedence: 30,
        enabled: true,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: "allow",
          scope_choice: "workspace",
          command_match_choice: "single",
          warnings_shown: [],
          wizard_acknowledged_allow: true,
        },
      },
    });
    expect(createPolicyResponse.statusCode).toBe(200);

    // Move the decision back to pending to simulate stale queue item and validate refresh scan.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    resolveDecision({ decisionId: pendingDecision.decision_id, status: "pending", resolution: {} });

    const reconcileResponse = await app.inject({
      method: "POST",
      url: "/ops/api/decisions/reconcile",
      payload: {
        tenant_id: tenantId,
        workspace_id: workspaceId,
      },
    });
    expect(reconcileResponse.statusCode).toBe(200);
    const reconcileBody = reconcileResponse.json();
    expect(reconcileBody.resolved_count).toBeGreaterThanOrEqual(1);
    expect(reconcileBody.resolved_decision_ids).toContain(pendingDecision.decision_id);

    const updatedDecision = getDecision(pendingDecision.decision_id);
    expect(updatedDecision?.status).toBe("approved");
  });
});
