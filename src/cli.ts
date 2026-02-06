#!/usr/bin/env node
/**
 * Clasper CLI
 * 
 * Security: Enforces TLS 1.3 minimum for all HTTPS connections.
 * @see OpenClaw PR: "require TLS 1.3 as minimum"
 */
import { Command } from "commander";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { verifyExportBundle } from "./lib/exports/verifyBundle.js";

// Enforce TLS 1.3 minimum before any network operations
import * as tls from "node:tls";
(tls as { DEFAULT_MIN_VERSION: string }).DEFAULT_MIN_VERSION = "TLSv1.3";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(__dirname, "..");
const templateDir = join(packageRoot, "templates", "workspace");

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

program.name("clasper").description("Clasper agent daemon utilities").version("0.1.0");

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
    spawn("node", ["dist/server/index.js"], { stdio: "inherit" });
  });

program
  .command("dispatcher")
  .description("Run the notification dispatcher loop")
  .action(() => {
    spawn("node", ["dist/scripts/notification_dispatcher.js"], { stdio: "inherit" });
  });

program
  .command("heartbeat")
  .description("Run a heartbeat (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawn("node", ["dist/scripts/heartbeat.js"], { stdio: "inherit" });
  });

program
  .command("standup")
  .description("Run a daily standup (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawn("node", ["dist/scripts/daily_standup.js"], { stdio: "inherit" });
  });

program
  .command("export")
  .description("Create a verifiable export bundle (Ops API)")
  .option("--base-url <url>", "Ops API base URL", "http://localhost:8081")
  .option("--token <token>", "OIDC access token")
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
    if (opts.token) {
      headers.Authorization = `Bearer ${opts.token}`;
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
  .command("verify <bundle>")
  .description("Verify a Clasper export bundle offline")
  .action(async (bundle) => {
    const result = await verifyExportBundle(bundle);
    if (!result.ok) {
      console.error("Verification failed.");
      if (result.failures.length) console.error("Failures:", result.failures);
      if (result.fileFailures.length) console.error("File failures:", result.fileFailures);
      if (result.auditChainFailures.length) console.error("Audit chain failures:", result.auditChainFailures);
      process.exit(1);
    }
    console.log("Verification OK.");
    if (result.signatureVerified !== null) {
      console.log(`Signature verified: ${result.signatureVerified ? "yes" : "no"}`);
    }
  });

program
  .command("keys:generate")
  .description("Generate Ed25519 signing keys for export bundles")
  .option("--out <path>", "Output base path (no extension)", "./config/keys/clasper-export-key")
  .action((opts) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

    const privatePath = `${opts.out}.pem`;
    const publicPath = `${opts.out}.public.jwk.json`;

    mkdirSync(dirname(privatePath), { recursive: true });
    writeFileSync(privatePath, privatePem);
    writeFileSync(publicPath, JSON.stringify(publicJwk, null, 2));

    console.log(`Private key: ${privatePath}`);
    console.log(`Public key: ${publicPath}`);
  });

program.parse();
