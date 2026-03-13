/**
 * One-off data patch: set exception_for_policy_id on an existing exception policy
 * so the parent policy shows "Has N exception(s)" in the Policy Registry.
 *
 * Usage (same CLASPER_DB_PATH as your server):
 *   npx tsx scripts/patch-exception-link.ts --tenant-id=local --exception-policy-id=<id> --parent-policy-id=<id>
 *
 * Example:
 *   CLASPER_DB_PATH=./clasper.db npx tsx scripts/patch-exception-link.ts --tenant-id=local --exception-policy-id=my-allow-exception --parent-policy-id=approval_external_network
 */
import "dotenv/config";
import { initDatabase } from "../src/lib/core/db.js";
import { getPolicy, upsertPolicy } from "../src/lib/policy/policyStore.js";
import type { PolicyObject } from "../src/lib/policy/policySchema.js";

const argv = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const s = argv.find((a) => a.startsWith(prefix));
  return s ? s.slice(prefix.length) : undefined;
}

const tenantId = getArg("tenant-id") || process.env.CLASPER_LOCAL_TENANT_ID || "local";
const exceptionPolicyId = getArg("exception-policy-id");
const parentPolicyId = getArg("parent-policy-id");

if (!exceptionPolicyId || !parentPolicyId) {
  console.error("Usage: npx tsx scripts/patch-exception-link.ts --tenant-id=<tenant> --exception-policy-id=<exception policy id> --parent-policy-id=<require_approval policy id>");
  process.exit(1);
}

initDatabase();
const record = getPolicy(tenantId, exceptionPolicyId);
if (!record) {
  console.error(`Policy not found: ${exceptionPolicyId} (tenant: ${tenantId})`);
  process.exit(1);
}

const parent = getPolicy(tenantId, parentPolicyId);
if (!parent) {
  console.error(`Parent policy not found: ${parentPolicyId} (tenant: ${tenantId})`);
  process.exit(1);
}

const meta =
  record._wizard_meta && typeof record._wizard_meta === "object" && !Array.isArray(record._wizard_meta)
    ? { ...(record._wizard_meta as Record<string, unknown>) }
    : {};
meta.exception_for_policy_id = parentPolicyId;

const policy: PolicyObject = {
  policy_id: record.policy_id,
  scope: record.scope ?? {},
  subject: record.subject ?? { type: "tool" },
  conditions: record.conditions ?? {},
  effect: record.effect ?? { decision: "allow" },
  explanation: record.explanation ?? "",
  precedence: record.precedence ?? 0,
  enabled: record.enabled ?? true,
  _wizard_meta: meta,
};
upsertPolicy({ tenantId, policy });
console.log(`Patched ${exceptionPolicyId}: exception_for_policy_id = ${parentPolicyId}`);
console.log(`Policy "${parentPolicyId}" will now show "Has 1 exception" in the Policy Registry.`);
