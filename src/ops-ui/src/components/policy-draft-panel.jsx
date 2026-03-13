import { useState, useEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import { policyDraftPanel, policyExceptionResolution, tenantId, showToast } from "../state.js";
import { apiPost } from "../api.js";
import { XIcon, ShieldIcon, ActivityIcon, SearchIcon, CheckIcon } from "./icons.jsx";

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildSeedFromTrace(trace, toolInput) {
  const tool = toolInput || "unknown";
  const req = trace?.request_snapshot?.request || {};
  const context = req.context || trace?.context || {};
  const argv0 = getArgv0FromContext(context);
  const targetPaths = Array.isArray(context?.targets?.paths)
    ? context.targets.paths.filter((p) => typeof p === "string")
    : Array.isArray(context?.targets)
      ? context.targets.filter((p) => typeof p === "string")
      : [];
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const slug = slugify(tool) || "tool";
  const suffix = Math.random().toString(36).slice(2, 6);
  const policyId = `policy-${slug}-${suffix}`;
  const explanation = `Added from blocked execution on ${dateStr}`;
  const conditions = {
    tool,
    tool_group: trace.tool_group ?? undefined,
  };
  if (typeof req.agent_id === "string" && req.agent_id.trim()) conditions.agent_id = req.agent_id.trim();
  if (typeof req.agent_role === "string" && req.agent_role.trim()) conditions.agent_role = req.agent_role.trim();
  return {
    policy_id: policyId,
    scope: {
      tenant_id: trace.tenant_id || tenantId.value || "local",
      workspace_id: trace.workspace_id || undefined,
    },
    subject: { type: "tool", name: tool },
    conditions,
    context: {
      argv0,
      targetPaths,
    },
    effect: { decision: undefined },
    explanation,
    precedence: undefined,
    enabled: true,
  };
}

function normalizeArgv0Condition(value) {
  if (typeof value === "string") return { operator: "eq", values: [value] };
  if (value && typeof value === "object") {
    if (typeof value.eq === "string") return { operator: "eq", values: [value.eq] };
    if (Array.isArray(value.in)) {
      return {
        operator: "in",
        values: value.in.filter((v) => typeof v === "string"),
      };
    }
    if (typeof value.prefix === "string") return { operator: "prefix", values: [value.prefix] };
    if (value.exists === true) return { operator: "exists", values: [] };
  }
  return { operator: "in", values: [] };
}

function normalizePathCondition(value) {
  if (value && typeof value === "object") {
    if (value.exists === true) return { operator: "exists", values: [] };
    if (Array.isArray(value.all_under)) {
      return {
        operator: "all_under",
        values: value.all_under.filter((v) => typeof v === "string"),
      };
    }
    if (Array.isArray(value.any_under)) {
      return {
        operator: "any_under",
        values: value.any_under.filter((v) => typeof v === "string"),
      };
    }
  }
  return { operator: "all_under", values: [] };
}

/** Normalize any string condition (eq, in, prefix, exists) for tool_group, actor, action, resource, agent_id, agent_role, etc. */
function normalizeStringCondition(value) {
  if (typeof value === "string") return { operator: "eq", values: [value] };
  if (value && typeof value === "object") {
    if (typeof value.eq === "string") return { operator: "eq", values: [value.eq] };
    if (Array.isArray(value.in)) {
      return { operator: "in", values: value.in.filter((v) => typeof v === "string") };
    }
    if (typeof value.prefix === "string") return { operator: "prefix", values: [value.prefix] };
    if (value.exists === true) return { operator: "exists", values: [] };
  }
  return { operator: "eq", values: [] };
}

/** Build condition value for policy payload from operator + values */
function buildStringCondition(operator, values) {
  if (operator === "exists") return { exists: true };
  if (operator === "prefix" && values[0]) return { prefix: values[0] };
  if (operator === "in" && values.length > 0) return { in: values };
  if (operator === "eq" && values[0]) return values[0];
  return undefined;
}

function buildSeedFromPolicy(policy) {
  const conditions = policy?.conditions && typeof policy.conditions === "object" ? policy.conditions : {};
  const argv0 = normalizeArgv0Condition(conditions["context.exec.argv0"]);
  const paths = normalizePathCondition(conditions["context.targets.paths"]);
  const agentId = normalizeStringCondition(conditions.agent_id);
  const agentRole = normalizeStringCondition(conditions.agent_role);
  const toolGroup = normalizeStringCondition(conditions.tool_group);
  const actor = normalizeStringCondition(conditions.actor);
  const action = normalizeStringCondition(conditions.action);
  const resource = normalizeStringCondition(conditions.resource);
  const execCwd = normalizeStringCondition(
    conditions["context.exec.cwd"] ?? conditions.context?.exec?.cwd
  );
  const packageManager = normalizeStringCondition(
    conditions["context.package_manager"] ?? conditions.context?.package_manager
  );
  const capability = normalizeStringCondition(conditions.capability);
  const intent = normalizeStringCondition(conditions.intent);
  const selectedOutcome =
    policy?.effect?.decision === "allow" || policy?.effect?.decision === "deny" || policy?.effect?.decision === "require_approval"
      ? policy.effect.decision
      : "require_approval";
  return {
    policy_id: policy?.policy_id || "",
    scope: {
      tenant_id: policy?.scope?.tenant_id || tenantId.value || "local",
      workspace_id: policy?.scope?.workspace_id || undefined,
    },
    subject: policy?.subject || { type: "tool", name: "unknown" },
    conditions,
    context: {
      argv0: argv0.values[0] || "",
      targetPaths: paths.values,
    },
    effect: { decision: selectedOutcome },
    explanation: typeof policy?.explanation === "string" ? policy.explanation : "",
    precedence: typeof policy?.precedence === "number" ? policy.precedence : 20,
    enabled: policy?.enabled !== false,
    wizardMeta: policy?._wizard_meta && typeof policy._wizard_meta === "object" ? policy._wizard_meta : null,
    derived: {
      argv0Operator: argv0.operator,
      argv0Values: argv0.values,
      pathOperator: paths.operator,
      pathScopes: paths.values,
      agentIdOperator: agentId.operator,
      agentIdValues: agentId.values,
      agentRoleOperator: agentRole.operator,
      agentRoleValues: agentRole.values,
      toolGroupOperator: toolGroup.operator,
      toolGroupValues: toolGroup.values,
      actorOperator: actor.operator,
      actorValues: actor.values,
      actionOperator: action.operator,
      actionValues: action.values,
      resourceOperator: resource.operator,
      resourceValues: resource.values,
      execCwdOperator: execCwd.operator,
      execCwdValues: execCwd.values,
      packageManagerOperator: packageManager.operator,
      packageManagerValues: packageManager.values,
      capabilityOperator: capability.operator,
      capabilityValues: capability.values,
      intentOperator: intent.operator,
      intentValues: intent.values,
      quickDecision: selectedOutcome,
      scopeChoice:
        paths.operator === "exists" ? "custom" : paths.values.length === 1 && paths.values[0] === "{{workspace.root}}" ? "workspace" : "custom",
      commandChoice:
        argv0.operator === "exists" ? "none" : argv0.operator === "eq" && argv0.values.length === 1 ? "this_command" : argv0.values.length > 0 ? "custom_list" : "none",
    },
  };
}

function getCurrentRequest(trace) {
  const req = trace?.request_snapshot?.request || {};
  const context = req.context || trace?.context || {};
  const tool = req.tool || toolFallback(trace);
  return {
    tool,
    tool_group: req.tool_group || trace?.tool_group || undefined,
    workspace_id: req.workspace_id || trace?.workspace_id || undefined,
    context,
    templateVars: req.templateVars || {},
  };
}

function toolFallback(trace) {
  const names = trace?.tool_names || [];
  return names[names.length - 1] || "unknown";
}

function extractFirstToken(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const token = trimmed.split(/\s+/)[0] || "";
  if (!token) return "";
  const parts = token.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : token;
}

function inferArgv0FromTargets(context) {
  const candidates = [];
  if (Array.isArray(context?.targets?.paths)) candidates.push(...context.targets.paths);
  if (Array.isArray(context?.targets)) candidates.push(...context.targets);

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const token = extractFirstToken(candidate);
    if (!token) continue;
    if (token.startsWith("-")) continue;
    // Avoid treating plain paths as command names.
    if (!candidate.includes(" ") && (token.includes("/") || token.includes("\\"))) continue;
    return token;
  }
  return "";
}

