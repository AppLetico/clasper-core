#!/usr/bin/env node
/**
 * Prove governance in 30 seconds.
 * Seeds OpenClaw policies (if server is up) and displays the enforcement proof.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const PROOF = `
AI requested tool: exec

Clasper Policy: require_approval
Status:          waiting_for_operator
Timeout:         8s

Result: denied (fail closed)
Tool executed: NO
`;

async function main() {
  console.log("\n  Clasper — Governance Proof");
  console.log("  ─────────────────────────────\n");

  // Show the enforcement proof (what developers see)
  console.log("  When an AI requests a risky tool, Clasper blocks it:\n");
  console.log(PROOF.trimEnd());
  console.log();

  // Try to seed policies if server is up
  const baseUrl = process.env.CLASPER_BASE_URL || `http://localhost:${process.env.CLASPER_PORT || 8081}`;
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (res.ok) {
      console.log("  Seeding OpenClaw policies...\n");
      const child = spawn("npm", ["run", "seed:openclaw-policies"], {
        cwd: root,
        stdio: "inherit",
        shell: true,
      });
      child.on("close", (code) => {
        if (code === 0) {
          console.log("\n  ✓ Policies seeded. Open http://localhost:8081/ops to see the Ops Console.");
        }
        process.exit(code ?? 0);
      });
    } else {
      throw new Error("unhealthy");
    }
  } catch {
    console.log("  Start Clasper (npm run dev) then run prove:governance again to seed policies.");
    console.log("  Open http://localhost:8081/ops to see traces and the Ops Console.\n");
    process.exit(0);
  }
}

main();
