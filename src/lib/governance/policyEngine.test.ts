import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, resetDatabase } from '../core/db.js';
import { evaluatePolicy } from './policyEngine.js';
import { upsertPolicy } from '../policy/policyStore.js';
import { config } from '../core/config.js';

const originalPolicyOperatorsEnabled = config.policyOperatorsEnabled;

beforeEach(() => {
  process.env.CLASPER_DB_PATH = ':memory:';
  resetDatabase();
  initDatabase();
  config.policyOperatorsEnabled = true;
});

afterEach(() => {
  resetDatabase();
  delete process.env.CLASPER_DB_PATH;
  config.policyOperatorsEnabled = originalPolicyOperatorsEnabled;
});

describe('Policy engine', () => {
  it('allows by default when no policy matches', () => {
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
  });

  it('allows when a matching rule exists', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_fs_write',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'allow' },
      },
    });
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('allow_fs_write');
  });

  it('requires approval when rule demands it', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'prod_fs_write',
        scope: { tenant_id: 't1', environment: 'prod' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'require_approval' },
      },
    });
    const result = evaluatePolicy({
      environment: 'prod',
      tool: 'filesystem.write',
      tenant_id: 't1',
    });
    expect(result.decision).toBe('require_approval');
  });

  it('matches capability, intent, context, and provenance conditions', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'deny_marketplace_shell_exec_network',
        scope: { tenant_id: 't1' },
        subject: { type: 'adapter' },
        conditions: {
          capability: 'shell.exec',
          intent: 'install_dependency',
          context: {
            external_network: true,
          },
          provenance: {
            source: 'marketplace',
          },
        },
        effect: { decision: 'deny' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      adapter_id: 'openclaw',
      requested_capabilities: ['shell.exec'],
      intent: 'install_dependency',
      context: { external_network: true },
      provenance: { source: 'marketplace' },
    });

    expect(result.decision).toBe('deny');
    expect(result.matched_policies).toContain('deny_marketplace_shell_exec_network');
  });

  it('does not match when context is missing (unknown)', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'deny_shell_exec_network',
        scope: { tenant_id: 't1' },
        subject: { type: 'adapter' },
        conditions: {
          capability: 'shell.exec',
          context: {
            external_network: true,
          },
        },
        effect: { decision: 'deny' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      adapter_id: 'openclaw',
      requested_capabilities: ['shell.exec'],
    });

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).not.toContain('deny_shell_exec_network');
  });

  it('matches argv0 using in operator', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_safe_exec_argv0',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.exec.argv0': { in: ['ls', 'pwd', 'whoami'] },
        },
        effect: { decision: 'allow' },
        precedence: 30,
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { argv0: 'ls' } },
    });

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('allow_safe_exec_argv0');
  });

  it('fails argv0 in operator when command is not allowlisted', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_safe_exec_argv0_only',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.exec.argv0': { in: ['ls', 'pwd', 'whoami'] },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { argv0: 'rm' } },
    });

    expect(result.matched_policies).not.toContain('allow_safe_exec_argv0_only');
  });

  it('matches prefix operator on cwd', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_workspace_prefix',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.exec.cwd': { prefix: '/workspace' },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { cwd: '/workspace/project' } },
    });
    expect(result.matched_policies).toContain('allow_workspace_prefix');
  });

  it('matches all_under using template variables', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'clasper-policy-all-under-'));
    const srcDir = path.join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    const aPath = path.join(srcDir, 'a.ts');
    const bPath = path.join(srcDir, 'b.ts');
    writeFileSync(aPath, 'a');
    writeFileSync(bPath, 'b');

    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_paths_under_workspace',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.targets.paths': {
            all_under: ['{{workspace.root}}'],
          },
        },
        effect: { decision: 'allow' },
        precedence: 30,
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      templateVars: { 'workspace.root': workspaceRoot },
      context: {
        targets: { paths: [aPath, bPath] },
      },
    });
    expect(result.matched_policies).toContain('allow_paths_under_workspace');
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('fails all_under when one path is outside root', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_paths_all_under_workspace',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.targets.paths': {
            all_under: ['/workspace'],
          },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: {
        targets: { paths: ['/workspace/a.ts', '/tmp/outside.txt'] },
      },
    });

    expect(result.matched_policies).not.toContain('allow_paths_all_under_workspace');
  });

  it('matches any_under when at least one path is in scope', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'clasper-policy-any-under-'));
    const insidePath = path.join(workspaceRoot, 'a.ts');
    writeFileSync(insidePath, 'a');

    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_paths_any_under_workspace',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.targets.paths': {
            any_under: [workspaceRoot],
          },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: {
        targets: { paths: ['/tmp/outside.txt', insidePath] },
      },
    });

    expect(result.matched_policies).toContain('allow_paths_any_under_workspace');
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('supports exists operator and fails closed when missing', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_when_argv0_exists',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.exec.argv0': { exists: true },
        },
        effect: { decision: 'allow' },
      },
    });

    const hasArgv0 = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { argv0: 'ls' } },
    });
    const missingArgv0 = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: {},
    });

    expect(hasArgv0.matched_policies).toContain('allow_when_argv0_exists');
    expect(missingArgv0.matched_policies).not.toContain('allow_when_argv0_exists');
  });

  it('keeps plain string conditions as eq for backward compatibility', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'legacy_tool_match',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool', name: 'exec' },
        conditions: {
          tool: 'exec',
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
    });

    expect(result.matched_policies).toContain('legacy_tool_match');
  });

  it('higher-precedence exception overrides lower require_approval', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'require_approval_exec',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
        },
        effect: { decision: 'require_approval' },
        precedence: 20,
      },
    });
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_safe_exec',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.exec.argv0': { in: ['ls'] },
        },
        effect: { decision: 'allow' },
        precedence: 30,
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { argv0: 'ls' } },
    });

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('allow_safe_exec');
    expect(result.matched_policies).toContain('require_approval_exec');
  });

  it('fails closed when template variable is unknown', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_unknown_template',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.targets.paths': {
            all_under: ['{{unknown.key}}'],
          },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      templateVars: { 'workspace.root': '/workspace' },
      context: { targets: { paths: ['/workspace/a.ts'] } },
    });

    expect(result.matched_policies).not.toContain('allow_unknown_template');
  });

  it('rejects unsafe dotted key conditions', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'unsafe_dotted_key',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool' },
        conditions: {
          tool: 'exec',
          'context.__proto__.polluted': { exists: true },
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
      context: { exec: { argv0: 'ls' } },
    });

    expect(result.matched_policies).not.toContain('unsafe_dotted_key');
  });

  it('preserves legacy matching when operators are disabled', () => {
    config.policyOperatorsEnabled = false;
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'legacy_exec_rule',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool', name: 'exec' },
        conditions: {
          tool: 'exec',
        },
        effect: { decision: 'allow' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      tool: 'exec',
    });
    expect(result.matched_policies).toContain('legacy_exec_rule');
  });
});
