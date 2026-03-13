#!/usr/bin/env node
/**
 * Clasper CLI
 * 
 * Security: Enforces TLS 1.3 minimum for all HTTPS connections.
 * @see OpenClaw PR: "require TLS 1.3 as minimum"
 */
import { Command } from "commander";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetupWizard, type SetupProfile } from "./cli/setup-wizard.js";

// Enforce TLS 1.3 minimum before any network operations
const require = createRequire(import.meta.url);
const tls = require("node:tls") as { DEFAULT_MIN_VERSION: string };
tls.DEFAULT_MIN_VERSION = "TLSv1.3";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(__dirname, "..");
const templateDir = join(packageRoot, "templates", "workspace");
const policyTemplateDir = join(packageRoot, "templates", "policies");

type SetupCommandOptions = {
  profile?: SetupProfile;
  nonInteractive?: boolean;
  port?: string;
  adapterSecret?: string;
  approvalMode?: "allow" | "block";
  skipOpenclaw?: boolean;
  upgradeOpenclawPlugin?: boolean;
  link?: boolean;
};

type DashboardCommandOptions = {
  port?: string;
};

function spawnInPackageRoot(command: string, args: string[]): void {
  spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function copyWorkspaceTemplate(targetDir: string, force: boolean): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  function copyRecursive(src: string, dest: string): void {
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        if (existsSync(destPath) && !force) {
          skipped.push(destPath);
          continue;
        }
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(srcPath, destPath);
        created.push(destPath);
      }
    }
  }

  if (!existsSync(templateDir)) {
    console.error("Template not found. Run from package root or use: npm run init-workspace");
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
  copyRecursive(templateDir, targetDir);
  return { created, skipped };
}

