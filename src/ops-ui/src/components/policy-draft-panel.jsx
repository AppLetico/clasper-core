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
  const context = trace?.request_snapshot?.request?.context || trace?.context || {};
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
  return {
    policy_id: policyId,
    scope: {
      tenant_id: trace.tenant_id || tenantId.value || "local",
      workspace_id: trace.workspace_id || undefined,
    },
    subject: { type: "tool", name: tool },
    conditions: {
      tool,
      tool_group: trace.tool_group ?? undefined,
    },
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
  }
  return { operator: "in", values: [] };
}

function normalizePathCondition(value) {
  if (value && typeof value === "object") {
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

function buildSeedFromPolicy(policy) {
  const conditions = policy?.conditions && typeof policy.conditions === "object" ? policy.conditions : {};
  const argv0 = normalizeArgv0Condition(conditions["context.exec.argv0"]);
  const paths = normalizePathCondition(conditions["context.targets.paths"]);
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
      quickDecision: selectedOutcome,
      scopeChoice:
        paths.values.length === 1 && paths.values[0] === "{{workspace.root}}" ? "workspace" : "custom",
      commandChoice:
        argv0.operator === "eq" && argv0.values.length === 1 ? "this_command" : argv0.values.length > 0 ? "custom_list" : "none",
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
  pathOperator,
  pathScopes,
}) {
  const details = [];
  if (decision !== "allow") {
    return { match: false, details: ["Preview is for allow rules only."] };
  }

  const argv0 = getArgv0FromContext(currentRequest.context);
  if (argv0Values.length > 0) {
    let argvMatch = false;
    if (argv0Operator === "eq") {
      argvMatch = argv0Values[0] === argv0;
    } else {
      argvMatch = argv0Values.includes(argv0);
    }
    details.push(`Command ${argvMatch ? "matches" : "does not match"} (${argv0 || "none"}).`);
    if (!argvMatch) return { match: false, details };
  } else {
    details.push("No command constraint configured.");
  }

  const paths = getTargetPathsFromContext(currentRequest.context);
  if (pathScopes.length > 0 && paths.length > 0) {
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
  const exceptionForPolicyId = (() => {
    if (isEditMode || !trace?.request_snapshot?.decision) return undefined;
    const matched = trace.request_snapshot.decision.matched_policies;
    const first = Array.isArray(matched) ? matched[0] : undefined;
    return typeof first === "string" ? first : undefined;
  })();
  const argv0Values = argv0Input
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const pathScopes = pathScopeInput
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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
    `Command match: ${
      argv0Values.length > 0
        ? argv0Operator === "eq"
          ? `exactly ${argv0Values[0]}`
          : `one of ${argv0Values.join(", ")}`
        : "none"
    }`,
    `Path scope: ${
      pathScopes.length > 0
        ? `${pathOperator} [${pathScopes.join(", ")}]`
        : "none"
    }`,
  ];
  const hasWorkspaceTemplateVar =
    typeof currentRequest?.templateVars?.["workspace.root"] === "string" &&
    currentRequest.templateVars["workspace.root"].trim() !== "";
  const resolvedWorkspaceRoot = resolveWorkspaceRoot(currentRequest);
  const effectivePathScopes = pathScopes.map((scope) =>
    hasWorkspaceTemplateVar ? scope : scope.replace(/\{\{\s*workspace\.root\s*\}\}/g, resolvedWorkspaceRoot)
  );
  const rawPolicyPreview = {
    policy_id: seed?.policy_id,
    scope: { ...seed?.scope },
    subject: { ...seed?.subject },
    conditions: {
      ...(seed?.conditions || {}),
      ...(argv0Values.length > 0
        ? {
            "context.exec.argv0":
              argv0Operator === "eq" ? argv0Values[0] : { in: argv0Values },
          }
        : {}),
      ...(pathScopes.length > 0
        ? {
            "context.targets.paths":
              pathOperator === "any_under" ? { any_under: effectivePathScopes } : { all_under: effectivePathScopes },
          }
        : {}),
    },
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
      pathOperator,
      pathScopes,
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
        conditions: {
          ...(seed.conditions || {}),
          ...(argv0Values.length > 0
            ? {
                "context.exec.argv0":
                  argv0Operator === "eq" ? argv0Values[0] : { in: argv0Values },
              }
            : {}),
          ...(pathScopes.length > 0
            ? {
                "context.targets.paths":
                  pathOperator === "any_under"
                    ? { any_under: effectivePathScopes }
                    : { all_under: effectivePathScopes },
              }
            : {}),
        },
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
            <h3 style={{ margin: 0, fontSize: "16px" }}>
              {isEditMode ? "Edit Exception for " : "New Rule for "}
              <span class="mono" style={{ color: "var(--accent-primary)" }}>{tool}</span>
            </h3>
            <button class="btn-icon" onClick={close}><XIcon /></button>
          </div>
          {isEditMode && (
            <div class="text-secondary text-xs" style={{ marginTop: "-6px" }}>
              Editing existing exception
            </div>
          )}
          
          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {[
              { id: 1, label: "Outcome" },
              { id: 2, label: "Scope" },
              { id: 3, label: "Review" }
            ].map((step, idx) => {
              const active = wizardStep === step.id;
              const completed = wizardStep > step.id;
              return (
                <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1, gap: "8px" }}>
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
                  <span style={{ 
                    fontSize: "12px", 
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--text-primary)" : "var(--text-secondary)"
                  }}>
                    {step.label}
                  </span>
                  {idx < 2 && <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)", marginLeft: "8px" }} />}
                </div>
              );
            })}
          </div>
        </div>

        <div class="modal-body" style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          
          {wizardStep === 1 && (
            <div class="form-group">
              <label style={{ fontSize: "14px", marginBottom: "12px", display: "block" }}>What should happen when this tool is used?</label>
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
                  title="This Workspace Only"
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
                  <label style={{ fontSize: "12px", display: "flex", alignItems: "center" }}>
                    <span>Path Scope (glob patterns)</span>
                    <HelpTip text="Comma-separated path roots. Use {{workspace.root}} for current workspace. Keep this as narrow as possible." />
                  </label>
                  <input
                    type="text"
                    placeholder="{{workspace.root}}/*"
                    value={pathScopeInput}
                    onInput={(e) => setPathScopeInput(e.target.value)}
                    style={{ marginTop: "4px", width: "100%" }}
                  />
                </div>
              )}

              {quickDecision === "allow" && (
                <div style={{ marginTop: "20px" }}>
                  <label style={{ fontSize: "14px", marginBottom: "12px", display: "flex", alignItems: "center" }}>
                    <span>Command Matching</span>
                    <HelpTip text="Choose how strictly to match commands. Exact command is safer than allowing a broader list." />
                  </label>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <OptionCard
                      title={`Exact Command: ${detectedArgv0 || "unknown"}`}
                      description="Safest. Only allows this specific tool/binary."
                      icon={<div class="mono" style={{ fontSize: "10px" }}>&gt;_</div>}
                      selected={commandChoice === "this_command"}
                      onClick={() => applyCommandChoice("this_command")}
                      helpText="Only this one command will match."
                    />
                    <OptionCard
                      title="Custom Command List"
                      description="Allow a specific set of commands (e.g. ls, pwd)."
                      icon={<div class="mono" style={{ fontSize: "10px" }}>[...]</div>}
                      selected={commandChoice === "custom_list"}
                      onClick={() => applyCommandChoice("custom_list")}
                      helpText="Allow multiple command names. Broader than exact command."
                    />
                  </div>
                </div>
              )}

              {/* Inline Inputs for Custom Command List */}
              {commandChoice === "custom_list" && (
                <div style={{ marginTop: "16px", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px" }}>
                  {commandChoice === "custom_list" && quickDecision === "allow" && (
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
                        >
                          Add
                        </button>
                      </div>
                      <div class="text-secondary text-xs" style={{ marginTop: "6px" }}>
                        Commands from this trace are preloaded as chips. Remove any you do not want.
                      </div>
                    </div>
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
                        style={{ 
                          padding: "4px 8px", 
                          borderRadius: "4px", 
                          border: "1px solid var(--border-subtle)",
                          fontSize: "12px",
                          background: "var(--bg-canvas)",
                          minWidth: "100px"
                        }}
                      >
                        <option value="low">Low (10)</option>
                        <option value="normal">Normal (20)</option>
                        <option value="high">High (30)</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <div class="text-secondary text-xs" style={{ marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Summary</div>
                    <div style={{ lineHeight: "1.5", fontSize: "13px" }}>{reviewSummary}</div>
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
                            {argv0Values.length > 0 ? (
                              argv0Values.map(cmd => (
                                <span key={cmd} style={{ 
                                  background: "var(--bg-canvas)", 
                                  border: "1px solid var(--border-subtle)", 
                                  borderRadius: "4px", 
                                  padding: "1px 5px" 
                                }} class="mono">
                                  {cmd}
                                </span>
                              ))
                            ) : (
                              <span class="text-secondary">Any command</span>
                            )}
                            {argv0Values.length > 0 && <span class="text-secondary" style={{ marginLeft: "4px" }}>({argv0Operator === "eq" ? "exact" : "list"})</span>}
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
                           {pathScopes.length > 0 ? (
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
                    <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "4px", color: validationError === "ack_required" ? "var(--accent-danger)" : "var(--text-primary)", cursor: "pointer" }}>
                      Confirm Allow Rule
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
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>Test Rule</span>
                  <button class="btn-secondary btn-sm" type="button" onClick={runPreview}>
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
              Show raw policy configuration
            </summary>
            <div class="detail-block" style={{ marginTop: "8px", padding: "12px", border: "1px dashed var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                <div class="text-secondary text-xs">
                  Live preview of the exact policy payload produced by the wizard.
                </div>
                <button type="button" class="btn-secondary btn-sm" onClick={copyRawPolicyJson}>
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
              <div style={{ fontSize: "12px", fontWeight: "bold", color: riskTone }}>
                Risk: {riskLabel}
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
          justifyContent: "flex-end", 
          padding: "16px 20px", 
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-panel)" 
        }}>
          <button class="btn-ghost" onClick={close}>Cancel</button>
          {wizardStep > 1 && (
            <button class="btn-secondary" onClick={backStep} type="button">Back</button>
          )}
          {wizardStep < 3 ? (
            <button class="btn-primary" onClick={nextStep} type="button">
              Next
            </button>
          ) : (
            <button
              class="btn-primary"
              onClick={submit}
              disabled={!canCreateBase || saving}
            >
              {saving ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save Exception" : "Create Rule")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
