import dotenv from "dotenv";

dotenv.config();

/**
 * LLM Provider configuration type.
 */
export interface LLMProviderConfig {
  provider: string;
  modelDefault: string;
  modelCheap: string;
  modelBest: string;
  modelFallback: string;
}

export const config = {
  port: Number(process.env.CLASPER_PORT || 8081),
  backendUrl: process.env.BACKEND_URL || "http://localhost:8000",
  daemonKey: process.env.AGENT_DAEMON_API_KEY || "",
  agentJwtSecret: process.env.AGENT_JWT_SECRET || "",
  agentJwtAlgorithm: process.env.AGENT_JWT_ALGORITHM || "HS256",
  adapterJwtSecret: process.env.ADAPTER_JWT_SECRET || "",
  adapterJwtAlgorithm: process.env.ADAPTER_JWT_ALGORITHM || "HS256",
  policyPath: process.env.CLASPER_POLICY_PATH || "./config/policies.yaml",
  // Local single-tenant scope
  localTenantId: process.env.CLASPER_LOCAL_TENANT_ID || "local",
  localWorkspaceId: process.env.CLASPER_LOCAL_WORKSPACE_ID || "local",
  // Local Ops auth (single-tenant)
  opsLocalApiKey: process.env.OPS_LOCAL_API_KEY || "",

  // ===== Multi-Provider LLM Configuration =====
  // Default LLM provider (openai, anthropic, google, xai, groq, mistral, openrouter)
  llmProvider: process.env.LLM_PROVIDER || "openai",

  // Model configuration (format: "model-id" or "provider/model-id")
  // If provider prefix is omitted, uses LLM_PROVIDER as default
  llmModelDefault: process.env.LLM_MODEL_DEFAULT || process.env.OPENAI_MODEL_DEFAULT || "gpt-4o-mini",
  llmModelCheap: process.env.LLM_MODEL_CHEAP || process.env.OPENAI_MODEL_CHEAP || "",
  llmModelBest: process.env.LLM_MODEL_BEST || process.env.OPENAI_MODEL_BEST || "",
  llmModelFallback: process.env.LLM_MODEL_FALLBACK || process.env.OPENAI_MODEL_FALLBACK || "",

  // Provider API Keys
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  xaiApiKey: process.env.XAI_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  mistralApiKey: process.env.MISTRAL_API_KEY || "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY || "",

  // Legacy OpenAI-specific config (deprecated, use LLM_* instead)
  /** @deprecated Use LLM_MODEL_DEFAULT instead */
  openaiModelDefault: process.env.OPENAI_MODEL_DEFAULT || "gpt-4o-mini",
  /** @deprecated Use LLM_MODEL_CHEAP instead */
  openaiModelCheap: process.env.OPENAI_MODEL_CHEAP || "",
  /** @deprecated Use LLM_MODEL_BEST instead */
  openaiModelBest: process.env.OPENAI_MODEL_BEST || "",
  /** @deprecated Use LLM_MODEL_FALLBACK instead */
  openaiModelFallback: process.env.OPENAI_MODEL_FALLBACK || "",

  // Workspace configuration (OpenClaw-inspired portable agent config)
  workspacePath: process.env.CLASPER_WORKSPACE || "./workspace",
  // Default task title for auto-creation (empty = require task_id in request)
  defaultTaskTitle: process.env.CLASPER_DEFAULT_TASK || "",

  // Retry configuration (OpenClaw-inspired pattern)
  retryAttempts: parseInt(process.env.CLASPER_RETRY_ATTEMPTS || "3", 10),
  retryDelayMs: parseInt(process.env.CLASPER_RETRY_DELAY_MS || "1000", 10),
  retryMaxDelayMs: parseInt(process.env.CLASPER_RETRY_MAX_DELAY_MS || "30000", 10),
  retryJitter: parseFloat(process.env.CLASPER_RETRY_JITTER || "0.1"), // 10% jitter

  // Context management (OpenClaw-inspired)
  // Warn when context usage exceeds this percentage of the model's context window
  contextWarningThreshold: parseFloat(process.env.CLASPER_CONTEXT_WARNING_THRESHOLD || "75"),

  // Smart context selection (query-aware skills + memory)
  smartContextEnabled: process.env.CLASPER_SMART_CONTEXT === "true",
  smartContextMaxSkills: parseInt(process.env.CLASPER_SMART_CONTEXT_MAX_SKILLS || "5", 10),
  smartContextMaxMemoryChunks: parseInt(process.env.CLASPER_SMART_CONTEXT_MAX_MEMORY || "3", 10),
  smartContextMaxTokens: parseInt(process.env.CLASPER_SMART_CONTEXT_MAX_TOKENS || "0", 10),
  embeddingProvider: process.env.CLASPER_EMBEDDING_PROVIDER || "none",
  embeddingModel: process.env.CLASPER_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",

  // Time context (OpenClaw-inspired)
  // Default timezone for time context injection (empty = use system timezone)
  defaultTimezone: process.env.CLASPER_DEFAULT_TIMEZONE || "",
  // Include time context in system prompt (true by default)
  includeTimeContext: process.env.CLASPER_INCLUDE_TIME_CONTEXT !== "false",

  // Deep link templates for trace detail (Ops Console)
  // Use {id} as placeholder for the entity ID
  // Example: "https://app.example.com/tasks/{id}"
  deepLinkTaskTemplate: process.env.DEEP_LINK_TASK_TEMPLATE || "",
  deepLinkDocTemplate: process.env.DEEP_LINK_DOC_TEMPLATE || "",
  deepLinkMsgTemplate: process.env.DEEP_LINK_MSG_TEMPLATE || "",

  // Enable policy condition operators (in, prefix, all_under, etc).
  policyOperatorsEnabled: process.env.CLASPER_POLICY_OPERATORS === "true",

  // Approval behavior in Core (OSS).
  //
  // OSS can enforce approvals locally (self-attested) via the Ops Console. For rapid iteration, it's also
  // useful to *simulate* approvals by auto-allowing require_approval while emitting loud audit signals.
  //
  // Recommended env var: CLASPER_APPROVAL_MODE
  //   - simulate (default): require_approval is auto-allowed + audited as AUTO-APPROVED (DEV OVERRIDE)
  //   - enforce: require_approval blocks until an operator approves/denies in the Ops Console
  //
  // Back-compat env var: CLASPER_REQUIRE_APPROVAL_IN_CORE
  //   - allow => simulate
  //   - block => enforce
  requireApprovalInCore:
    process.env.CLASPER_APPROVAL_MODE === "enforce"
      ? "block"
      : process.env.CLASPER_APPROVAL_MODE === "simulate"
        ? "allow"
        : process.env.CLASPER_REQUIRE_APPROVAL_IN_CORE === "block"
          ? "block"
          : "allow",
};

export type ApprovalMode = "simulate" | "enforce";

export function getApprovalMode(): ApprovalMode {
  return config.requireApprovalInCore === "block" ? "enforce" : "simulate";
}

export function requireEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
}

/**
 * Get LLM provider configuration.
 */
export function getLLMConfig(): LLMProviderConfig {
  return {
    provider: config.llmProvider,
    modelDefault: config.llmModelDefault,
    modelCheap: config.llmModelCheap,
    modelBest: config.llmModelBest,
    modelFallback: config.llmModelFallback
  };
}
