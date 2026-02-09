import "dotenv/config";
import { v7 as uuidv7 } from "uuid";
import { buildAdapterToken } from "../src/lib/adapters/auth.js";
import type { AdapterRiskClass } from "../src/lib/adapters/types.js";
import type { SkillManifest } from "../src/lib/skills/skillManifest.js";
import type { AgentTrace, TraceStep } from "../src/lib/tracing/trace.js";
import { sha256Json, formatSha256 } from "../src/lib/security/sha256.js";
import { initDatabase, getDatabase } from "../src/lib/core/db.js";

type Json = Record<string, unknown>;

const baseUrl = process.env.CLASPER_BASE_URL || `http://localhost:${process.env.CLASPER_PORT || 8081}`;

const tenantId = process.env.CLASPER_LOCAL_TENANT_ID || "local";
const workspaceId = process.env.CLASPER_LOCAL_WORKSPACE_ID || "local";

const opsApiKey = process.env.OPS_LOCAL_API_KEY || "";
const daemonKey = process.env.AGENT_DAEMON_API_KEY || "";

const argv = new Set(process.argv.slice(2));
const shouldReset =
  argv.has("--reset") ||
  process.env.SEED_RESET === "1" ||
  process.env.SEED_RESET === "true";

function makeUrl(path: string) {
  return `${baseUrl}${path}`;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function requestJson(path: string, init?: RequestInit) {
  const resp = await fetch(makeUrl(path), init);
  const text = await resp.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { resp, payload, text };
}

function opsHeaders(): Record<string, string> {
  return {
    ...(opsApiKey ? { "X-Ops-Api-Key": opsApiKey } : {}),
    "Content-Type": "application/json",
  };
}

function daemonHeaders(): Record<string, string> {
  return daemonKey ? { "X-Agent-Daemon-Key": daemonKey } : {};
}

function adapterHeaders(token: string): Record<string, string> {
  return {
    "X-Adapter-Token": token,
    "Content-Type": "application/json",
  };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function resetLocalDb() {
  // IMPORTANT: This clears the local SQLite DB file used by this process (controlled by CLASPER_DB_PATH).
  // If your server is running, it must be pointing at the same CLASPER_DB_PATH for this to have effect.
  initDatabase();
  const db = getDatabase();

  const statements = [
    "DELETE FROM trace_annotations",
    "DELETE FROM traces",
    "DELETE FROM audit_log",
    "DELETE FROM audit_chain",
    "DELETE FROM decisions",
    "DELETE FROM tool_authorizations",
    "DELETE FROM adapter_registry",
    "DELETE FROM skill_registry",
    "DELETE FROM policies",
    "DELETE FROM ingest_dedup",
    "DELETE FROM eval_results",
    "DELETE FROM workspace_versions",
    "DELETE FROM workspace_pins",
    "DELETE FROM workspace_environments",
    "DELETE FROM tenant_budgets",
    "DELETE FROM tenant_retention_policies",
  ];

  const tx = db.transaction(() => {
    for (const sql of statements) db.prepare(sql).run();
  });

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      tx();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("database is locked") || msg.toLowerCase().includes("busy")) {
        await sleep(75 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to reset DB (database is locked). Stop the server and retry.");
}

function isoDaysAgo(daysAgo: number, hour = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function isoRelative(params: { daysAgo?: number; minutesAgo?: number }): string {
  const daysAgo = params.daysAgo ?? 0;
  const minutesAgo = params.minutesAgo ?? 0;
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000 - minutesAgo * 60 * 1000;
  return new Date(ms).toISOString();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function requestedCapabilitiesFromTools(tools: Array<{ name: string }>): string[] {
  const caps = new Set<string>();
  for (const t of tools) {
    const name = t.name;
    if (name === "http_request") caps.add("external_network");
    else if (name === "run_command") caps.add("run_command");
    else if (name === "write_file") caps.add("write_files");
    else if (name === "read_file") caps.add("read");
    else if (name === "modify_database") caps.add("modify_database");
    else if (name === "send_email") caps.add("send_email");
    else if (name === "delete_file") caps.add("delete_file");
    else caps.add("unknown");
  }
  return [...caps];
}

async function applyToolAuthorizations(params: {
  token: string;
  adapter: { adapter_id: string; risk_class: AdapterRiskClass };
  executionId: string;
  environment: string;
  skillState: string;
  tools: Scenario["tools"];
}) {
  for (const tool of params.tools) {
    const resp = await authorizeTool(params.token, {
      adapter_id: params.adapter.adapter_id,
      execution_id: params.executionId,
      tool: tool.name,
      requested_scope: tool.args || {},
      environment: params.environment,
      skill_state: params.skillState,
      adapter_risk_class: params.adapter.risk_class,
    });

    if (resp?.decision === "deny") {
      tool.permitted = false;
      tool.reason = resp.policy_id ? `${resp.reason || "policy_denied"}:${resp.policy_id}` : (resp.reason || "policy_denied");
      tool.error = tool.error || "Permission denied by policy";
    } else if (resp?.decision === "allow") {
      tool.permitted = true;
      tool.reason = undefined;
    }
  }
}

type Scenario = {
  name: string;
  inputMessage: string;
  outputMessage: string;
  tools: Array<{ name: string; permitted: boolean; reason?: string; args: Json; result?: Json; error?: string }>;
  annotations: Array<{ key: string; value: string }>;
};

function buildScenario(params: {
  environment: string;
  includeDeniedTool: boolean;
  includeError: boolean;
}): Scenario {
  const env = params.environment;
  const repo = pick(["zenvy-backend", "zenvy-frontend", "clasper-core", "vaultline"]);
  const incident = `INC-${String(1000 + Math.floor(Math.random() * 9000))}`;
  const deployVersion = `v${1 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 9)}.${Math.floor(Math.random() * 9)}`;
  const target = pick(["api", "worker", "ops-ui", "adapter"]);

  const canned: Array<Omit<Scenario, "tools"> & { tools: Scenario["tools"] }> = [
    {
      name: "incident_triage",
      inputMessage: `Triage ${incident}: users report intermittent 500s in ${env}. Identify the failing component and propose a fix.`,
      outputMessage: `Checked recent logs and error rates; identified ${target} as the hotspot. Proposed a config rollback and added a guardrail to prevent recurrence.`,
      annotations: [
        { key: "scenario", value: "incident_triage" },
        { key: "ticket", value: incident },
        { key: "repo", value: repo },
      ],
      tools: [
        {
          name: "read_file",
          permitted: true,
          args: { path: `${repo}/README.md` },
          result: { bytes: 1842, excerpt: "Clasper Core — Local Governance Engine for AI Execution" },
        },
        {
          name: "run_command",
          permitted: true,
          args: { cwd: repo, command: `rg \"500\" -n logs/${env}.log | tail -n 20` },
          result: { exit_code: 0, stdout: "[error] request_id=... status=500 component=api\n...", stderr: "" },
        },
        {
          name: "write_file",
          permitted: true,
          args: { path: `${repo}/notes/${incident}.md`, content_preview: "## Summary\n- Root cause...\n- Fix...\n" },
          result: { ok: true, bytes_written: 312 },
        },
      ],
    },
    {
      name: "config_change",
      inputMessage: `Prepare a safe config change for ${target} in ${env}. Update the config, validate, and summarize impact.`,
      outputMessage: `Updated config with conservative defaults, validated locally, and documented expected impact and rollback steps.`,
      annotations: [
        { key: "scenario", value: "config_change" },
        { key: "service", value: target },
        { key: "env", value: env },
      ],
      tools: [
        {
          name: "read_file",
          permitted: true,
          args: { path: `${repo}/config/${env}.yaml` },
          result: { bytes: 642, excerpt: "rate_limit: 50\nretry: 3\n" },
        },
        {
          name: "write_file",
          permitted: true,
          args: { path: `${repo}/config/${env}.yaml`, patch_preview: "+ rate_limit: 40\n+ timeout_ms: 4500\n" },
          result: { ok: true },
        },
        {
          name: "run_command",
          permitted: true,
          args: { cwd: repo, command: "npm test --silent" },
          result: { exit_code: 0, stdout: "PASS\n", stderr: "" },
        },
      ],
    },
    {
      name: "deploy",
      inputMessage: `Deploy ${target} ${deployVersion} to ${env}. Verify rollout health and capture evidence.`,
      outputMessage: `Rolled out ${deployVersion} to ${env}, verified health checks, and captured rollout evidence for audit.`,
      annotations: [
        { key: "scenario", value: "deploy" },
        { key: "version", value: deployVersion },
        { key: "service", value: target },
        { key: "env", value: env },
      ],
      tools: [
        {
          name: "http_request",
          permitted: true,
          args: { method: "GET", url: `https://${target}.${env}.example.com/health` },
          result: { status: 200, body: { status: "ok", version: deployVersion } },
        },
        {
          name: "run_command",
          permitted: true,
          args: { cwd: repo, command: `echo \"deploy ${deployVersion} to ${env}\"` },
          result: { exit_code: 0, stdout: "deploy recorded\n", stderr: "" },
        },
      ],
    },
  ];

  const chosen = pick(canned);

  // Optionally add a denied delete attempt to show permission denials.
  const tools = [...chosen.tools];
  if (params.includeDeniedTool) {
    tools.push({
      name: "delete_file",
      permitted: false,
      reason: "seed_policy_deny_delete_file",
      args: { path: `${repo}/secrets/${env}.txt` },
      error: "Permission denied by policy",
    });
  }

  if (params.includeError) {
    tools.push({
      name: "run_command",
      permitted: true,
      args: { cwd: repo, command: "node scripts/fail.js" },
      error: "Command failed: exit 1",
    });
  }

  return { ...chosen, tools };
}

function computeStepHash(step: TraceStep): string {
  const payload = {
    step_id: step.step_id || null,
    prev_step_hash: step.prev_step_hash ?? null,
    type: step.type,
    timestamp: step.timestamp,
    durationMs: step.durationMs,
    data: step.data as unknown,
  };
  return formatSha256(sha256Json(payload as any));
}

function addIntegrityHashes(steps: TraceStep[], opts?: { corruptIndex?: number }) {
  let prev: string | null = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    step.step_id = step.step_id || uuidv7();
    step.prev_step_hash = i === 0 ? null : prev;
    step.step_hash = computeStepHash(step);
    prev = step.step_hash;
  }

  if (opts?.corruptIndex !== undefined && steps[opts.corruptIndex]) {
    // Corrupt one hash to produce a compromised trace (trust status: compromised).
    steps[opts.corruptIndex]!.step_hash = `bad${steps[opts.corruptIndex]!.step_hash}`;
  }
}

async function annotateTrace(traceId: string, key: string, value: string) {
  const { resp, text } = await requestJson(`/traces/${encodeURIComponent(traceId)}/annotate`, {
    method: "POST",
    headers: { ...daemonHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, created_by: "seed:ops" }),
  });
  ensure(resp.status === 201, `trace annotate failed (${resp.status}): ${text}`);
}

async function publishSkill(manifest: SkillManifest) {
  const { resp, payload, text } = await requestJson("/skills/publish", {
    method: "POST",
    headers: { ...daemonHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });
  if (resp.status === 201) {
    return { skill: payload?.skill as { name: string; version: string }, created: true };
  }
  // Idempotency: versions are immutable, so re-seeding should not fail just because the skill already exists.
  if (resp.status === 400 && typeof text === "string" && text.includes("already exists")) {
    return { skill: { name: manifest.name, version: manifest.version }, created: false };
  }
  throw new Error(`skills/publish failed (${resp.status}): ${text}`);
}

async function promoteSkill(name: string, version: string, target_state: "draft" | "tested" | "approved" | "active" | "deprecated") {
  const { resp, text } = await requestJson(`/ops/api/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}/promote`, {
    method: "POST",
    headers: opsHeaders(),
    body: JSON.stringify({ target_state }),
  });
  ensure(resp.status === 200, `skill promote failed (${resp.status}): ${text}`);
}

async function promoteSkillTo(name: string, version: string, target: "draft" | "tested" | "approved" | "active" | "deprecated") {
  // Enforce valid transitions: draft -> tested -> approved -> active, draft -> deprecated, tested -> draft, etc.
  // For seeding, we only use monotonic promotions or draft->deprecated.
  const chain: Array<"tested" | "approved" | "active" | "deprecated"> =
    target === "draft" ? [] :
    target === "tested" ? ["tested"] :
    target === "approved" ? ["tested", "approved"] :
    target === "active" ? ["tested", "approved", "active"] :
    ["deprecated"];

  for (const state of chain) {
    await promoteSkill(name, version, state);
  }
}

async function upsertPolicy(policy: Json) {
  const { resp, payload, text } = await requestJson("/ops/api/policies", {
    method: "POST",
    headers: opsHeaders(),
    body: JSON.stringify(policy),
  });
  ensure(resp.status === 200, `ops/api/policies upsert failed (${resp.status}): ${text}`);
  return payload?.policy;
}

async function registerAdapter(params: {
  adapter_id: string;
  display_name: string;
  risk_class: AdapterRiskClass;
  capabilities: string[];
  version: string;
  enabled: boolean;
}) {
  const token = await buildAdapterToken({
    adapter_id: params.adapter_id,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    allowed_capabilities: params.capabilities,
  });

  const { resp, payload, text } = await requestJson("/adapters/register", {
    method: "POST",
    headers: adapterHeaders(token),
    body: JSON.stringify(params),
  });
  ensure(resp.status === 200, `adapters/register failed (${resp.status}): ${text}`);
  return { token, record: payload };
}

async function requestExecutionDecision(token: string, body: Json) {
  const { resp, payload, text } = await requestJson("/api/execution/request", {
    method: "POST",
    headers: adapterHeaders(token),
    body: JSON.stringify(body),
  });
  ensure(resp.status === 200, `api/execution/request failed (${resp.status}): ${text}`);
  return payload;
}

async function authorizeTool(token: string, body: Json) {
  const { resp, payload, text } = await requestJson("/api/governance/tool/authorize", {
    method: "POST",
    headers: adapterHeaders(token),
    body: JSON.stringify(body),
  });
  ensure(resp.status === 200, `api/governance/tool/authorize failed (${resp.status}): ${text}`);
  return payload;
}

async function ingestTrace(token: string, payload: Json) {
  const { resp, payload: out, text } = await requestJson("/api/ingest/trace", {
    method: "POST",
    headers: adapterHeaders(token),
    body: JSON.stringify(payload),
  });
  ensure(resp.status === 200, `api/ingest/trace failed (${resp.status}): ${text}`);
  return out;
}

async function ingestAudit(token: string, payload: Json) {
  const { resp, payload: out, text } = await requestJson("/api/ingest/audit", {
    method: "POST",
    headers: adapterHeaders(token),
    body: JSON.stringify(payload),
  });
  ensure(resp.status === 200, `api/ingest/audit failed (${resp.status}): ${text}`);
  return out;
}

function buildSteps(params: {
  tools: Array<{ name: string; permitted: boolean; reason?: string; args?: Json; result?: Json; error?: string }>;
  includeError?: boolean;
  integrityMode?: "verified" | "compromised" | "unsigned";
}): { steps: TraceStep[]; outputToolCalls: NonNullable<AgentTrace["output"]>["toolCalls"] } {
  const steps: TraceStep[] = [];
  const outputToolCalls: NonNullable<AgentTrace["output"]>["toolCalls"] = [];

  // One initial LLM call
  const hasToolCalls = params.tools.length > 0;
  steps.push({
    type: "llm_call",
    timestamp: new Date().toISOString(),
    durationMs: 1200,
    data: {
      model: "gpt-4o-mini",
      provider: "openai",
      inputTokens: 420,
      outputTokens: 240,
      cost: 0.0021,
      hasToolCalls,
      finishReason: hasToolCalls ? "tool_calls" : "stop",
    },
  });

  for (const t of params.tools) {
    const toolCallId = uuidv7();
    steps.push({
      type: "tool_call",
      timestamp: new Date().toISOString(),
      durationMs: 10,
      data: {
        toolCallId,
        toolName: t.name,
        arguments: { ...(t.args || {}), requested_at: new Date().toISOString() },
        permitted: t.permitted,
        permissionReason: t.permitted ? undefined : (t.reason || "policy_denied"),
      },
    });

    steps.push({
      type: "tool_result",
      timestamp: new Date().toISOString(),
      durationMs: 350,
      data: {
        toolCallId,
        toolName: t.name,
        success: t.permitted && !t.error,
        result: t.permitted && !t.error ? (t.result || { ok: true, tool: t.name }) : undefined,
        error: t.error || (t.permitted ? undefined : "Permission denied"),
      },
    });

    outputToolCalls.push({
      id: toolCallId,
      name: t.name,
      durationMs: 360,
      permitted: t.permitted,
      success: t.permitted && !t.error,
      arguments: t.args || {},
      result: t.permitted && !t.error ? (t.result || { ok: true }) : { ok: false, error: t.error || "Permission denied" },
    });
  }

  if (params.includeError) {
    steps.push({
      type: "error",
      timestamp: new Date().toISOString(),
      durationMs: 0,
      data: {
        code: "demo_error",
        message: "Synthetic error for Ops UI testing",
        recoverable: false,
      },
    });
  } else {
    // final LLM call
    steps.push({
      type: "llm_call",
      timestamp: new Date().toISOString(),
      durationMs: 900,
      data: {
        model: "gpt-4o-mini",
        provider: "openai",
        inputTokens: 260,
        outputTokens: 180,
        cost: 0.0012,
        hasToolCalls: false,
        finishReason: "stop",
      },
    });
  }

  if (params.integrityMode !== "unsigned") {
    addIntegrityHashes(
      steps,
      params.integrityMode === "compromised"
        ? { corruptIndex: Math.max(0, Math.floor(steps.length / 2) - 1) }
        : undefined
    );
  }

  return { steps, outputToolCalls };
}

function buildTrace(params: {
  traceId: string;
  adapterId: string;
  agentRole: string;
  startedAt: string;
  environment: string;
  skillVersions: Record<string, string>;
  scenario: Scenario;
  error?: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  integrityMode?: "verified" | "compromised" | "unsigned";
  includeViolation?: boolean;
}): AgentTrace {
  const started = new Date(params.startedAt);
  const toolCount = params.scenario.tools.length;
  const requestedCapabilities = requestedCapabilitiesFromTools(params.scenario.tools);
  const durationMs = 1000 + toolCount * 400 + (params.error ? 500 : 900);
  const completedAt = new Date(started.getTime() + durationMs).toISOString();

  const { steps, outputToolCalls } = buildSteps({
    tools: params.scenario.tools,
    includeError: !!params.error,
    integrityMode: params.integrityMode || "verified",
  });

  return {
    id: params.traceId,
    tenantId,
    workspaceId,
    agentRole: params.agentRole,
    startedAt: params.startedAt,
    completedAt,
    durationMs,
    model: "gpt-4o-mini",
    provider: "openai",
    workspaceHash: "seeded",
    skillVersions: params.skillVersions,
    input: {
      message: params.scenario.inputMessage,
      messageHistory: 6,
    },
    steps,
    output: params.error
      ? undefined
      : {
          message: params.scenario.outputMessage,
          toolCalls: outputToolCalls,
        },
    usage: {
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalCost: params.costUsd,
    },
    labels: {
      environment: params.environment,
      seeded: "true",
      scenario: params.scenario.name,
      agent_id: params.scenario.annotations.find(a => a.key === "agent_id")?.value || "unknown",
    },
    adapter_id: params.adapterId,
    granted_scope: {
      capabilities: requestedCapabilities,
      max_steps: 100,
      max_cost: 50,
    },
    used_scope: {
      capabilities: requestedCapabilities,
      step_count: 2 + toolCount * 2,
      actual_cost: params.costUsd,
    },
    violations: params.includeViolation
      ? [
          {
            type: "LOCAL_OVERRIDE",
            message: "Synthetic violation for Ops UI testing",
            timestamp: new Date().toISOString(),
          },
        ]
      : undefined,
    error: params.error ? "Synthetic error for Ops UI testing" : undefined,
  };
}

async function run() {
  console.log(`[seed:ops] Base URL: ${baseUrl}`);
  console.log(`[seed:ops] tenant=${tenantId} workspace=${workspaceId}`);

  if (shouldReset) {
    console.log("[seed:ops] Reset requested: clearing local DB tables...");
    await resetLocalDb();
    console.log("[seed:ops] Reset complete.");
  }

  // Ensure server is up
  {
    const { resp, text } = await requestJson("/health");
    ensure(resp.ok, `Server not healthy at ${makeUrl("/health")} (${resp.status}): ${text}`);
  }

  // Create two adapters
  const adapterA = {
    adapter_id: "dev-adapter-a",
    display_name: "Dev Adapter A",
    risk_class: "medium" as const,
    capabilities: ["read", "write_files", "external_network"],
    version: "0.1.0",
    enabled: true,
  };
  const adapterB = {
    adapter_id: "dev-adapter-b",
    display_name: "Dev Adapter B",
    risk_class: "high" as const,
    capabilities: ["read", "write_files", "run_command", "modify_database", "external_network", "send_email", "delete_file"],
    version: "0.1.0",
    enabled: true,
  };

  console.log("[seed:ops] Registering adapters...");
  const regA = await registerAdapter(adapterA);
  const regB = await registerAdapter(adapterB);

  function isSubset(need: string[], allowed: string[]) {
    const allowedSet = new Set(allowed);
    for (const c of need) {
      if (!allowedSet.has(c)) return false;
    }
    return true;
  }

  function pickAdapterForTools(tools: Scenario["tools"]) {
    const requestedCaps = requestedCapabilitiesFromTools(tools);
    if (isSubset(requestedCaps, adapterA.capabilities)) {
      return { adapter: adapterA, reg: regA, requestedCaps };
    }
    // Fall back to adapterB for higher-risk capabilities (run_command/modify_database/etc).
    if (isSubset(requestedCaps, adapterB.capabilities)) {
      return { adapter: adapterB, reg: regB, requestedCaps };
    }
    // If a scenario includes capabilities neither adapter allows, keep seeding deterministic: use adapterB.
    return { adapter: adapterB, reg: regB, requestedCaps };
  }

  // Publish skills (draft by default)
  console.log("[seed:ops] Publishing skills...");
  const skills: Array<{ name: string; version: string; targetState: "draft" | "tested" | "approved" | "active" | "deprecated" }> = [
    { name: "demo-active-skill", version: "1.0.0", targetState: "active" },
    { name: "demo-approved-skill", version: "1.0.0", targetState: "approved" },
    { name: "demo-draft-skill", version: "1.0.0", targetState: "draft" },
    { name: "demo-deprecated-skill", version: "1.0.0", targetState: "deprecated" },
  ];

  for (const s of skills) {
    const manifest: SkillManifest = {
      name: s.name,
      version: s.version,
      description: `Seeded skill (${s.targetState}) for Ops UI testing`,
      permissions: {
        tools:
          s.targetState === "deprecated"
            ? ["delete_file", "run_command"]
            : s.targetState === "draft"
              ? ["modify_database", "run_command"]
              : ["read_file", "write_file"],
      },
      instructions: `This is a seeded skill used to generate realistic Ops UI data.\n\nState target: ${s.targetState}.`,
      tags: ["seed", "ops-ui"],
    };

    const published = await publishSkill(manifest);
    // Only promote on first publish; if the skill already existed, leave its state as-is.
    if (published.created) {
      await promoteSkillTo(s.name, s.version, s.targetState);
    }
  }

  // Upsert policies
  console.log("[seed:ops] Creating policies...");
  const policies = [
    {
      policy_id: "deny_delete_file",
      scope: { tenant_id: tenantId },
      subject: { type: "tool", name: "delete_file" },
      effect: { decision: "deny" },
      explanation: "Seed policy: deny delete_file tool usage",
      precedence: 100,
      enabled: true,
    },
    {
      policy_id: "approval_external_network",
      scope: { tenant_id: tenantId },
      subject: { type: "adapter" },
      conditions: { capability: "external_network" },
      effect: { decision: "require_approval" },
      explanation: "Seed policy: require approval when external_network capability is requested",
      precedence: 90,
      enabled: true,
    },
  ];
  for (const p of policies) await upsertPolicy(p);

  // Trigger at least one pending decision (Approvals page)
  console.log("[seed:ops] Triggering a pending execution decision...");
  const pendingExec = await requestExecutionDecision(regA.token, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    environment: "prod",
    adapter_id: adapterA.adapter_id,
    adapter_risk_class: adapterA.risk_class,
    requested_capabilities: ["external_network"],
    tool_count: 1,
    tool_names: ["read_file"],
    skill_state: "active",
    estimated_cost: 0.25,
    intent: "demo_seed",
    context: { external_network: true },
    provenance: { source: "internal", publisher: "seed-script" },
  });

  // Create some tool authorization events (Audit page variety)
  console.log("[seed:ops] Generating tool authorization events...");
  const toolExecutionId = uuidv7();
  await authorizeTool(regA.token, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    adapter_id: adapterA.adapter_id,
    execution_id: toolExecutionId,
    tool: "read_file",
    requested_scope: { path: "README.md" },
    environment: "dev",
    skill_state: "active",
    adapter_risk_class: adapterA.risk_class,
  });
  await authorizeTool(regA.token, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    adapter_id: adapterA.adapter_id,
    execution_id: toolExecutionId,
    tool: "delete_file",
    requested_scope: { path: "secrets.txt" },
    environment: "dev",
    skill_state: "active",
    adapter_risk_class: adapterA.risk_class,
  });

  // Optional: add a couple adapter audit entries for filtering
  console.log("[seed:ops] Ingesting a few audit events...");
  for (const evt of ["seed_started", "seed_completed"]) {
    const executionId = uuidv7();
    const traceId = uuidv7();
    await ingestAudit(regA.token, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      adapter_id: adapterA.adapter_id,
      execution_id: executionId,
      trace_id: traceId,
      event_type: evt,
      message: `seed event: ${evt}`,
      event_data: { source: "seed-ops-data.ts" },
      occurred_at: new Date().toISOString(),
    });
  }

  // Ingest traces (Traces + Dashboard + Risk + Cost)
  const traceCount = Number(process.env.SEED_TRACE_COUNT || "25");
  console.log(`[seed:ops] Ingesting ${traceCount} traces...`);

  const envs = ["dev", "staging", "prod"];
  const agentRoles = ["developer", "operator", "release_manager"];
  const agentNames = {
    developer: ["dev-alice", "dev-bob", "ci-runner-1"],
    operator: ["ops-jen", "incident-bot", "oncall-user"],
    release_manager: ["release-bot-v2", "deploy-pipeline"]
  };
  const skillPool = skills.map((s) => ({ name: s.name, version: s.version, state: s.targetState }));

  // Two similar traces for diff
  const diffBaseTraceId = uuidv7();
  const diffCompareTraceId = uuidv7();
  const diffExecIdBase = uuidv7();
  const diffExecIdCompare = uuidv7();

  const diffSkill = pick(skillPool);
  const diffSkillVersions = { [diffSkill.name]: diffSkill.version };

  const baseScenario = buildScenario({ environment: "dev", includeDeniedTool: false, includeError: false });
  const basePick = pickAdapterForTools(baseScenario.tools);
  await requestExecutionDecision(basePick.reg.token, {
    execution_id: diffExecIdBase,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    environment: "dev",
    adapter_id: basePick.adapter.adapter_id,
    adapter_risk_class: basePick.adapter.risk_class,
    requested_capabilities: basePick.requestedCaps,
    tool_count: baseScenario.tools.length,
    tool_names: baseScenario.tools.map((t) => t.name),
    skill_state: diffSkill.state,
    estimated_cost: 0.0042,
    intent: baseScenario.name,
    context: basePick.requestedCaps.includes("external_network") ? { external_network: true } : undefined,
    provenance: { source: "internal", publisher: "seed-script" },
  });
  await applyToolAuthorizations({
    token: basePick.reg.token,
    adapter: basePick.adapter,
    executionId: diffExecIdBase,
    environment: "dev",
    skillState: diffSkill.state,
    tools: baseScenario.tools,
  });

  const baseTrace = buildTrace({
    traceId: diffBaseTraceId,
    adapterId: basePick.adapter.adapter_id,
    agentRole: "developer",
    startedAt: isoRelative({ minutesAgo: 12 }),
    environment: "dev",
    skillVersions: diffSkillVersions,
    scenario: baseScenario,
    costUsd: 0.0042,
    inputTokens: 700,
    outputTokens: 350,
    integrityMode: "verified",
  });

  const compareScenario = buildScenario({ environment: "dev", includeDeniedTool: true, includeError: false });
  const comparePick = pickAdapterForTools(compareScenario.tools);
  await requestExecutionDecision(comparePick.reg.token, {
    execution_id: diffExecIdCompare,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    environment: "dev",
    adapter_id: comparePick.adapter.adapter_id,
    adapter_risk_class: comparePick.adapter.risk_class,
    requested_capabilities: comparePick.requestedCaps,
    tool_count: compareScenario.tools.length,
    tool_names: compareScenario.tools.map((t) => t.name),
    skill_state: diffSkill.state,
    estimated_cost: 0.0069,
    intent: compareScenario.name,
    context: comparePick.requestedCaps.includes("external_network") ? { external_network: true } : undefined,
    provenance: { source: "internal", publisher: "seed-script" },
  });
  await applyToolAuthorizations({
    token: comparePick.reg.token,
    adapter: comparePick.adapter,
    executionId: diffExecIdCompare,
    environment: "dev",
    skillState: diffSkill.state,
    tools: compareScenario.tools,
  });

  const compareTrace = buildTrace({
    traceId: diffCompareTraceId,
    adapterId: comparePick.adapter.adapter_id,
    agentRole: "developer",
    startedAt: isoRelative({ minutesAgo: 8 }),
    environment: "dev",
    skillVersions: diffSkillVersions,
    scenario: compareScenario,
    costUsd: 0.0069,
    inputTokens: 820,
    outputTokens: 420,
    includeViolation: true,
    integrityMode: "verified",
  });

  await ingestTrace(basePick.reg.token, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    execution_id: diffExecIdBase,
    trace_id: diffBaseTraceId,
    adapter_id: basePick.adapter.adapter_id,
    trace: baseTrace as unknown as Json,
  });
  await ingestTrace(comparePick.reg.token, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    execution_id: diffExecIdCompare,
    trace_id: diffCompareTraceId,
    adapter_id: comparePick.adapter.adapter_id,
    trace: compareTrace as unknown as Json,
  });

  // Add a few annotations so summaries are human-friendly
  if (daemonKey) {
    const baseScenario = (baseTrace.labels || {}).scenario;
    const compareScenario = (compareTrace.labels || {}).scenario;
    await annotateTrace(diffBaseTraceId, "summary", `Diff base: ${baseScenario || "seed"} trace`);
    await annotateTrace(diffCompareTraceId, "summary", `Diff compare: ${compareScenario || "seed"} trace`);
  }

  // Spread the rest across the last 7 days so cost dashboard bars show up
  for (let i = 0; i < traceCount - 2; i++) {
    const daysAgo = i % 7;
    const environment = envs[i % envs.length];
    const agentRole = pick(agentRoles);
    const agentId = pick(agentNames[agentRole as keyof typeof agentNames]);

    // Pick 1-2 skills per trace; sometimes include deprecated/draft to push risk
    const primarySkill = pick(skillPool);
    const includeRisky = Math.random() < 0.35;
    const riskySkill = skillPool.find((s) => s.state === "deprecated") || primarySkill;
    const otherSkill = includeRisky ? riskySkill : (Math.random() < 0.25 ? pick(skillPool) : null);

    const skillVersions: Record<string, string> = {
      [primarySkill.name]: primarySkill.version,
      ...(otherSkill ? { [otherSkill.name]: otherSkill.version } : {}),
    };

    const isError = Math.random() < 0.12;
    const scenario = buildScenario({
      environment,
      includeDeniedTool: Math.random() < 0.35,
      includeError: isError,
    });
    const toolCount = scenario.tools.length;
    const costUsd = Number((0.001 + Math.random() * 0.02 + toolCount * 0.002).toFixed(4));
    const inputTokens = 300 + toolCount * 120 + Math.floor(Math.random() * 200);
    const outputTokens = 180 + toolCount * 80 + Math.floor(Math.random() * 140);

    const roll = Math.random();
    const integrityMode: "verified" | "compromised" | "unsigned" =
      roll < 0.1 ? "unsigned" : roll < 0.15 ? "compromised" : "verified";

    const traceId = uuidv7();
    const executionId = uuidv7();

    const picked = pickAdapterForTools(scenario.tools);
    await requestExecutionDecision(picked.reg.token, {
      execution_id: executionId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      environment,
      adapter_id: picked.adapter.adapter_id,
      adapter_risk_class: picked.adapter.risk_class,
      requested_capabilities: picked.requestedCaps,
      tool_count: scenario.tools.length,
      tool_names: scenario.tools.map((t) => t.name),
      skill_state: primarySkill.state,
      estimated_cost: costUsd,
      intent: scenario.name,
      context: picked.requestedCaps.includes("external_network") ? { external_network: true } : undefined,
      provenance: { source: "internal", publisher: "seed-script" },
    });
    await applyToolAuthorizations({
      token: picked.reg.token,
      adapter: picked.adapter,
      executionId,
      environment,
      skillState: primarySkill.state,
      tools: scenario.tools,
    });

    const trace = buildTrace({
      traceId,
      adapterId: picked.adapter.adapter_id,
      agentRole,
      // Keep traces distributed across the last 7 days for dashboards, but make them “recent” within each day.
      startedAt: isoRelative({ daysAgo, minutesAgo: i }),
      environment,
      skillVersions,
      error: isError,
      costUsd,
      inputTokens,
      outputTokens,
      includeViolation: Math.random() < 0.1,
      integrityMode,
      scenario: { ...scenario, annotations: [...scenario.annotations, { key: "agent_id", value: agentId }] },
    });

    await ingestTrace(picked.reg.token, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      execution_id: executionId,
      trace_id: traceId,
      adapter_id: picked.adapter.adapter_id,
      trace: trace as unknown as Json,
    });

    // Add scenario annotations (ticket, repo, etc.) so the dashboard shows them when daemon key is set
    if (daemonKey) {
      for (const a of scenario.annotations) {
        await annotateTrace(traceId, a.key, a.value);
      }
    }

    // Light throttle so timestamps don’t all collide in audit views
    if (i % 10 === 0) await sleep(50);
  }

  console.log("");
  console.log("[seed:ops] Done.");
  console.log(`[seed:ops] Pending decision_id: ${pendingExec?.decision_id || "(none)"}`);
  console.log(`[seed:ops] Diff traces: ${diffBaseTraceId} vs ${diffCompareTraceId}`);
  console.log(`[seed:ops] Open Ops UI: ${baseUrl}/ops`);
}

run().catch((err) => {
  console.error("[seed:ops] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

