import { describe, expect, it } from "vitest";
import {
  normalizeWizardMeta,
  normalizeOutcomeFromDecision,
  isUnsafeAllowWizardMeta,
  hashWizardMetaAttestation,
} from "./wizardMeta.js";

describe("wizardMeta normalization", () => {
  it("normalizes valid wizard metadata and attests it", () => {
    const meta = normalizeWizardMeta({
      input: {
        created_via_wizard: true,
        selected_outcome: "allow",
        scope_choice: "workspace",
        command_match_choice: "single",
        warnings_shown: ["broad_scope"],
        wizard_acknowledged_allow: true,
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
      workspaceId: "w1",
      actorUserId: "u1",
    });

    expect(meta).not.toBeNull();
    expect(meta?.wizard_meta_invalid).toBe(false);
    expect(meta?.wizard_meta_attested).toBe(true);
    expect(meta?.attested_by).toBe("core");
    expect(meta?.selected_outcome).toBe("allow");
    expect(meta?.wizard_acknowledged_allow).toBe(true);
    expect(meta?.warnings_shown).toEqual(["broad_scope"]);
  });

  it("flags unsafe allow metadata without acknowledgment", () => {
    const meta = normalizeWizardMeta({
      input: {
        created_via_wizard: true,
        selected_outcome: "allow",
        wizard_acknowledged_allow: false,
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
      workspaceId: "w1",
    });

    expect(meta).not.toBeNull();
    expect(meta?.wizard_meta_invalid).toBe(true);
    expect(isUnsafeAllowWizardMeta(meta)).toBe(true);
  });

  it("maps legacy scope and command choice values", () => {
    const meta = normalizeWizardMeta({
      input: {
        selected_outcome: "require_approval",
        scope_choice: "custom",
        command_match_choice: "this_command",
        wizard_acknowledged_allow: false,
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });

    expect(meta?.scope_choice).toBe("custom_path_scope");
    expect(meta?.command_match_choice).toBe("single");
  });

  it("filters unknown warnings and marks metadata invalid", () => {
    const meta = normalizeWizardMeta({
      input: {
        selected_outcome: "deny",
        warnings_shown: ["broad_scope", "not_known"],
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });

    expect(meta?.warnings_shown).toEqual(["broad_scope"]);
    expect(meta?.wizard_meta_invalid).toBe(true);
  });

  it("marks invalid when warning list is wrong type", () => {
    const meta = normalizeWizardMeta({
      input: {
        selected_outcome: "deny",
        warnings_shown: "broad_scope",
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });

    expect(meta?.warnings_shown).toEqual([]);
    expect(meta?.wizard_meta_invalid).toBe(true);
  });

  it("keeps attested fields present even when invalid", () => {
    const meta = normalizeWizardMeta({
      input: {
        selected_outcome: "ALLOW",
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });

    expect(meta?.wizard_meta_invalid).toBe(true);
    expect(meta?.wizard_meta_attested).toBe(true);
    expect(meta?.attested_by).toBe("core");
    expect(meta?.tenant_id).toBe("t1");
  });

  it("ignores unrelated keys including __proto__", () => {
    const meta = normalizeWizardMeta({
      input: JSON.parse(
        '{"selected_outcome":"deny","warnings_shown":["broad_scope"],"__proto__":{"polluted":true}}'
      ),
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });

    expect(meta?.selected_outcome).toBe("deny");
    expect(meta?.warnings_shown).toEqual(["broad_scope"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves created fields and sets edit attestation fields", () => {
    const created = normalizeWizardMeta({
      input: {
        created_via_wizard: true,
        selected_outcome: "allow",
        scope_choice: "workspace",
        command_match_choice: "single",
        wizard_acknowledged_allow: true,
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
      workspaceId: "w1",
      actorUserId: "creator",
    });
    expect(created).not.toBeNull();

    const edited = normalizeWizardMeta({
      input: {
        created_via_wizard: true,
        selected_outcome: "allow",
        scope_choice: "workspace",
        command_match_choice: "list",
        wizard_acknowledged_allow: true,
      },
      fallbackOutcome: "allow",
      tenantId: "t1",
      workspaceId: "w1",
      actorUserId: "editor",
      previousMeta: created!,
      isEdit: true,
    });

    expect(edited).not.toBeNull();
    expect(edited?.actor_user_id).toBe("creator");
    expect(edited?.edited_via_wizard).toBe(true);
    expect(edited?.last_edited_by).toBe("editor");
    expect(typeof edited?.last_edited_at).toBe("string");
  });
});

describe("wizard meta helpers", () => {
  it("normalizes unknown decisions to require_approval", () => {
    expect(normalizeOutcomeFromDecision("something_else")).toBe("require_approval");
  });

  it("produces stable hash for same semantic payload", () => {
    const meta = normalizeWizardMeta({
      input: {
        created_via_wizard: true,
        selected_outcome: "deny",
        warnings_shown: ["broad_scope"],
      },
      fallbackOutcome: "require_approval",
      tenantId: "t1",
    });
    expect(meta).not.toBeNull();

    const h1 = hashWizardMetaAttestation({
      wizardMeta: meta!,
      policySummary: { b: 2, a: 1 },
    });
    const h2 = hashWizardMetaAttestation({
      wizardMeta: meta!,
      policySummary: { a: 1, b: 2 },
    });
    expect(h1).toBe(h2);
  });
});
