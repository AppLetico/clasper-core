/**
 * Seed OpenClaw default policies into Clasper Core.
 *
 * Usage:
 *   npx tsx scripts/seed-openclaw-policies.ts
 *   # or via Makefile:
 *   make seed-openclaw-policies
 *
 * Requires:
 *   - Clasper Core running (default: http://localhost:8081)
 *   - OPS_LOCAL_API_KEY set (or no auth if disabled)
 *
 * This script reads integrations/openclaw/policies/openclaw-default.yaml
 * and POSTs each policy to POST /ops/api/policies.
 *
 * IMPORTANT: This is a MANUAL step. The Clasper plugin does NOT auto-seed
 * policies on startup. Plugins must not mutate governance state automatically.
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const baseUrl =
  process.env.CLASPER_BASE_URL ||
  `http://localhost:${process.env.CLASPER_PORT || 8081}`;
const opsApiKey = process.env.OPS_LOCAL_API_KEY || "";

const POLICY_FILE = join(
  __dirname,
  "..",
  "integrations",
  "openclaw",
  "policies",
  "openclaw-default.yaml"
);

interface PolicyDef {
  policy_id: string;
  subject: { type: string; name?: string };
  conditions?: Record<string, unknown>;
  effect: { decision: string };
  explanation?: string;
  precedence?: number;
  enabled?: boolean;
}

async function main() {
  console.log(`\n  Clasper × OpenClaw Policy Seeder`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Core URL : ${baseUrl}`);
  console.log(`  Policy   : ${POLICY_FILE}\n`);

  // Read and parse YAML
  const raw = readFileSync(POLICY_FILE, "utf-8");
  const policies: PolicyDef[] = parseYaml(raw);

  if (!Array.isArray(policies) || policies.length === 0) {
    console.error("  ERROR: No policies found in YAML file.");
    process.exit(1);
  }

  console.log(`  Found ${policies.length} policies to seed.\n`);

  let success = 0;
  let failed = 0;

  for (const policy of policies) {
    const policyId = policy.policy_id;
    try {
      const res = await fetch(`${baseUrl}/ops/api/policies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opsApiKey ? { "X-Ops-Api-Key": opsApiKey } : {}),
        },
        body: JSON.stringify(policy),
      });

      if (res.ok) {
        console.log(`  ✓ ${policyId} → ${policy.effect.decision}`);
        success++;
      } else {
        const text = await res.text().catch(() => "");
        console.error(`  ✗ ${policyId} (${res.status}): ${text}`);
        failed++;
      }
    } catch (err) {
      console.error(
        `  ✗ ${policyId}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  console.log(`\n  Done: ${success} seeded, ${failed} failed.\n`);

  if (failed > 0) {
    console.log("  Make sure Clasper Core is running and OPS_LOCAL_API_KEY is set.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
