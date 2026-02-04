import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { ContextSelector } from "./contextSelector.js";
import { WorkspaceIndex } from "./workspaceIndex.js";
import { resetDatabase } from "../core/db.js";
import { resetVectorStore } from "./vectorStore.js";

const TEST_WORKSPACE = "/tmp/clasper-context-test";
const TEST_DB_PATH = "/tmp/clasper-context-test.db";

function writeSkill(name: string, description: string, instructions: string) {
  const skillDir = join(TEST_WORKSPACE, "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
${instructions}`
  );
}

describe("context selector", () => {
  beforeEach(() => {
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true });
    }
    mkdirSync(join(TEST_WORKSPACE, "skills"), { recursive: true });
    mkdirSync(join(TEST_WORKSPACE, "memory"), { recursive: true });

    writeSkill("seo-skill", "SEO guidance", "Use SEO keywords and structure.");
    writeSkill("deploy-skill", "Deployment steps", "Run migrations before deploy.");

    writeFileSync(
      join(TEST_WORKSPACE, "MEMORY.md"),
      "SEO notes: focus on headings and meta descriptions."
    );
    writeFileSync(
      join(TEST_WORKSPACE, "memory", "2026-02-03.md"),
      "Deployment checklist: verify migrations and rollbacks."
    );

    process.env.CLASPER_DB_PATH = TEST_DB_PATH;
    resetDatabase();
    resetVectorStore();

    const index = new WorkspaceIndex(TEST_WORKSPACE);
    index.indexWorkspace();
  });

  afterEach(() => {
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true });
    }
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
    resetDatabase();
    resetVectorStore();
  });

  it("selects relevant skills and memory chunks", async () => {
    const selector = new ContextSelector(TEST_WORKSPACE);
    const result = await selector.selectContext("seo", {
      maxSkills: 1,
      maxMemoryChunks: 1
    });

    expect(result.skills.length).toBe(1);
    expect(result.skills[0].name).toBe("seo-skill");
    expect(result.memoryChunks.length).toBe(1);
    expect(result.memoryChunks[0]).toContain("SEO");
  });

  it("honors forceIncludeSkills", async () => {
    const selector = new ContextSelector(TEST_WORKSPACE);
    const result = await selector.selectContext("seo", {
      maxSkills: 1,
      maxMemoryChunks: 1,
      forceIncludeSkills: ["deploy-skill"]
    });

    const skillNames = result.skills.map((skill) => skill.name);
    expect(skillNames).toContain("deploy-skill");
  });
});
