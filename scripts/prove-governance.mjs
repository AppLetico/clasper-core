#!/usr/bin/env node
/**
 * Governance verification: posture endpoint + deterministic synthetic-tool probe.
 * Reports machine-verifiable governance status.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const baseUrl = process.env.CLASPER_BASE_URL || `http://localhost:${process.env.CLASPER_PORT || 8081}`;
const opsKey = process.env.OPS_LOCAL_API_KEY || "";

async function main() {
  console.log("\n  Clasper — Governance Verification");
  console.log("  ─────────────────────────────────\n");

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    if (!healthRes.ok) throw new Error("Server unreachable");
  } catch {
    console.log("  Server unreachable. Start Clasper (npm run dev) then run prove:governance again.");
    console.log("  Open http://localhost:8081/ops to see the Ops Console.\n");
    process.exit(1);
  }

  // Seed policies
  console.log("  Seeding OpenClaw policies...\n");
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "seed:openclaw-policies"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });

  if (!opsKey) {
    console.log("  OPS_LOCAL_API_KEY not set. Skipping posture/probe verification.");
    console.log("  Set OPS_LOCAL_API_KEY to run full verification.\n");
    process.exit(0);
  }

  // Get probe token
  let token;
  try {
    const tokenRes = await fetch(`${baseUrl}/ops/api/adapter-probe-token`, {
      headers: { "X-Ops-Api-Key": opsKey },
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`adapter-probe-token failed: ${err}`);
    }
    const { token: t } = await tokenRes.json();
    token = t;
  } catch (e) {
    console.log("  Could not obtain probe token:", e.message);
    console.log("  Ensure ADAPTER_JWT_SECRET is set.\n");
    process.exit(1);
  }

  const adapterHeaders = { "X-Adapter-Token": token };

  // Fetch posture
  let posture;
  try {
    const postureRes = await fetch(`${baseUrl}/api/adapter/posture`, { headers: adapterHeaders });
    if (!postureRes.ok) throw new Error(`posture ${postureRes.status}`);
    posture = await postureRes.json();
  } catch (e) {
    console.log("  Posture request failed:", e.message);
    process.exit(1);
  }

  // Run synthetic probe
  let probeResult;
  try {
    const probeRes = await fetch(`${baseUrl}/api/execution/request`, {
      method: "POST",
      headers: { ...adapterHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: "local",
        workspace_id: "local",
        adapter_id: "openclaw-local",
        requested_capabilities: ["__clasper_probe__"],
        tool: "__clasper_probe__",
        tool_group: "diagnostics",
        tool_count: 1,
        context: {},
      }),
    });
    if (!probeRes.ok) throw new Error(`probe ${probeRes.status}`);
    probeResult = await probeRes.json();
  } catch (e) {
    console.log("  Probe request failed:", e.message);
    process.exit(1);
  }

  // Report
  console.log("  Posture:");
  console.log(`    adapter:       ${posture.adapter ?? "openclaw-local"}`);
  console.log(`    mode:          ${posture.mode}`);
  console.log(`    status:        ${posture.status}`);
  console.log(`    engine_version: ${posture.engine_version}`);
  console.log(`    fallback:      ${posture.fallback_present ? "present" : "missing"} (enabled: ${posture.fallback_enabled})`);
  console.log(`    policy_count:  ${posture.policy_count}`);
  console.log();
  console.log("  Synthetic probe (tool=__clasper_probe__):");
  console.log(`    decision:      ${probeResult.decision ?? "allow"}`);
  console.log(`    allowed:       ${probeResult.allowed}`);
  console.log();
  console.log("  ✓ Governance verification complete.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