function copyPolicyPackTemplate(packName: string, targetDir: string): { created: string[] } {
  const sourceDir = join(policyTemplateDir, packName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Unknown policy pack: ${packName}`);
  }
  if (existsSync(targetDir)) {
    throw new Error(`Target already exists: ${targetDir}`);
  }
  const created: string[] = [];
  const copyRecursive = (src: string, dst: string): void => {
    mkdirSync(dst, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const dstPath = join(dst, entry.name);
      if (entry.isDirectory()) copyRecursive(srcPath, dstPath);
      else {
        copyFileSync(srcPath, dstPath);
        created.push(dstPath);
      }
    }
  };
  copyRecursive(sourceDir, targetDir);
  return { created };
}

async function resolveAdapterToken(baseUrl: string, opsApiKey?: string, adapterToken?: string): Promise<string> {
  if (adapterToken) return adapterToken;
  if (!opsApiKey) {
    throw new Error("Provide --adapter-token or --ops-api-key (used to mint a short-lived probe adapter token).");
  }
  const res = await fetch(`${baseUrl}/ops/api/adapter-probe-token`, {
    headers: { "X-Ops-Api-Key": opsApiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to mint adapter probe token: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No token returned from /ops/api/adapter-probe-token");
  return data.token;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  if (length <= 1) return value.slice(0, length);
  return `${value.slice(0, length - 1)}…`;
}

function colorize(text: string, color: "red" | "green" | "yellow" | "cyan" | "dim"): string {
  if (!process.stdout.isTTY) return text;
  const code =
    color === "red" ? "31" :
    color === "green" ? "32" :
    color === "yellow" ? "33" :
    color === "cyan" ? "36" :
    "2";
  return `\u001b[${code}m${text}\u001b[0m`;
}

function formatDecisionResult(raw: string | undefined): string {
  const value = String(raw || "—").toUpperCase();
  if (value === "ALLOW") return colorize(value, "green");
  if (value === "DENY") return colorize(value, "red");
  if (value === "PENDING") return colorize(value, "yellow");
  if (value === "REQUIRE_APPROVAL") return colorize(value, "cyan");
  return value;
}

const program = new Command();

program.name("clasper-core").description("Clasper Core daemon utilities").version("0.1.0");

program
  .command("init [dir]")
  .description("Create a workspace from the built-in template (default: ./workspace)")
  .option("-f, --force", "Overwrite existing files")
  .action((dir, opts) => {
    const targetDir = join(process.cwd(), dir || process.env.CLASPER_WORKSPACE || "workspace");
    const force = opts.force === true;
    console.log(`Initializing workspace at: ${targetDir}`);
    if (force) console.log("(--force: overwriting existing files)");
    const { created, skipped } = copyWorkspaceTemplate(targetDir, force);
    if (created.length) {
      console.log("Created:");
      created.forEach((p) => console.log("  ", p));
    }
    if (skipped.length) {
      console.log("Skipped (already exist; use --force to overwrite):");
      skipped.forEach((p) => console.log("  ", p));
    }
    console.log("\nNext: configure .env (BACKEND_URL, AGENT_JWT_SECRET, LLM keys) and run npm run dev");
  });

program
  .command("serve")
  .description("Start the agent daemon HTTP server")
  .action(() => {
    spawnInPackageRoot("node", [join(packageRoot, "dist", "server", "index.js")]);
  });

program
  .command("dispatcher")
  .description("Run the notification dispatcher loop")
  .action(() => {
    spawnInPackageRoot("node", [join(packageRoot, "dist", "scripts", "notification_dispatcher.js")]);
  });

program
  .command("heartbeat")
  .description("Run a heartbeat (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawnInPackageRoot("node", [join(packageRoot, "dist", "scripts", "heartbeat.js")]);
  });

program
  .command("standup")
  .description("Run a daily standup (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawnInPackageRoot("node", [join(packageRoot, "dist", "scripts", "daily_standup.js")]);
  });

program
  .command("setup")
  .description("Interactive setup wizard with install profiles")
  .option("--profile <profile>", "Install profile: core|openclaw")
  .option("--non-interactive", "Run wizard without prompts")
  .option("--port <port>", "Set CLASPER_PORT")
  .option("--adapter-secret <secret>", "Set ADAPTER_JWT_SECRET")
  .option("--approval-mode <mode>", "Set CLASPER_REQUIRE_APPROVAL_IN_CORE: allow|block")
  .option("--skip-openclaw", "Skip OpenClaw integration even when profile=openclaw")
  .option("--upgrade-openclaw-plugin", "Upgrade/sync the OpenClaw plugin install and config")
  .option("--link", "Run npm link without prompting")
  .action(async (opts: SetupCommandOptions) => {
    await runSetupWizard(packageRoot, copyWorkspaceTemplate, opts);
  });

program
  .command("dev")
  .description("Start Clasper Core development server from any directory")
  .action(() => {
    spawnInPackageRoot("npm", ["run", "dev"]);
  });

program
  .command("seed <target>")
  .description("Run seed scripts from any directory (targets: openclaw, ops)")
  .action((target: string) => {
    if (target === "openclaw") {
      spawnInPackageRoot("npm", ["run", "seed:openclaw-policies"]);
      return;
    }
    if (target === "ops") {
      spawnInPackageRoot("npm", ["run", "seed:ops"]);
      return;
    }
    console.error(`Unknown seed target: ${target}. Use "openclaw" or "ops".`);
    process.exit(1);
  });

program
  .command("policy <action> [pack]")
  .description("Policy utilities (install starter packs)")
  .option("--out <dir>", "Output base directory for installed packs", "policies")
  .action((action, pack, opts: { out?: string }) => {
    if (action !== "install") {
      console.error(`Unknown policy action: ${action}. Use "install".`);
      process.exit(1);
    }
    const packName = pack || "safe-defaults";
    const baseOut = opts.out || "policies";
    const targetDir = join(process.cwd(), baseOut, packName);
    try {
      const { created } = copyPolicyPackTemplate(packName, targetDir);
      console.log(`Policy pack installed to ${targetDir}`);
      console.log(`Created ${created.length} file(s).`);
      console.log("Review and apply with your preferred policy workflow (no automatic activation was performed).");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Policy install failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show local health and key configuration values")
  .action(async () => {
    const envPath = join(packageRoot, ".env");
    const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const envMap = new Map<string, string>();
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      envMap.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1));
    }

    const port = envMap.get("CLASPER_PORT") || "8081";
    const approvalMode = envMap.get("CLASPER_REQUIRE_APPROVAL_IN_CORE") || "allow";
    const adapterSecret = envMap.get("ADAPTER_JWT_SECRET") || "";
    const maskedSecret =
      adapterSecret.length > 8
        ? `${adapterSecret.slice(0, 4)}...${adapterSecret.slice(-4)}`
        : adapterSecret || "(not set)";

    let healthy = false;
    let statusText = "";
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      healthy = response.ok;
      statusText = healthy ? "reachable" : `unhealthy (${response.status})`;
    } catch {
      statusText = "unreachable";
    }

    const openclawConfigPath = join(process.env.HOME || "", ".openclaw", "openclaw.json");
    let openclawConfigured = false;
    if (existsSync(openclawConfigPath)) {
      try {
        const raw = readFileSync(openclawConfigPath, "utf8");
        const parsed = JSON.parse(raw) as {
          plugins?: { entries?: Record<string, unknown> };
        };
        openclawConfigured = Boolean(parsed.plugins?.entries?.["clasper-openclaw"]);
      } catch {
        openclawConfigured = false;
      }
    }

    console.log(`Clasper Core health: ${statusText}`);
    console.log(`CLASPER_PORT=${port}`);
    console.log(`CLASPER_REQUIRE_APPROVAL_IN_CORE=${approvalMode}`);
    console.log(`ADAPTER_JWT_SECRET=${maskedSecret}`);
    console.log(`OpenClaw plugin configured: ${openclawConfigured ? "yes" : "no"}`);
  });

program
  .command("link")
  .description("Run npm link for global clasper-core command")
  .action(() => {
    spawnInPackageRoot("npm", ["link"]);
  });

program
  .command("dashboard")
  .description("Open the local Ops Console in your browser")
  .option("--port <port>", "Override CLASPER_PORT from .env")
  .action((opts: DashboardCommandOptions) => {
    const envPath = join(packageRoot, ".env");
    const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    let port = opts.port || "8081";
    if (!opts.port) {
      for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (key === "CLASPER_PORT" && value) {
          port = value;
          break;
        }
      }
    }

    const url = `http://localhost:${port}/`;
    let command: string;
    let args: string[];
    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    try {
      const child = spawn(command, args, {
        stdio: "ignore",
        detached: true,
        shell: process.platform === "win32",
      });
      child.unref();
      console.log(`Opening Ops Console: ${url}`);
    } catch {
      console.log(`Could not open browser automatically. Open this URL manually: ${url}`);
    }
  });

program
  .command("trace")
  .description("Trace operations (list, replay, simulate)")
  .argument("[action]", "list | replay | simulate — replay = decision replay (context for policy simulation)", "list")
  .argument("[id]", "Trace ID (for replay/simulate)")
  .option("--base-url <url>", "Ops API base URL", "http://localhost:8081")
  .option("--ops-api-key <key>", "Ops API key (X-Ops-Api-Key)")
  .option("--tenant-id <id>", "Tenant ID", "local")
  .action(async (action, id, opts) => {
    const envPath = join(packageRoot, ".env");
    let baseUrl = opts.baseUrl || "http://localhost:8081";
    if (!opts.baseUrl && existsSync(envPath)) {
      const envText = readFileSync(envPath, "utf8");
      for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/CLASPER_PORT=(.+)/);
        if (m) {
          baseUrl = `http://localhost:${m[1].trim()}`;
          break;
        }
      }
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.opsApiKey) headers["X-Ops-Api-Key"] = opts.opsApiKey;

    if (action === "list") {
      const res = await fetch(`${baseUrl}/ops/api/traces?tenant_id=${opts.tenantId || "local"}&limit=20`, { headers });
      if (!res.ok) {
        console.error(`Failed to list traces: ${res.status}`);
        process.exit(1);
      }
      const data = (await res.json()) as { traces?: { id: string; started_at?: string; status?: string; governance?: { decision?: string } }[] };
      const traces = data.traces || [];
      console.log(`Traces (${traces.length}):`);
      traces.forEach((t) => {
        console.log(`  ${t.id?.slice(0, 8)}…  ${t.started_at || "—"}  ${t.status || "—"}  ${t.governance?.decision || "—"}`);
      });
      return;
    }

    if (action === "replay" || action === "simulate") {
      if (!id) {
        console.error("Trace ID required for replay/simulate. Usage: clasper trace simulate <trace_id>");
        process.exit(1);
      }
      if (action === "simulate") {
        const res = await fetch(`${baseUrl}/ops/api/traces/${id}/simulate?tenant_id=${opts.tenantId || "local"}`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error(`Simulate failed: ${res.status} ${err}`);
          process.exit(1);
        }
        const data = (await res.json()) as { original?: { decision?: string }; simulated?: { decision?: string } };
        console.log("Original:", data.original?.decision ?? "—");
        console.log("Simulated (current policies):", data.simulated?.decision ?? "—");
        if (data.original?.decision !== data.simulated?.decision) {
          console.log("→ Decision would change");
        }
        return;
      }
      // replay: call existing replay API
      const res = await fetch(`${baseUrl}/traces/${id}/replay`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.error(`Replay failed: ${res.status}`);
        process.exit(1);
      }
      const data = (await res.json()) as { status?: string; message?: string };
      console.log(data.message || data.status || "Replay complete");
    }
  });