function getCommandCandidatesFromContext(context) {
  const seen = new Set();
  const out = [];
  const pushCandidate = (value) => {
    const token = extractFirstToken(value);
    if (!token) return;
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  pushCandidate(context?.exec?.argv0);
  pushCandidate(context?.exec?.command);
  pushCandidate(context?.command);
  if (Array.isArray(context?.targets?.paths)) context.targets.paths.forEach(pushCandidate);
  if (Array.isArray(context?.targets)) context.targets.forEach(pushCandidate);
  return out;
}

function getArgv0FromContext(context) {
  const fromExecArgv0 = extractFirstToken(context?.exec?.argv0);
  if (fromExecArgv0) return fromExecArgv0;
  const fromExecCommand = extractFirstToken(context?.exec?.command);
  if (fromExecCommand) return fromExecCommand;
  const fromCommand = extractFirstToken(context?.command);
  if (fromCommand) return fromCommand;
  return inferArgv0FromTargets(context);
}

function normalizePathLike(value) {
  if (typeof value !== "string") return "";
  let out = value.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  while (out.includes("//")) out = out.replace(/\/\//g, "/");
  if (!out) return "";
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function looksLikePathToken(token) {
  if (typeof token !== "string") return false;
  const t = normalizePathLike(token);
  if (!t) return false;
  return t.startsWith("/") || t.startsWith("./") || t.startsWith("../") || t.startsWith("~");
}

function extractPathsFromString(value) {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/).map((token) => normalizePathLike(token));
  const out = tokens.filter((token) => looksLikePathToken(token));
  return out;
}

function getTargetPathsFromContext(context) {
  const candidates = [];
  if (Array.isArray(context?.targets?.paths)) candidates.push(...context.targets.paths);
  if (Array.isArray(context?.targets)) candidates.push(...context.targets);
  if (typeof context?.exec?.cwd === "string") candidates.push(context.exec.cwd);

  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const extracted = extractPathsFromString(candidate);
    const pathLike = extracted.length > 0 ? extracted : [normalizePathLike(candidate)];
    for (const item of pathLike) {
      if (!looksLikePathToken(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function resolveWorkspaceRoot(currentRequest) {
  const templateRoot = currentRequest?.templateVars?.["workspace.root"];
  if (typeof templateRoot === "string" && templateRoot.trim()) {
    return normalizePathLike(templateRoot);
  }
  const cwd = normalizePathLike(currentRequest?.context?.exec?.cwd || "");
  if (cwd) return cwd;
  const firstPath = getTargetPathsFromContext(currentRequest?.context || {})[0] || "";
  return normalizePathLike(firstPath) || "/workspace";
}

function pathUnderRoot(pathValue, rootValue) {
  if (typeof pathValue !== "string" || typeof rootValue !== "string") return false;
  const normalize = (v) => {
    let out = v.replace(/\\/g, "/");
    while (out.includes("//")) out = out.replace(/\/\//g, "/");
    if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
    return out;
  };
  const p = normalize(pathValue);
  const r = normalize(rootValue);
  return p === r || p.startsWith(`${r}/`);
}

function scoreRuleRisk({
  decision,
  argv0Operator,
  argv0Values,
  pathOperator,
  pathScopes,
  precedenceNum,
  context,
}) {
  if (decision !== "allow") {
    return {
      level: "low",
      score: 0,
      reasons: ["Non-allow effect keeps execution gated."],
    };
  }

  let score = 0;
  const reasons = [];
  const hasPathScope = pathScopes.length > 0;
  const hasArgv0Constraint = argv0Values.length > 0;
  const broadRoot = pathScopes.some((p) => p === "/" || p === "*");
  const argv0 = getArgv0FromContext(context)?.toLowerCase();
  const riskyCommands = new Set(["rm", "curl", "wget", "chmod", "chown", "sudo", "sh", "bash"]);
  const networkPossible = context?.side_effects?.network_possible === true || context?.external_network === true;
  const writesPossible = context?.side_effects?.writes_possible === true || context?.writes_files === true;

  if (!hasArgv0Constraint) {
    score += 4;
    reasons.push("No command constraint.");
  }
  if (!hasPathScope) {
    score += 4;
    reasons.push("No path scope.");
  }
  if (argv0Operator === "in" && argv0Values.length > 5) {
    score += 3;
    reasons.push("Large command allowlist.");
  }
  if (pathOperator === "any_under") {
    score += 2;
    reasons.push("any_under is broader than all_under.");
  }
  if (broadRoot) {
    score += 4;
    reasons.push("Path root is too broad.");
  }
  if (!isNaN(precedenceNum) && precedenceNum >= 100) {
    score += 1;
    reasons.push("Very high priority increases override impact.");
  }
  if ((networkPossible || writesPossible) && (!hasPathScope || !hasArgv0Constraint)) {
    score += 3;
    reasons.push("Potential side effects with broad matching.");
  }
  if (argv0 && riskyCommands.has(argv0)) {
    score += 4;
    reasons.push(`Detected high-risk command (${argv0}).`);
  }

  if (score >= 8) return { level: "high", score, reasons };
  if (score >= 4) return { level: "medium", score, reasons };
  return {
    level: "low",
    score,
    reasons: reasons.length > 0 ? reasons : ["Scoped command and path constraints."],
  };
}

function evaluateCandidateMatch({
  currentRequest,
  decision,
  argv0Operator,
  argv0Values,
  argv0Exists,
  pathOperator,
  pathScopes,
  pathExists,
}) {
  const details = [];
  if (decision !== "allow") {
    return { match: false, details: ["Preview is for allow rules only."] };
  }

  const argv0 = getArgv0FromContext(currentRequest.context);
  if (argv0Exists) {
    const ok = argv0 !== undefined && argv0 !== null && String(argv0).trim() !== "";
    details.push(`Command ${ok ? "exists" : "does not exist"} (${argv0 || "none"}).`);
    if (!ok) return { match: false, details };
  } else if (argv0Values.length > 0) {
    let argvMatch = false;
    if (argv0Operator === "eq") {
      argvMatch = argv0Values[0] === argv0;
    } else if (argv0Operator === "prefix") {
      argvMatch = typeof argv0 === "string" && argv0.startsWith(argv0Values[0]);
    } else {
      argvMatch = argv0Values.includes(argv0);
    }
    details.push(`Command ${argvMatch ? "matches" : "does not match"} (${argv0 || "none"}).`);
    if (!argvMatch) return { match: false, details };
  } else {
    details.push("No command constraint configured.");
  }

  const paths = getTargetPathsFromContext(currentRequest.context);
  if (pathExists) {
    const ok = paths.length > 0;
    details.push(`Paths ${ok ? "exist" : "do not exist"} (${paths.length} target(s)).`);
    if (!ok) return { match: false, details };
  } else if (pathScopes.length > 0 && paths.length > 0) {
    const workspaceRoot = resolveWorkspaceRoot(currentRequest);
    const normalizedScopes = pathScopes.map((scope) =>
      scope.replace(/\{\{\s*workspace\.root\s*\}\}/g, workspaceRoot)
    );
    details.push(`Workspace root resolved to: ${workspaceRoot}`);
    if (pathOperator === "all_under") {
      const ok = paths.every((p) => normalizedScopes.some((s) => pathUnderRoot(p, s)));
      details.push(
        ok
          ? "All target paths are in scope."
          : `One or more target paths are outside scope. Targets: ${paths.join(", ")}`
      );
      if (!ok) return { match: false, details };
    } else {
      const ok = paths.some((p) => normalizedScopes.some((s) => pathUnderRoot(p, s)));
      details.push(
        ok
          ? "At least one target path is in scope."
          : `No target paths are in scope. Targets: ${paths.join(", ")}`
      );
      if (!ok) return { match: false, details };
    }
  } else if (pathScopes.length > 0 && paths.length === 0) {
    details.push("No target paths available to evaluate scope.");
    return { match: false, details };
  } else {
    details.push("No path scope constraint configured.");
  }

  return { match: true, details };
}

function HelpTip({ text }) {
  if (!text) return null;
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  
  const handleEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      top: rect.top - 10, // 10px spacing above target
      left: rect.left + rect.width / 2
    });
    setShow(true);
  };

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-secondary)",
        fontSize: "11px",
        cursor: "help",
        marginLeft: "6px",
      }}
    >
      ?
      {show && createPortal(
        <div style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          transform: "translate(-50%, -100%)",
          padding: "8px 12px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          color: "var(--text-primary)",
          fontSize: "12px",
          fontWeight: "400",
          whiteSpace: "normal",
          width: "max-content",
          maxWidth: "220px",
          zIndex: 99999, // Ensure it's above everything including modals
          textAlign: "center",
          lineHeight: "1.4",
          pointerEvents: "none"
        }}>
          {text}
          {/* Arrow pointing down */}
          <div style={{
            position: "absolute",
            bottom: "-6px",
            left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: "10px",
            height: "10px",
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border-subtle)",
            borderRight: "1px solid var(--border-subtle)",
          }} />
        </div>,
        document.body
      )}
    </span>
  );
}

/** Compact editor for string conditions: eq, in, prefix, exists */
function StringConditionField({ label, operator, onOperatorChange, value, onValueChange, placeholder = "", helpText = "" }) {
  const isExists = operator === "exists";
  const operatorHelp = "eq = exact match, in = any of list (comma-separated), prefix = starts with, exists = field must be present";
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ minWidth: "80px", display: "flex", alignItems: "center", gap: "4px" }}>
        <span class="text-secondary text-xs" style={{ whiteSpace: "nowrap" }}>{label}</span>
        {helpText ? <HelpTip text={helpText} /> : <HelpTip text={operatorHelp} />}
      </div>
      <select
        value={operator}
        onChange={(e) => onOperatorChange(e.target.value)}
        title={operatorHelp}
        style={{ width: "72px", padding: "4px 6px", fontSize: "11px", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}
      >
        <option value="eq">eq</option>
        <option value="in">in</option>
        <option value="prefix">prefix</option>
        <option value="exists">exists</option>
      </select>
      {!isExists && (
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onInput={(e) => onValueChange(e.target.value)}
          style={{ flex: 1, minWidth: "120px", padding: "4px 8px", fontSize: "12px" }}
        />
      )}
      {isExists && (
        <span class="text-secondary text-xs" style={{ alignSelf: "center" }}>field must exist</span>
      )}
    </div>
  );
}

