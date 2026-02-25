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

program.parse();