program
  .command("decisions")
  .description("Decision inspection (latest, tail, show)")
  .argument("[action]", "latest | tail | show", "latest")
  .argument("[id]", "Decision ID (for show)")
  .option("--base-url <url>", "Core API base URL", "http://localhost:8081")
  .option("--ops-api-key <key>", "Ops API key (used to mint adapter probe token)")
  .option("--adapter-token <token>", "Adapter token for adapter-facing APIs")
  .option("--tool <name>", "Filter by tool name")
  .option("--decision <value>", "Filter by decision effect (allow|deny|require_approval|pending)")
  .option("--since <value>", "Filter since duration/ISO (e.g. 10m, 1h, 2026-03-12T18:00:00Z)")
  .option("--limit <n>", "Result limit", "20")
  .option("--interval-ms <n>", "Tail poll interval in ms", "2000")
  .action(async (action, id, opts) => {
    try {
      const baseUrl = opts.baseUrl || "http://localhost:8081";
      const token = await resolveAdapterToken(baseUrl, opts.opsApiKey, opts.adapterToken);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Adapter-Token": token,
      };

      const renderHeader = () => {
        console.log(colorize("TIME       TOOL             POLICY                     RESULT", "dim"));
      };
      const renderRows = (rows: Array<{ timestamp?: string; tool?: string | null; policy?: string | null; decision?: string }>) => {
        for (const row of rows) {
          const time = (row.timestamp || "—").slice(11, 19).padEnd(8, " ");
          const tool = truncate(row.tool || "—", 16).padEnd(16, " ");
          const policy = truncate(row.policy || "—", 26).padEnd(26, " ");
          const result = formatDecisionResult(row.decision);
          console.log(`${time}   ${tool} ${policy} ${result}`);
        }
      };

      if (action === "latest") {
        const params = new URLSearchParams();
        params.set("limit", String(Math.max(1, Number(opts.limit || 20))));
        if (opts.tool) params.set("tool", opts.tool);
        if (opts.decision) params.set("decision", opts.decision);
        if (opts.since) params.set("since", opts.since);
        const res = await fetch(`${baseUrl}/api/adapter/decisions?${params.toString()}`, { headers });
        if (!res.ok) {
          const text = await res.text();
          console.error(`Failed to list decisions: ${res.status} ${text}`);
          process.exit(1);
        }
        const data = (await res.json()) as { decisions?: Array<{ timestamp?: string; tool?: string | null; policy?: string | null; decision?: string }> };
        const rows = data.decisions || [];
        if (rows.length === 0) {
          console.log("No decisions found for current filters.");
          return;
        }
        renderHeader();
        renderRows(rows);
        return;
      }

      if (action === "tail") {
        let since: string | undefined = opts.since;
        const seen = new Set<string>();
        const limit = Math.max(1, Number(opts.limit || 20));
        const intervalMs = Math.max(500, Number(opts.intervalMs || 2000));
        renderHeader();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const params = new URLSearchParams();
          params.set("limit", String(limit));
          if (opts.tool) params.set("tool", opts.tool);
          if (opts.decision) params.set("decision", opts.decision);
          if (since) params.set("since", since);
          const res = await fetch(`${baseUrl}/api/adapter/decisions?${params.toString()}`, { headers });
          if (!res.ok) {
            const text = await res.text();
            console.error(`Tail failed: ${res.status} ${text}`);
            process.exit(1);
          }
          const data = (await res.json()) as { decisions?: Array<{ decision_id?: string; timestamp?: string; tool?: string | null; policy?: string | null; decision?: string }> };
          const rows = (data.decisions || []).slice().reverse();
          const newRows: Array<{ timestamp?: string; tool?: string | null; policy?: string | null; decision?: string }> = [];
          for (const row of rows) {
            if (!row.decision_id || seen.has(row.decision_id)) continue;
            seen.add(row.decision_id);
            newRows.push(row);
          }
          if (newRows.length > 0) {
            renderRows(newRows);
            const newest = rows[rows.length - 1]?.timestamp;
            if (newest) since = newest;
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }

      if (action === "show") {
        if (!id) {
          console.error("Decision ID required. Usage: clasper-core decisions show <decision_id>");
          process.exit(1);
        }
        const [decisionRes, explainRes] = await Promise.all([
          fetch(`${baseUrl}/api/adapter/decisions/${id}`, { headers }),
          fetch(`${baseUrl}/api/adapter/decisions/${id}/explain`, { headers }),
        ]);
        if (!decisionRes.ok) {
          const text = await decisionRes.text();
          console.error(`Decision lookup failed: ${decisionRes.status} ${text}`);
          process.exit(1);
        }
        if (!explainRes.ok) {
          const text = await explainRes.text();
          console.error(`Decision explain failed: ${explainRes.status} ${text}`);
          process.exit(1);
        }
        const detail = (await decisionRes.json()) as { decision?: { decision_id?: string; decision?: string; policy?: string | null; status?: string; timestamp?: string; trace_id?: string | null } };
        const explain = (await explainRes.json()) as { reason?: string; tool?: string | null; input_summary?: Record<string, unknown> };
        const d = detail.decision || {};
        console.log(`Decision ID: ${d.decision_id || id}`);
        console.log(`Time: ${d.timestamp || "—"}`);
        console.log(`Decision: ${formatDecisionResult(d.decision)}`);
        console.log(`Policy: ${d.policy || "—"}`);
        console.log(`Governance Status: ${String(d.status || "—").toUpperCase()}`);
        console.log(`Trace ID: ${d.trace_id || "—"}`);
        console.log(`Tool: ${explain.tool || "—"}`);
        console.log(`Reason: ${explain.reason || "No explanation available."}`);
        if (explain.input_summary && Object.keys(explain.input_summary).length > 0) {
          console.log(`Input summary: ${JSON.stringify(explain.input_summary)}`);
        }
        return;
      }

      console.error(`Unknown action: ${action}. Use latest, tail, or show.`);
      console.error("Examples:");
      console.error("  clasper-core decisions latest --ops-api-key <key>");
      console.error("  clasper-core decisions latest --tool http.request --decision deny --since 1h --ops-api-key <key>");
      console.error("  clasper-core decisions show <decision_id> --ops-api-key <key>");
      process.exit(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Decisions command failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command("policies")
  .description("Policy inspection utilities")
  .argument("[action]", "list", "list")
  .option("--base-url <url>", "Core API base URL", "http://localhost:8081")
  .option("--ops-api-key <key>", "Ops API key (used to mint adapter probe token)")
  .option("--adapter-token <token>", "Adapter token for adapter-facing APIs")
  .option("--limit <n>", "Result limit", "50")
  .option("--offset <n>", "Result offset", "0")
  .action(async (action, opts) => {
    if (action !== "list") {
      console.error(`Unknown action: ${action}. Use list.`);
      process.exit(1);
    }
    const baseUrl = opts.baseUrl || "http://localhost:8081";
    const token = await resolveAdapterToken(baseUrl, opts.opsApiKey, opts.adapterToken);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Adapter-Token": token,
    };
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(1, Number(opts.limit || 50))));
    params.set("offset", String(Math.max(0, Number(opts.offset || 0))));
    const res = await fetch(`${baseUrl}/api/adapter/policies?${params.toString()}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Policy list failed: ${res.status} ${text}`);
      process.exit(1);
    }
    const data = (await res.json()) as { policies?: Array<{ policy_id?: string; decision?: string; precedence?: number; tool?: string | null }> };
    const rows = data.policies || [];
    console.log("POLICY                      DECISION            PREC  TOOL");
    for (const row of rows) {
      const policy = truncate(row.policy_id || "—", 26).padEnd(26, " ");
      const decision = truncate(String(row.decision || "—"), 18).padEnd(18, " ");
      const prec = String(row.precedence ?? 0).padStart(4, " ");
      const tool = truncate(row.tool || "*", 20);
      console.log(`${policy} ${decision} ${prec}  ${tool}`);
    }
  });

