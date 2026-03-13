/**
 * Print OpenClaw tool-policy matrix including fallback behavior.
 *
 * Usage: npm run openclaw:policies
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICIES_PATH = join(__dirname, "..", "integrations", "openclaw", "policies", "openclaw-default.yaml");

interface PolicyDef {
  policy_id: string;
  subject?: { type?: string; name?: string };
  conditions?: { tool?: string; tool_group?: string };
  effect?: { decision: string };
  precedence?: number;
  enabled?: boolean;
}

function main() {
  console.log("\n  OpenClaw Tool-Policy Matrix");
  console.log("  ─────────────────────────────────────────\n");

  if (!existsSync(POLICIES_PATH)) {
    console.error("  ERROR: openclaw-default.yaml not found.");
    process.exit(1);
  }

  const raw = readFileSync(POLICIES_PATH, "utf-8");
  const parsed = parseYaml(raw);
  const policies: PolicyDef[] = Array.isArray(parsed) ? parsed : [];

  const byTool = new Map<string, { decision: string; policy_id: string; precedence: number }[]>();
  let fallback: { decision: string; policy_id: string } | null = null;

  for (const p of policies) {
    if (!p.effect?.decision || p.enabled === false) continue;
    const prec = p.precedence ?? 0;
    if (p.policy_id === "openclaw-fallback-require-approval" || (prec < 0 && !p.conditions?.tool)) {
      fallback = { decision: p.effect.decision, policy_id: p.policy_id };
      continue;
    }
    const tool = p.conditions?.tool ?? p.subject?.name ?? null;
    if (!tool) continue;
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool)!.push({ decision: p.effect.decision, policy_id: p.policy_id, precedence: prec });
  }

  for (const [tool, entries] of [...byTool.entries()].sort()) {
    entries.sort((a, b) => b.precedence - a.precedence);
    const effective = entries[0];
    console.log(`  ${tool.padEnd(20)} → ${effective.decision.padEnd(18)} (${effective.policy_id})`);
  }

  if (fallback) {
    console.log(`  ${"* (fallback)".padEnd(20)} → ${fallback.decision.padEnd(18)} (${fallback.policy_id})`);
  }

  console.log("\n  Unknown/unscoped tools use the fallback policy.");
  console.log("  ─────────────────────────────────────────\n");
}

main();