function OptionCard({ title, description, icon, selected, onClick, type = "default", disabled = false, helpText = "" }) {
  const baseBorder = selected ? "var(--accent-primary)" : "var(--border-subtle)";
  const bg = selected ? "var(--bg-panel-hover)" : "var(--bg-subtle)";
  return (
    <div
      onClick={() => !disabled && onClick()}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        borderRadius: "8px",
        border: `1px solid ${baseBorder}`,
        background: bg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.2s ease",
        position: "relative",
      }}
    >
      <div style={{ 
        marginTop: "2px", 
        color: selected ? "var(--accent-primary)" : "var(--text-secondary)" 
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-primary)", display: "flex", alignItems: "center" }}>
          <span>{title}</span>
          <HelpTip text={helpText} />
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px", lineHeight: "1.4" }}>
          {description}
        </div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
        <div style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          border: `2px solid ${selected ? "var(--accent-primary)" : "var(--text-secondary)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {selected && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-primary)" }} />}
        </div>
      </div>
    </div>
  );
}

export function PolicyDraftPanel() {
  const { open, trace, mode, policy } = policyDraftPanel.value;
  const isEditMode = mode === "edit";
  const toolNames = trace?.tool_names || [];
  const defaultTool = toolNames[toolNames.length - 1] || "unknown";
  const [selectedTool, setSelectedTool] = useState(defaultTool);
  const [decision, setDecision] = useState("");
  const [precedence, setPrecedence] = useState("");
  const [saving, setSaving] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [quickDecision, setQuickDecision] = useState("allow");
  const [scopeChoice, setScopeChoice] = useState("workspace");
  const [commandChoice, setCommandChoice] = useState("this_command");
  const [allowAcknowledged, setAllowAcknowledged] = useState(false);
  const [priority, setPriority] = useState("high");
  const [argv0Input, setArgv0Input] = useState("");
  const [commandDraft, setCommandDraft] = useState("");
  const [argv0Operator, setArgv0Operator] = useState("in");
  const [pathScopeInput, setPathScopeInput] = useState("");
  const [pathOperator, setPathOperator] = useState("all_under");
  const [agentIdInput, setAgentIdInput] = useState("");
  const [agentRoleInput, setAgentRoleInput] = useState("");
  const [agentIdOperator, setAgentIdOperator] = useState("eq");
  const [agentRoleOperator, setAgentRoleOperator] = useState("eq");
  const [toolGroupInput, setToolGroupInput] = useState("");
  const [toolGroupOperator, setToolGroupOperator] = useState("eq");
  const [actorInput, setActorInput] = useState("");
  const [actorOperator, setActorOperator] = useState("eq");
  const [actionInput, setActionInput] = useState("");
  const [actionOperator, setActionOperator] = useState("eq");
  const [resourceInput, setResourceInput] = useState("");
  const [resourceOperator, setResourceOperator] = useState("eq");
  const [execCwdInput, setExecCwdInput] = useState("");
  const [execCwdOperator, setExecCwdOperator] = useState("eq");
  const [packageManagerInput, setPackageManagerInput] = useState("");
  const [packageManagerOperator, setPackageManagerOperator] = useState("eq");
  const [capabilityInput, setCapabilityInput] = useState("");
  const [capabilityOperator, setCapabilityOperator] = useState("eq");
  const [intentInput, setIntentInput] = useState("");
  const [intentOperator, setIntentOperator] = useState("eq");
  const [pathExists, setPathExists] = useState(false);
  const [argv0Exists, setArgv0Exists] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const [requiresReAck, setRequiresReAck] = useState(false);
  const [validationError, setValidationError] = useState(null);

  const seed =
    open && isEditMode
      ? buildSeedFromPolicy(policy)
      : open && trace
        ? buildSeedFromTrace(trace, selectedTool || defaultTool)
        : null;
  const tool = seed?.subject?.name ?? "";
  const tenant = seed?.scope?.tenant_id ?? "";
  const workspace = seed?.scope?.workspace_id ?? "";
  const currentRequest = trace ? getCurrentRequest(trace) : { context: {}, templateVars: {} };
  const currentContext = currentRequest.context || {};

  useEffect(() => {
    if (!open) {
      setDecision("");
      setPrecedence("");
      setSelectedTool("unknown");
      setWizardStep(1);
      setAllowAcknowledged(false);
      setPriority("high");
      setPreviewResult(null);
      setRequiresReAck(false);
      setCommandDraft("");
      return;
    }
    if (isEditMode && policy) {
      const editSeed = buildSeedFromPolicy(policy);
      setSelectedTool(editSeed.subject?.name || "unknown");
      setQuickDecision(editSeed.derived.quickDecision);
      setScopeChoice(editSeed.derived.scopeChoice);
      setCommandChoice(editSeed.derived.commandChoice);
      setDecision(editSeed.effect.decision);
      setPrecedence(String(editSeed.precedence ?? 20));
      setArgv0Input(editSeed.derived.argv0Values.join(", "));
      setArgv0Operator(editSeed.derived.argv0Operator);
      setPathScopeInput(editSeed.derived.pathScopes.join(", "));
      setPathOperator(editSeed.derived.pathOperator);
      setPathExists(editSeed.derived.pathOperator === "exists");
      setArgv0Exists(editSeed.derived.argv0Operator === "exists");
      setCommandChoice(editSeed.derived.commandChoice || "this_command");
      setAgentIdInput(editSeed.derived.agentIdValues?.join(", ") || "");
      setAgentRoleInput(editSeed.derived.agentRoleValues?.join(", ") || "");
      setAgentIdOperator(editSeed.derived.agentIdOperator || "eq");
      setAgentRoleOperator(editSeed.derived.agentRoleOperator || "eq");
      setToolGroupInput(editSeed.derived.toolGroupValues?.join(", ") || "");
      setToolGroupOperator(editSeed.derived.toolGroupOperator || "eq");
      setActorInput(editSeed.derived.actorValues?.join(", ") || "");
      setActorOperator(editSeed.derived.actorOperator || "eq");
      setActionInput(editSeed.derived.actionValues?.join(", ") || "");
      setActionOperator(editSeed.derived.actionOperator || "eq");
      setResourceInput(editSeed.derived.resourceValues?.join(", ") || "");
      setResourceOperator(editSeed.derived.resourceOperator || "eq");
      setExecCwdInput(editSeed.derived.execCwdValues?.join(", ") || "");
      setExecCwdOperator(editSeed.derived.execCwdOperator || "eq");
      setPackageManagerInput(editSeed.derived.packageManagerValues?.join(", ") || "");
      setPackageManagerOperator(editSeed.derived.packageManagerOperator || "eq");
      setCapabilityInput(editSeed.derived.capabilityValues?.join(", ") || "");
      setCapabilityOperator(editSeed.derived.capabilityOperator || "eq");
      setIntentInput(editSeed.derived.intentValues?.join(", ") || "");
      setIntentOperator(editSeed.derived.intentOperator || "eq");
      setWizardStep(1);
      setAllowAcknowledged(false);
      setPreviewResult(null);
      setRequiresReAck(false);
      setCommandDraft("");
      return;
    }
    setSelectedTool(defaultTool);
    setQuickDecision("allow");
    setScopeChoice("workspace");
    setCommandChoice("this_command");
    setDecision("allow");
    setPrecedence("30");
    const requestContext = trace?.request_snapshot?.request?.context || trace?.context || {};
    const initialCommands = getCommandCandidatesFromContext(requestContext);
    setArgv0Input(initialCommands.join(", "));
    setPathScopeInput("{{workspace.root}}");
    setArgv0Operator("eq");
    setPathOperator("all_under");
    setAgentIdInput(trace?.request_snapshot?.request?.agent_id || "");
    setAgentRoleInput(trace?.request_snapshot?.request?.agent_role || "");
    setAgentIdOperator("eq");
    setAgentRoleOperator("eq");
    setToolGroupInput(trace?.tool_group || "");
    setToolGroupOperator("eq");
    setActorInput("");
    setActorOperator("eq");
    setActionInput("");
    setActionOperator("eq");
    setResourceInput("");
    setResourceOperator("eq");
    setExecCwdInput("");
    setExecCwdOperator("eq");
    setPackageManagerInput("");
    setPackageManagerOperator("eq");
    setCapabilityInput("");
    setCapabilityOperator("eq");
    setIntentInput("");
    setIntentOperator("eq");
    setPathExists(false);
    setArgv0Exists(false);
    setWizardStep(1);
    setAllowAcknowledged(false);
    setPreviewResult(null);
    setRequiresReAck(false);
    setCommandDraft("");
    setValidationError(null);
  }, [open, defaultTool, isEditMode, policy]);

  if (!open || !seed) return null;

  const close = () => {
    policyDraftPanel.value = { open: false, mode: "create", trace: null, policy: null };
  };

  const precedenceNum = precedence.trim() === "" ? NaN : parseInt(precedence, 10);
  const precedenceInRange =
    !isNaN(precedenceNum) && precedenceNum >= -1000 && precedenceNum <= 1000;
  const canCreateBase =
    (decision === "allow" || decision === "require_approval" || decision === "deny") &&
    precedenceInRange;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Enter" && !e.repeat) {
        const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
        if (inInput) return;
        e.preventDefault();
        if (wizardStep < 3) nextStep();
        else if (canCreateBase && !saving) submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, wizardStep, canCreateBase, saving]);

  const exceptionForPolicyId = (() => {
    if (isEditMode || !trace?.request_snapshot?.decision) return undefined;
    const matched = trace.request_snapshot.decision.matched_policies;
    const first = Array.isArray(matched) ? matched[0] : undefined;
    return typeof first === "string" ? first : undefined;
  })();
  const splitValues = (s) => (s || "").split(",").map((v) => v.trim()).filter(Boolean);
  const argv0Values = argv0Exists ? [] : splitValues(argv0Input);
  const pathScopes = splitValues(pathScopeInput);
  const agentIdValues = splitValues(agentIdInput);
  const agentRoleValues = splitValues(agentRoleInput);
  const toolGroupValues = splitValues(toolGroupInput);
  const actorValues = splitValues(actorInput);
  const actionValues = splitValues(actionInput);
  const resourceValues = splitValues(resourceInput);
  const execCwdValues = splitValues(execCwdInput);
  const packageManagerValues = splitValues(packageManagerInput);
  const capabilityValues = splitValues(capabilityInput);
  const intentValues = splitValues(intentInput);
  const broadException =
    decision === "allow" &&
    (argv0Values.length === 0 || argv0Values.length > 5 || pathScopes.length === 0);
  const risk = scoreRuleRisk({
    decision,
    argv0Operator,
    argv0Values,
    pathOperator,
    pathScopes,
    precedenceNum,
    context: currentContext,
  });
  const riskLabel = risk.level.toUpperCase();
  const riskTone =
    risk.level === "high"
      ? "var(--accent-danger)"
      : risk.level === "medium"
        ? "var(--accent-warn)"
        : "var(--accent-success)";

  const detectedArgv0 = seed?.context?.argv0 || "";
  const reviewSummary =
    quickDecision === "allow"
      ? `${isEditMode ? "Update" : "Create"} an allow rule so future matching requests bypass the approval queue.`
      : quickDecision === "require_approval"
        ? `${isEditMode ? "Update rule to keep" : "Keep"} requiring approval for this action.`
        : "Always deny this action.";

  const reviewConstraints = [
    `Tool: ${tool || "unknown"}`,
    `Workspace: ${workspace || "all workspaces in tenant"}`,
    `Command: ${
      argv0Exists ? "must exist" : argv0Values.length > 0
        ? argv0Operator === "eq"
          ? `eq ${argv0Values[0]}`
          : argv0Operator === "prefix"
            ? `prefix ${argv0Values[0]}`
            : `in [${argv0Values.join(", ")}]`
        : "none"
    }`,
    `Path: ${
      pathExists ? "must exist" : pathScopes.length > 0
        ? `${pathOperator} [${pathScopes.join(", ")}]`
        : "none"
    }`,
    ...(agentIdInput.trim() || agentRoleInput.trim()
      ? [`Agent: ${agentIdOperator} ${agentIdInput.trim() || "—"} / ${agentRoleOperator} ${agentRoleInput.trim() || "—"}`]
      : []),
    ...(toolGroupInput.trim() ? [`Tool group: ${toolGroupOperator} ${toolGroupInput.trim()}`] : []),
    ...(actorInput.trim() ? [`Actor: ${actorOperator} ${actorInput.trim()}`] : []),
    ...(actionInput.trim() ? [`Action: ${actionOperator} ${actionInput.trim()}`] : []),
    ...(resourceInput.trim() ? [`Resource: ${resourceOperator} ${resourceInput.trim()}`] : []),
    ...(execCwdInput.trim() ? [`Exec CWD: ${execCwdOperator} ${execCwdInput.trim()}`] : []),
    ...(packageManagerInput.trim() ? [`Package manager: ${packageManagerOperator} ${packageManagerInput.trim()}`] : []),
    ...(capabilityInput.trim() ? [`Capability: ${capabilityOperator} ${capabilityInput.trim()}`] : []),
    ...(intentInput.trim() ? [`Intent: ${intentOperator} ${intentInput.trim()}`] : []),
  ];
  const hasWorkspaceTemplateVar =
    typeof currentRequest?.templateVars?.["workspace.root"] === "string" &&
    currentRequest.templateVars["workspace.root"].trim() !== "";
  const resolvedWorkspaceRoot = resolveWorkspaceRoot(currentRequest);
  const effectivePathScopes = pathScopes.map((scope) =>
    hasWorkspaceTemplateVar ? scope : scope.replace(/\{\{\s*workspace\.root\s*\}\}/g, resolvedWorkspaceRoot)
  );
  const buildConditions = () => {
    const c = {};
    const toolName = seed?.subject?.name || seed?.conditions?.tool;
    if (toolName) c.tool = toolName;
    if (argv0Exists) {
      c["context.exec.argv0"] = { exists: true };
    } else if (argv0Values.length > 0) {
      c["context.exec.argv0"] =
        argv0Operator === "eq" ? argv0Values[0] : argv0Operator === "prefix" ? { prefix: argv0Values[0] } : { in: argv0Values };
    }
    if (pathExists) {
      c["context.targets.paths"] = { exists: true };
    } else if (pathScopes.length > 0) {
      c["context.targets.paths"] =
        pathOperator === "any_under" ? { any_under: effectivePathScopes } : { all_under: effectivePathScopes };
    }
    const agentIdCond = buildStringCondition(agentIdOperator, agentIdValues);
    if (agentIdCond !== undefined) c.agent_id = agentIdCond;
    const agentRoleCond = buildStringCondition(agentRoleOperator, agentRoleValues);
    if (agentRoleCond !== undefined) c.agent_role = agentRoleCond;
    const toolGroupCond = buildStringCondition(toolGroupOperator, toolGroupValues);
    if (toolGroupCond !== undefined) c.tool_group = toolGroupCond;
    const actorCond = buildStringCondition(actorOperator, actorValues);
    if (actorCond !== undefined) c.actor = actorCond;
    const actionCond = buildStringCondition(actionOperator, actionValues);
    if (actionCond !== undefined) c.action = actionCond;
    const resourceCond = buildStringCondition(resourceOperator, resourceValues);
    if (resourceCond !== undefined) c.resource = resourceCond;
    const execCwdCond = buildStringCondition(execCwdOperator, execCwdValues);
    if (execCwdCond !== undefined) c["context.exec.cwd"] = execCwdCond;
    const packageManagerCond = buildStringCondition(packageManagerOperator, packageManagerValues);
    if (packageManagerCond !== undefined) c["context.package_manager"] = packageManagerCond;
    const capabilityCond = buildStringCondition(capabilityOperator, capabilityValues);
    if (capabilityCond !== undefined) c.capability = capabilityCond;
    const intentCond = buildStringCondition(intentOperator, intentValues);
    if (intentCond !== undefined) c.intent = intentCond;
    return c;
  };

  const rawPolicyPreview = {
    policy_id: seed?.policy_id,
    scope: { ...seed?.scope },
    subject: { ...seed?.subject },
    conditions: buildConditions(),
    effect: { decision },
    precedence: precedenceNum,
    enabled: true,
  };
  const rawPolicyJson = JSON.stringify(rawPolicyPreview, null, 2);
  const changedFields = [];
  if (isEditMode && policy) {
    if ((policy?.effect?.decision || "require_approval") !== decision) changedFields.push("effect");
    if ((policy?.precedence ?? 20) !== precedenceNum) changedFields.push("priority");
    const previousArgv0 = normalizeArgv0Condition(policy?.conditions?.["context.exec.argv0"]);
    const previousPaths = normalizePathCondition(policy?.conditions?.["context.targets.paths"]);
    if (JSON.stringify(previousArgv0.values) !== JSON.stringify(argv0Values)) changedFields.push("command matching");
    if (previousArgv0.operator !== argv0Operator) changedFields.push("command operator");
    if (JSON.stringify(previousPaths.values) !== JSON.stringify(pathScopes)) changedFields.push("path scope");
    if (previousPaths.operator !== pathOperator) changedFields.push("path operator");
  }

  const allowEligible = isEditMode ? true : !(risk.level === "high" && quickDecision === "allow");

  const setCommandValues = (values) => {
    const unique = [];
    const seen = new Set();
    for (const value of values) {
      const token = extractFirstToken(value);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      unique.push(token);
    }
    setArgv0Input(unique.join(", "));
  };

  const addCommandFromDraft = () => {
    const token = extractFirstToken(commandDraft);
    if (!token) return;
    setCommandValues([...argv0Values, token]);
    setCommandDraft("");
  };

  const removeCommand = (value) => {
    setCommandValues(argv0Values.filter((cmd) => cmd !== value));
  };

  useEffect(() => {
    if (!isEditMode || !policy) {
      setRequiresReAck(false);
      return;
    }
    const previousDecision = policy?.effect?.decision;
    const previousArgv0 = normalizeArgv0Condition(policy?.conditions?.["context.exec.argv0"]);
    const previousPaths = normalizePathCondition(policy?.conditions?.["context.targets.paths"]);
    const scopeWidened = previousPaths.values.length > 0 && pathScopes.length > previousPaths.values.length;
    const commandWidened = previousArgv0.values.length > 0 && argv0Values.length > previousArgv0.values.length;
    const switchedToAllow = previousDecision !== "allow" && decision === "allow";
    setRequiresReAck(decision === "allow" && (switchedToAllow || scopeWidened || commandWidened));
  }, [isEditMode, policy, decision, argv0Values, pathScopes]);

  const applyPriority = (value) => {
    setPriority(value);
    if (value === "low") setPrecedence("10");
    else if (value === "normal") setPrecedence("20");
    else setPrecedence("30");
  };

  const applyQuickDecision = (value) => {
    setQuickDecision(value);
    if (value === "allow") {
      setDecision("allow");
      applyPriority("high");
    } else if (value === "require_approval") {
      setDecision("require_approval");
      applyPriority("normal");
    } else {
      setDecision("deny");
      setPriority("high");
      setPrecedence("40");
    }
  };

  const applyScopeChoice = (value) => {
    setScopeChoice(value);
    if (quickDecision === "allow" && value === "workspace") {
      setPathOperator("all_under");
      setPathScopeInput("{{workspace.root}}");
    }
  };

  const applyCommandChoice = (value) => {
    setCommandChoice(value);
    if (quickDecision !== "allow") return;
    if (value === "this_command") {
      setArgv0Operator("eq");
      if (detectedArgv0) setArgv0Input(detectedArgv0);
      return;
    }
    setArgv0Operator("in");
  };

  const nextStep = () => {
    if (wizardStep === 1) {
      if (quickDecision === "allow") {
        if (!allowEligible) {
          showToast("Allow is disabled for high-risk requests. Narrow the scope or keep approval.", "warn");
          return;
        }
        setDecision("allow");
        applyPriority("high");
      } else if (quickDecision === "require_approval") {
        setDecision("require_approval");
        applyPriority("normal");
      } else {
        setDecision("deny");
        setPrecedence("40");
      }
      setWizardStep(2);
      return;
    }
    if (wizardStep === 2) {
      if (decision === "allow") {
        if (commandChoice === "this_command" && detectedArgv0) {
          setArgv0Operator("eq");
          setArgv0Input(detectedArgv0);
        }
        if (scopeChoice === "workspace") {
          setPathOperator("all_under");
          setPathScopeInput("{{workspace.root}}");
        }
      }
      setWizardStep(3);
    }
  };

  const backStep = () => setWizardStep((s) => Math.max(1, s - 1));

  const runPreview = () => {
    const result = evaluateCandidateMatch({
      currentRequest,
      decision,
      argv0Operator,
      argv0Values,
      argv0Exists,
      pathOperator,
      pathScopes,
      pathExists,
    });
    setPreviewResult(result);
  };

  const copyRawPolicyJson = async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(rawPolicyJson);
      showToast("Policy JSON copied", "success");
    } catch (err) {
      showToast("Unable to copy JSON from this context", "warn");
    }
  };

  const submit = async () => {
    if (decision === "allow" && (!allowAcknowledged && (requiresReAck || !isEditMode))) {
      setValidationError("ack_required");
      // Scroll to ack box if needed
      const ackBox = document.getElementById("ack-container");
      if (ackBox) ackBox.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!canCreateBase) return;
    setSaving(true);
    setValidationError(null);
    try {
      const payload = {
        policy_id: seed.policy_id,
        scope: { ...seed.scope },
        subject: { ...seed.subject },
        conditions: buildConditions(),
        effect: { decision },
        explanation: seed.explanation,
        precedence: precedenceNum,
        enabled: true,
        _source_trace_id: trace?.id,
        _source_adapter_id: trace?.adapter_id ?? undefined,
        _wizard_meta: {
          created_via_wizard: true,
          selected_outcome: quickDecision,
          scope_choice: scopeChoice === "custom" ? "custom_path_scope" : scopeChoice,
          command_match_choice:
            commandChoice === "this_command"
              ? "single"
              : commandChoice === "custom_list"
                ? "list"
                : "none",
          warnings_shown: [
            ...(broadException ? ["broad_scope"] : []),
            ...(risk.level === "high" ? ["high_risk_allow_attempt"] : []),
            ...(decision === "allow" && pathScopes.length === 0 ? ["missing_path_scope"] : []),
            ...(decision === "allow" && argv0Values.length === 0 ? ["missing_command_scope"] : []),
          ],
          wizard_acknowledged_allow: decision === "allow" ? Boolean(allowAcknowledged || !requiresReAck) : false,
          edited_via_wizard: isEditMode,
          last_edited_reason: isEditMode ? "policy_registry" : undefined,
          ...(typeof exceptionForPolicyId === "string" && exceptionForPolicyId
            ? { exception_for_policy_id: exceptionForPolicyId }
            : {}),
        },
      };
      const result = await apiPost("/ops/api/policies", payload);
      if (Array.isArray(result?.resolved_decision_ids) && result.resolved_decision_ids.length > 0) {
        policyExceptionResolution.value = {
          updatedAt: Date.now(),
          decisionIds: result.resolved_decision_ids,
          sourceTraceId: result.source_decision.source_trace_id || trace?.id || null,
          resolvedCount: Number(result?.resolved_decision_count || result.resolved_decision_ids.length),
        };
      }
      if (!isEditMode && result?.source_decision?.resolved) {
        showToast("Exception rule created and pending request auto-approved", "success");
      } else {
        showToast(isEditMode ? "Exception rule updated" : "Exception rule created", "success");
      }
      close();
    } catch (e) {
      showToast(e?.message || "Failed to create exception rule", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="modal" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div class="modal-backdrop" onClick={close} />
      <div class="modal-dialog" style={{ 
        maxWidth: "600px", 
        width: "90%",
        maxHeight: "85vh", 
        display: "flex", 
        flexDirection: "column",
        padding: "0", 
        overflow: "hidden" 
      }}>
        
        {/* Header */}
        <div style={{ flexShrink: 0, padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
              {isEditMode ? "Edit Exception for " : "New Rule for "}
              <span class="mono" style={{ color: "var(--accent-primary)" }}>{tool}</span>
              <HelpTip text={isEditMode ? "Modify this exception rule. Changes apply to future matching requests." : "Create a new policy or exception rule. Follow the 3 steps: Outcome → Scope → Review."} />
            </h3>
            <button class="btn-icon" onClick={close} title="Close wizard"><XIcon /></button>
          </div>
          {isEditMode && (
            <div class="text-secondary text-xs" style={{ marginTop: "-6px" }}>
              Editing existing exception
            </div>
          )}
          
          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {[
              { id: 1, label: "Outcome", hint: "Allow, deny, or approve" },
              { id: 2, label: "Scope", hint: "Where & when it applies" },
              { id: 3, label: "Review", hint: "Confirm & create" }
            ].map((step, idx) => {
              const active = wizardStep === step.id;
              const completed = wizardStep > step.id;
              return (
                <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1, gap: "8px" }} title={step.hint}>
                  <div style={{ 
                    width: "24px", height: "24px", 
                    borderRadius: "50%", 
                    background: active ? "var(--accent-primary)" : completed ? "var(--accent-success)" : "var(--bg-subtle)",
                    color: active || completed ? "#fff" : "var(--text-secondary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "12px", fontWeight: "bold"
                  }}>
                    {completed ? <CheckIcon width={14} /> : step.id}
                  </div>
                  <div>
                    <span style={{ 
                      fontSize: "12px", 
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)"
                    }}>
                      {step.label}
                    </span>
                    {active && (
                      <div class="text-secondary text-xs" style={{ marginTop: "1px", fontWeight: 400 }}>
                        {step.hint}
                      </div>
                    )}
                  </div>
                  {idx < 2 && <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)", marginLeft: "8px" }} />}
                </div>
              );
            })}
          </div>
        </div>

        <div class="modal-body" style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          
          {wizardStep === 1 && (
            <div class="form-group">
              <label style={{ fontSize: "14px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                What should happen when this tool is used?
                <HelpTip text="Choose the outcome: Allow runs automatically, Require Approval pauses for human review, or Deny blocks execution." />
              </label>
              <div style={{ display: "grid", gap: "10px" }}>
                <OptionCard
                  title="Create Allow Rule"
                  description="Automatically permit matching requests without human intervention."
                  icon={<ShieldIcon width={18} />}
                  selected={quickDecision === "allow"}
                  onClick={() => applyQuickDecision("allow")}
                  disabled={!allowEligible}
                  helpText="Use for trusted tools and commands that are safe to run automatically."
                />
                {!allowEligible && (
                  <div style={{ fontSize: "11px", color: "var(--accent-warn)", paddingLeft: "42px", marginTop: "-4px" }}>
                    Unavailable for high-risk requests. Narrow the scope in Step 2 or create an approval rule.
                  </div>
                )}
                <OptionCard
                  title="Require Approval"
                  description="Pause execution and notify operators for manual review."
                  icon={<ActivityIcon width={18} />}
                  selected={quickDecision === "require_approval"}
                  onClick={() => applyQuickDecision("require_approval")}
                  helpText="Use when human oversight is needed before execution proceeds."
                />
                <OptionCard
                  title="Deny"
                  description="Always block this action."
                  icon={<XIcon width={18} />}
                  selected={quickDecision === "deny"}
                  onClick={() => applyQuickDecision("deny")}
                  helpText="Explicitly block this tool or command usage."
                />
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div class="form-group">
              <label style={{ fontSize: "14px", marginBottom: "12px", display: "flex", alignItems: "center" }}>
                <span>Where should this rule apply?</span>
                <HelpTip text="Choose where the rule is active. Workspace scope is safer; custom scope can broaden coverage." />
              </label>
              <div style={{ display: "grid", gap: "10px" }}>
                <OptionCard
                  title={
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      This Workspace Only
                      {quickDecision === "allow" && (
                        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent-success)", background: "rgba(var(--accent-success-rgb), 0.15)", padding: "2px 6px", borderRadius: "4px" }}>
                          Recommended
                        </span>
                      )}
                    </span>
                  }
                  description={`Limit to workspace: ${workspace || "current"}`}
                  icon={<div style={{ fontWeight: "bold" }}>W</div>}
                  selected={scopeChoice === "workspace"}
                  onClick={() => applyScopeChoice("workspace")}
                  helpText="Restricts this rule to the current project folder only. Safest option."
                />
                <OptionCard
                  title="Custom Scope"
                  description="Define specific path patterns or global scope."
                  icon={<SearchIcon width={18} />}
                  selected={scopeChoice === "custom"}
                  onClick={() => applyScopeChoice("custom")}
                  helpText="Set explicit path constraints. Use this when workspace-only is too narrow."
                />
              </div>

              {scopeChoice === "custom" && quickDecision === "allow" && (
                <div style={{ marginTop: "12px", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px" }}>
                  <label style={{ fontSize: "12px", display: "flex", alignItems: "center", marginBottom: "8px" }}>
                    <input
                      type="checkbox"
                      checked={pathExists}
                      onInput={(e) => setPathExists(e.target.checked)}
                      style={{ marginRight: "8px" }}
                    />
                    <span>Path must exist (no path roots)</span>
                    <HelpTip text="When checked, the request must have target paths; no path scope roots are used." />
                  </label>
                  {!pathExists && (
                    <>
                      <label style={{ fontSize: "12px", display: "flex", alignItems: "center" }}>
                        <span>Path Scope (glob patterns)</span>
                        <HelpTip text="Comma-separated path roots. Use {{workspace.root}} for current workspace. Keep this as narrow as possible." />
                      </label>
                      <input
                        type="text"
                        placeholder="{{workspace.root}} or /path/to/root"
                        value={pathScopeInput}
                        onInput={(e) => setPathScopeInput(e.target.value)}
                        style={{ marginTop: "4px", width: "100%" }}
                        title="Comma-separated path roots. Targets must be under these. Use {{workspace.root}} for current workspace."
                      />
                    </>
                  )}
                </div>
              )}

              <div style={{ marginTop: "12px", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px" }}>
                <label style={{ fontSize: "12px", display: "flex", alignItems: "center", marginBottom: "8px" }}>
                  <span>Agent Scope (optional)</span>
                  <HelpTip text="Restrict this rule to specific agent_id or agent_role. eq = exact, in = list, prefix = starts-with, exists = field must be present." />
                </label>
                <div style={{ display: "grid", gap: "10px" }}>
                  <StringConditionField
                    label="Agent ID"
                    operator={agentIdOperator}
                    onOperatorChange={setAgentIdOperator}
                    value={agentIdInput}
                    onValueChange={setAgentIdInput}
                    placeholder="e.g. agent-1 or comma-separated for in"
                  />
                  <StringConditionField
                    label="Agent Role"
                    operator={agentRoleOperator}
                    onOperatorChange={setAgentRoleOperator}
                    value={agentRoleInput}
                    onValueChange={setAgentRoleInput}
                    placeholder="e.g. assistant"
                  />
                </div>
              </div>

              <details style={{ marginTop: "16px" }}>
                <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  Advanced conditions
                  <HelpTip text="Optional: tool_group, actor, action, resource, exec CWD, package manager, capability, intent. Use for fine-grained matching beyond tool and paths." />
                </summary>
                <div style={{ marginTop: "12px", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px", display: "grid", gap: "10px" }}>
                  <StringConditionField
                    label="Tool group"
                    operator={toolGroupOperator}
                    onOperatorChange={setToolGroupOperator}
                    value={toolGroupInput}
                    onValueChange={setToolGroupInput}
                    placeholder="e.g. runtime, fs"
                    helpText="Category like runtime, fs, web. Broader than tool."
                  />
                  <StringConditionField
                    label="Actor"
                    operator={actorOperator}
                    onOperatorChange={setActorOperator}
                    value={actorInput}
                    onValueChange={setActorInput}
                    placeholder="e.g. agent-1"
                    helpText="Generic actor; maps to agent_id when present."
                  />
                  <StringConditionField
                    label="Action"
                    operator={actionOperator}
                    onOperatorChange={setActionOperator}
                    value={actionInput}
                    onValueChange={setActionInput}
                    placeholder="e.g. exec"
                    helpText="Generic action; maps to tool when absent."
                  />
                  <StringConditionField
                    label="Resource"
                    operator={resourceOperator}
                    onOperatorChange={setResourceOperator}
                    value={resourceInput}
                    onValueChange={setResourceInput}
                    placeholder="e.g. command, external_url"
                    helpText="Resource being accessed."
                  />
                  <StringConditionField
                    label="Exec CWD"
                    operator={execCwdOperator}
                    onOperatorChange={setExecCwdOperator}
                    value={execCwdInput}
                    onValueChange={setExecCwdInput}
                    placeholder="e.g. /workspace"
                    helpText="Working directory for exec context."
                  />
                  <StringConditionField
                    label="Package manager"
                    operator={packageManagerOperator}
                    onOperatorChange={setPackageManagerOperator}
                    value={packageManagerInput}
                    onValueChange={setPackageManagerInput}
                    placeholder="e.g. npm, pnpm"
                    helpText="Package manager in context."
                  />
                  <StringConditionField
                    label="Capability"
                    operator={capabilityOperator}
                    onOperatorChange={setCapabilityOperator}
                    value={capabilityInput}
                    onValueChange={setCapabilityInput}
                    placeholder="e.g. exec"
                    helpText="Requested capability must be in requested_capabilities."
                  />
                  <StringConditionField
                    label="Intent"
                    operator={intentOperator}
                    onOperatorChange={setIntentOperator}
                    value={intentInput}
                    onValueChange={setIntentInput}
                    placeholder="e.g. read_file"
                    helpText="Inferred or declared intent."
                  />
                </div>
              </details>

              {quickDecision === "allow" && (
                <div style={{ marginTop: "20px" }}>
                  <label style={{ fontSize: "14px", marginBottom: "12px", display: "flex", alignItems: "center" }}>
                    <span>Command Matching</span>
                    <HelpTip text="Choose how strictly to match commands. Exact command is safest. Use prefix for broad matching; exists requires command to be present." />
                  </label>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <OptionCard
                      title={
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          Exact Command: {detectedArgv0 || "unknown"}
                          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent-success)", background: "rgba(var(--accent-success-rgb), 0.15)", padding: "2px 6px", borderRadius: "4px" }}>
                            Safest
                          </span>
                        </span>
                      }
                      description="Only allows this specific tool/binary."
                      icon={<div class="mono" style={{ fontSize: "10px" }}>&gt;_</div>}
                      selected={commandChoice === "this_command"}
                      onClick={() => { applyCommandChoice("this_command"); setArgv0Exists(false); }}
                      helpText="Only this one command will match."
                    />
                    <OptionCard
                      title="Custom Command List"
                      description="Allow a set of commands. Use eq, in, prefix, or exists."
                      icon={<div class="mono" style={{ fontSize: "10px" }}>[...]</div>}
                      selected={commandChoice === "custom_list"}
                      onClick={() => { applyCommandChoice("custom_list"); setArgv0Exists(false); }}
                      helpText="Allow multiple command names. Choose operator below."
                    />
                    <OptionCard
                      title="Command must exist"
                      description="Require context.exec.argv0 to be present (no value match)."
                      icon={<div class="mono" style={{ fontSize: "10px" }}>∃</div>}
                      selected={argv0Exists}
                      onClick={() => { setArgv0Exists(true); setCommandChoice("none"); }}
                      helpText="Matches when the request has a command; does not restrict which one."
                    />
                  </div>
                  {quickDecision === "allow" && (argv0Values.length === 0 || pathScopes.length === 0) && (
                    <div style={{ marginTop: "12px", padding: "10px 12px", background: "rgba(var(--accent-warn-rgb), 0.08)", borderRadius: "6px", borderLeft: "3px solid var(--accent-warn)", fontSize: "12px", color: "var(--text-secondary)" }}>
                      <strong style={{ color: "var(--accent-warn)" }}>Tip:</strong> Add command and path constraints to reduce risk. Allow rules without constraints match broadly.
                    </div>
                  )}
                </div>
              )}

              {/* Inline Inputs for Custom Command List */}
              {commandChoice === "custom_list" && !argv0Exists && (
                <div style={{ marginTop: "16px", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px" }}>
                  {quickDecision === "allow" && (
                    <>
                    <div style={{ marginBottom: "12px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ fontSize: "12px", display: "flex", alignItems: "center" }}>
                        <span>Operator</span>
                        <HelpTip text="eq = exact match, in = any of list, prefix = starts with." />
                      </label>
                      <select
                        value={argv0Operator}
                        onChange={(e) => setArgv0Operator(e.target.value)}
                        style={{ padding: "4px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}
                      >
                        <option value="eq">eq (exact)</option>
                        <option value="in">in (list)</option>
                        <option value="prefix">prefix</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: "12px" }}>
                      <label style={{ fontSize: "12px", marginBottom: "8px", display: "flex", alignItems: "center" }}>
                        <span>Allowed Commands</span>
                        <HelpTip text="These are command names that can run without approval when this rule matches. Remove anything you do not trust." />
                      </label>
                      <div
                        style={{
                          marginTop: "4px",
                          minHeight: "44px",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "8px",
                          padding: "8px",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          alignItems: "center",
                          background: "var(--bg-panel)",
                        }}
                      >
                        {argv0Values.length === 0 ? (
                          <span class="text-secondary text-xs">No commands selected yet.</span>
                        ) : (
                          argv0Values.map((cmd) => (
                            <span
                              key={cmd}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid var(--accent-primary)",
                                background: "rgba(var(--accent-primary-rgb), 0.12)",
                                color: "var(--text-primary)",
                                fontSize: "12px",
                              }}
                            >
                              <span class="mono">{cmd}</span>
                              <button
                                type="button"
                                class="btn-ghost"
                                onClick={() => removeCommand(cmd)}
                                style={{ padding: "0 2px", minHeight: "unset", lineHeight: 1 }}
                                aria-label={`Remove ${cmd}`}
                              >
                                x
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                        <input
                          type="text"
                          placeholder="Add command (e.g. ls)"
                          value={commandDraft}
                          onInput={(e) => setCommandDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addCommandFromDraft();
                            }
                          }}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          onClick={addCommandFromDraft}
                          disabled={!commandDraft.trim()}
                          title="Add this command to the allow list"
                        >
                          Add
                        </button>
                      </div>
                      <div class="text-secondary text-xs" style={{ marginTop: "6px" }}>
                        Commands from this trace are preloaded as chips. Remove any you do not want.
                      </div>
                    </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {wizardStep === 3 && (
            <>
              <div style={{ display: "grid", gap: "16px" }}>
                {/* Effect & Summary Card */}
                <div style={{ padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div>
                      <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, display: "flex", alignItems: "center" }}>
                        <span>Effect</span>
                        <HelpTip text="The final action taken when this rule matches." />
                      </div>
                      <div style={{ fontSize: "18px", fontWeight: 600, textTransform: "capitalize", display: "flex", alignItems: "center", gap: "8px" }}>
                        {quickDecision === "allow" && <ShieldIcon width={20} style={{ color: "var(--accent-success)" }} />}
                        {quickDecision === "require_approval" && <ActivityIcon width={20} style={{ color: "var(--accent-warn)" }} />}
                        {quickDecision === "deny" && <XIcon width={20} style={{ color: "var(--accent-danger)" }} />}
                        {quickDecision.replace("_", " ")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                        <span>Priority</span>
                        <HelpTip text="Higher priority rules override lower ones (30 > 20 > 10)." />
                      </div>
                      <select 
                        value={priority} 
                        onInput={(e) => applyPriority(e.target.value)}
                        title="Higher priority rules override lower ones when both match"
                        style={{ 
                          padding: "4px 8px", 
                          borderRadius: "4px", 
                          border: "1px solid var(--border-subtle)",
                          fontSize: "12px",
                          background: "var(--bg-canvas)",
                          minWidth: "100px"
                        }}
                      >
                        <option value="low" title="Overridden by normal and high">Low (10)</option>
                        <option value="normal" title="Overrides low, overridden by high">Normal (20)</option>
                        <option value="high" title="Overrides low and normal">High (30)</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                      Summary
                      <HelpTip text="Brief description of what this rule will do when it matches a request." />
                    </div>
                    <div style={{ lineHeight: "1.5", fontSize: "13px" }}>{reviewSummary}</div>
                    <div style={{ marginTop: "10px", padding: "10px 12px", background: "var(--bg-canvas)", borderRadius: "6px", borderLeft: "3px solid var(--accent-primary)", fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                      <strong style={{ color: "var(--text-primary)" }}>In plain English:</strong>{" "}
                      {quickDecision === "allow" && "Allow "}
                      {quickDecision === "require_approval" && "Require approval for "}
                      {quickDecision === "deny" && "Block "}
                      <span class="mono">{tool || "this tool"}</span>
                      {argv0Values.length > 0 && !argv0Exists && ` (${argv0Operator === "eq" ? argv0Values[0] : argv0Values.slice(0, 3).join(", ") + (argv0Values.length > 3 ? "…" : "")})`}
                      {pathScopes.length > 0 && !pathExists && ` when paths are under ${pathScopes[0]}${pathScopes.length > 1 ? " or others" : ""}`}
                      {(agentIdInput.trim() || agentRoleInput.trim()) && ` for ${[agentIdInput.trim(), agentRoleInput.trim()].filter(Boolean).join(" / ") || "agent"}`}
                      .
                    </div>
                  </div>
                </div>

                {/* Constraints Card */}
                <div style={{ padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
                   <div class="text-secondary text-xs" style={{ marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, display: "flex", alignItems: "center" }}>
                     <span>Scope Constraints</span>
                     <HelpTip text="The conditions that must be met for this rule to apply." />
                   </div>
                   <div style={{ display: "grid", gap: "12px" }}>
                     <div style={{ display: "flex", gap: "12px" }}>
                       <div style={{ width: "24px", display: "flex", justifyContent: "center", color: "var(--text-secondary)" }}>
                         <div style={{ fontWeight: "bold", fontSize: "12px" }}>W</div>
                       </div>
                       <div>
                         <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Workspace</div>
                         <div class="mono text-secondary" style={{ fontSize: "11px", marginTop: "2px" }}>{workspace || "all workspaces in tenant"}</div>
                       </div>
                     </div>
                     
                     <div style={{ display: "flex", gap: "12px" }}>
                       <div style={{ width: "24px", display: "flex", justifyContent: "center", color: "var(--text-secondary)" }}>
                         <div class="mono" style={{ fontSize: "10px" }}>&gt;_</div>
                       </div>
                       <div>
                         <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Command Match</div>
                         <div style={{ fontSize: "11px", marginTop: "2px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {argv0Exists ? (
                              <span class="text-secondary">exists</span>
                            ) : argv0Values.length > 0 ? (
                              <>
                                {argv0Values.map(cmd => (
                                  <span key={cmd} style={{ 
                                    background: "var(--bg-canvas)", 
                                    border: "1px solid var(--border-subtle)", 
                                    borderRadius: "4px", 
                                    padding: "1px 5px" 
                                  }} class="mono">
                                    {cmd}
                                  </span>
                                ))}
                                <span class="text-secondary" style={{ marginLeft: "4px" }}>({argv0Operator})</span>
                              </>
                            ) : (
                              <span class="text-secondary">Any command</span>
                            )}
                         </div>
                       </div>
                     </div>

                     <div style={{ display: "flex", gap: "12px" }}>
                       <div style={{ width: "24px", display: "flex", justifyContent: "center", color: "var(--text-secondary)" }}>
                         <SearchIcon width={14} />
                       </div>
                       <div>
                         <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Path Scope</div>
                         <div style={{ fontSize: "11px", marginTop: "2px" }}>
                           {pathExists ? (
                             <span class="text-secondary">exists</span>
                           ) : pathScopes.length > 0 ? (
                             <>
                               <span class="text-secondary" style={{ marginRight: "6px" }}>{pathOperator}</span>
                               {pathScopes.map(p => (
                                 <span key={p} style={{ 
                                   background: "var(--bg-canvas)", 
                                   border: "1px solid var(--border-subtle)", 
                                   borderRadius: "4px", 
                                   padding: "1px 5px",
                                   marginRight: "4px"
                                 }} class="mono">
                                   {p}
                                 </span>
                               ))}
                             </>
                           ) : (
                             <span class="text-secondary">No path constraints</span>
                           )}
                         </div>
                       </div>
                     </div>

                     {(agentIdInput.trim() || agentRoleInput.trim()) && (
                       <div style={{ display: "flex", gap: "12px" }}>
                         <div style={{ width: "24px", display: "flex", justifyContent: "center", color: "var(--text-secondary)" }}>
                           <span style={{ fontWeight: "bold", fontSize: "12px" }}>A</span>
                         </div>
                         <div>
                           <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Agent Scope</div>
                           <div style={{ fontSize: "11px", marginTop: "2px", color: "var(--text-secondary)" }}>
                             {[agentIdInput.trim() && `agent_id ${agentIdOperator}: ${agentIdInput.trim()}`, agentRoleInput.trim() && `agent_role ${agentRoleOperator}: ${agentRoleInput.trim()}`].filter(Boolean).join(" · ")}
                           </div>
                         </div>
                       </div>
                     )}

                     {(toolGroupInput.trim() || actorInput.trim() || actionInput.trim() || resourceInput.trim() || execCwdInput.trim() || packageManagerInput.trim() || capabilityInput.trim() || intentInput.trim()) && (
                       <div style={{ display: "flex", gap: "12px" }}>
                         <div style={{ width: "24px", display: "flex", justifyContent: "center", color: "var(--text-secondary)" }}>
                           <span style={{ fontWeight: "bold", fontSize: "12px" }}>+</span>
                         </div>
                         <div>
                           <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Advanced</div>
                           <div style={{ fontSize: "11px", marginTop: "2px", color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                             {toolGroupInput.trim() && <span>tool_group {toolGroupOperator}: {toolGroupInput.trim()}</span>}
                             {actorInput.trim() && <span>· actor {actorOperator}: {actorInput.trim()}</span>}
                             {actionInput.trim() && <span>· action {actionOperator}: {actionInput.trim()}</span>}
                             {resourceInput.trim() && <span>· resource {resourceOperator}: {resourceInput.trim()}</span>}
                             {execCwdInput.trim() && <span>· exec.cwd {execCwdOperator}: {execCwdInput.trim()}</span>}
                             {packageManagerInput.trim() && <span>· package_manager {packageManagerOperator}: {packageManagerInput.trim()}</span>}
                             {capabilityInput.trim() && <span>· capability {capabilityOperator}: {capabilityInput.trim()}</span>}
                             {intentInput.trim() && <span>· intent {intentOperator}: {intentInput.trim()}</span>}
                           </div>
                         </div>
                       </div>
                     )}
                   </div>
                </div>

                {isEditMode && changedFields.length > 0 && (
                  <div style={{ padding: "12px", border: "1px dashed var(--border-subtle)", borderRadius: "6px", fontSize: "12px" }}>
                    <span style={{ fontWeight: 600 }}>Modified fields: </span>
                    <span class="text-secondary">{changedFields.join(", ")}</span>
                  </div>
                )}
              </div>

              {decision === "allow" && (!isEditMode || requiresReAck) && (
                <div 
                  id="ack-container"
                  onClick={(e) => {
                    if (e.target.tagName !== "INPUT") {
                      setAllowAcknowledged(!allowAcknowledged);
                      if (validationError === "ack_required") setValidationError(null);
                    }
                  }}
                  style={{ 
                    marginTop: "16px",
                    background: allowAcknowledged ? "rgba(var(--accent-success-rgb), 0.1)" : validationError === "ack_required" ? "rgba(var(--accent-danger-rgb), 0.05)" : "var(--bg-canvas)", 
                    padding: "16px", 
                    borderRadius: "8px",
                    border: `1px solid ${allowAcknowledged ? "var(--accent-success)" : validationError === "ack_required" ? "var(--accent-danger)" : "var(--border-subtle)"}`,
                    display: "flex",
                    gap: "12px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    animation: validationError === "ack_required" ? "shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both" : "none"
                  }}
                >
                  <div style={{ marginTop: "2px" }}>
                    <input
                      type="checkbox"
                      checked={allowAcknowledged}
                      onInput={(e) => {
                        setAllowAcknowledged(Boolean(e.target.checked));
                        if (validationError === "ack_required") setValidationError(null);
                      }} 
                      style={{ 
                        cursor: "pointer",
                        width: "16px",
                        height: "16px",
                        accentColor: validationError === "ack_required" ? "var(--accent-danger)" : undefined
                      }}
                      id="ack-allow"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", color: validationError === "ack_required" ? "var(--accent-danger)" : "var(--text-primary)", cursor: "pointer" }}>
                      Confirm Allow Rule
                      <HelpTip text="Required for allow rules. Confirms you understand matching requests will run automatically without human approval." />
                    </label>
                    <div style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--text-secondary)" }}>
                      I understand this {isEditMode ? "updates" : "creates"} a permanent exception. 
                      Future executions matching these criteria will run <em>without</em> approval.
                    </div>
                    {validationError === "ack_required" && (
                      <div style={{ fontSize: "12px", color: "var(--accent-danger)", marginTop: "6px", fontWeight: 600 }}>
                        Please confirm to proceed.
                      </div>
                    )}
                  </div>
                </div>
              )}
              {isEditMode && decision === "allow" && !requiresReAck && (
                <div class="text-secondary text-xs" style={{ marginTop: "8px", paddingLeft: "4px" }}>
                  Existing allow scope is unchanged; additional acknowledgement is not required.
                </div>
              )}

              {/* Validation Feedback */}
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    Test Rule
                    <HelpTip text="Check if this rule would match the current trace. Useful before saving to verify command and path constraints." />
                  </span>
                  <button class="btn-secondary btn-sm" type="button" onClick={runPreview} title="Evaluate this rule against the current trace's request context">
                    Test vs Current Trace
                  </button>
                </div>
                
                {previewResult && (
                  <div style={{ 
                    padding: "12px", 
                    borderRadius: "6px", 
                    background: previewResult.match ? "rgba(var(--accent-success-rgb), 0.1)" : "rgba(var(--accent-danger-rgb), 0.1)",
                    border: `1px solid ${previewResult.match ? "var(--accent-success)" : "var(--accent-danger)"}`
                  }}>
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "8px", 
                      fontWeight: 600, 
                      fontSize: "13px",
                      color: previewResult.match ? "var(--accent-success)" : "var(--accent-danger)",
                      marginBottom: "8px"
                    }}>
                      {previewResult.match ? <CheckIcon width={16} /> : <XIcon width={16} />}
                      {previewResult.match ? "Matches current request" : "Does not match current request"}
                    </div>
                    <div style={{ display: "grid", gap: "4px" }}>
                      {previewResult.details.map((d, i) => (
                        <div key={i} style={{ 
                          fontSize: "12px", 
                          color: "var(--text-secondary)",
                          display: "flex",
                          gap: "6px"
                        }}>
                          <span>•</span>
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Advanced Controls Toggle - Only show if manually requested or in later steps if needed */}
          <details style={{ marginTop: "20px" }}>
            <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-secondary)" }}>
              Show raw policy configuration (view only)
            </summary>
            <div class="detail-block" style={{ marginTop: "8px", padding: "12px", border: "1px dashed var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                <div class="text-secondary text-xs">
                  Live preview of the policy payload. Edit via the wizard steps above.
                </div>
                <button type="button" class="btn-secondary btn-sm" onClick={copyRawPolicyJson} title="Copy the policy JSON to clipboard for inspection or external use">
                  Copy JSON
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px",
                  borderRadius: "8px",
                  background: "var(--bg-canvas)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  lineHeight: "1.45",
                  overflowX: "auto",
                  whiteSpace: "pre",
                }}
              >
                {rawPolicyJson}
              </pre>
            </div>
          </details>

          {/* Persistent Risk/Warning Bar */}
          {decision === "allow" && (
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", borderLeft: `3px solid ${riskTone}` }}>
              <div style={{ fontSize: "12px", fontWeight: "bold", color: riskTone, display: "flex", alignItems: "center", gap: "6px" }}>
                Risk: {riskLabel}
                <HelpTip text="Estimated risk of this allow rule. High = broad scope, risky commands, or missing constraints. Add command and path constraints to lower risk." />
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", flex: 1 }}>
                {risk.reasons.length > 0 ? risk.reasons[0] : "Standard scoped rule."}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ 
          flexShrink: 0, 
          display: "flex", 
          gap: "12px", 
          justifyContent: "space-between", 
          alignItems: "center",
          padding: "16px 20px", 
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-panel)" 
        }}>
          <span class="text-secondary text-xs" style={{ opacity: 0.8 }} title="Keyboard shortcuts">
            Esc to close · Enter to continue
          </span>
          <div style={{ display: "flex", gap: "12px" }}>
          <button class="btn-ghost" onClick={close} title="Close without saving">Cancel</button>
          {wizardStep > 1 && (
            <button class="btn-secondary" onClick={backStep} type="button" title="Go back to previous step">Back</button>
          )}
          {wizardStep < 3 ? (
            <button class="btn-primary" onClick={nextStep} type="button" title="Continue to next step">
              Next
            </button>
          ) : (
            <button
              class="btn-primary"
              onClick={submit}
              disabled={!canCreateBase || saving}
              title={isEditMode ? "Save changes to this exception rule" : "Create the policy and save to registry"}
            >
              {saving ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save Exception" : "Create Rule")}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