program
  .command("export")
  .description("Create a self-attested export bundle (Ops API)")
  .option("--base-url <url>", "Ops API base URL", "http://localhost:8081")
  .option("--ops-api-key <key>", "Ops API key (X-Ops-Api-Key)")
  .option("--tenant-id <id>", "Tenant ID")
  .option("--workspace-id <id>", "Workspace ID")
  .option("--trace-id <id>", "Trace ID")
  .option("--start-date <iso>", "Start date (ISO)")
  .option("--end-date <iso>", "End date (ISO)")
  .option("--out <path>", "Output bundle path", `./clasper-export-${Date.now()}.tar.gz`)
  .action(async (opts) => {
    const payload = {
      tenant_id: opts.tenantId,
      workspace_id: opts.workspaceId,
      trace_id: opts.traceId,
      start_date: opts.startDate,
      end_date: opts.endDate,
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.opsApiKey) {
      headers["X-Ops-Api-Key"] = opts.opsApiKey;
    }
    const response = await fetch(`${opts.baseUrl}/ops/api/exports`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`Export failed: ${response.status} ${text}`);
      process.exit(1);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(opts.out, buffer);
    console.log(`Export saved to ${opts.out}`);
  });

program
  .command("test [file]")
  .description("Run policy tests from a YAML file (requires server + Ops API key)")
  .option("--base-url <url>", "Ops API base URL", "http://localhost:8081")
  .option("--ops-api-key <key>", "Ops API key (X-Ops-Api-Key)")
  .option("--tenant-id <id>", "Tenant ID", "local")
  .action(async (file, opts) => {
    const testPath = file || "policy_tests.yaml";
    if (!existsSync(testPath)) {
      console.error(`Test file not found: ${testPath}`);
      console.error("Create a YAML file with format:");
      console.error("  tests:");
      console.error("    - name: \"deny rm\"");
      console.error("      event: { tenant_id: local, action: exec, context: { exec: { argv0: \"rm\" } } }");
      console.error("      expected: { decision: deny }");
      process.exit(1);
    }
    const envPath = join(packageRoot, ".env");
    let baseUrl = opts.baseUrl || "http://localhost:8081";
    if (!opts.baseUrl && existsSync(envPath)) {
      const envText = readFileSync(envPath, "utf8");
      for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/CLASPER_PORT=(.+)/);
        if (m) {
          baseUrl = `http://localhost:${m[1].trim()}`;
          break;
        }
      }
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.opsApiKey) headers["X-Ops-Api-Key"] = opts.opsApiKey;

    const raw = readFileSync(testPath, "utf8");
    const parsed = parseYaml(raw) as { tests?: Array<{ name?: string; event: Record<string, unknown>; expected: { decision?: string } }> };
    const tests = parsed?.tests ?? (Array.isArray(parsed) ? parsed : []);
    if (!Array.isArray(tests) || tests.length === 0) {
      console.error("No tests found. Expected format: tests: [{ name, event, expected: { decision } }]");
      process.exit(1);
    }

    let passed = 0;
    let failed = 0;
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const event = (typeof t === "object" && t?.event) ? t.event : (t as { event?: Record<string, unknown> }).event;
      const expected = (typeof t === "object" && t?.expected) ? t.expected : (t as { expected?: { decision?: string } }).expected;
      const name = (typeof t === "object" && t?.name) ? t.name : `test ${i + 1}`;
      if (!event || typeof event !== "object") {
        console.error(`[${name}] Missing event`);
        failed++;
        continue;
      }
      const payload = { ...event, tenant_id: (event.tenant_id as string) || opts.tenantId || "local" };
      try {
        const res = await fetch(`${baseUrl}/ops/api/policies/dry-run`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error(`[${name}] API error: ${res.status} ${await res.text()}`);
          failed++;
          continue;
        }
        const result = (await res.json()) as { decision?: string };
        const got = result.decision ?? "allow";
        const want = expected?.decision ?? "allow";
        if (got === want) {
          console.log(`✓ ${name}`);
          passed++;
        } else {
          console.error(`✗ ${name}: expected decision=${want}, got ${got}`);
          failed++;
        }
      } catch (err) {
        console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });

program.parse();
