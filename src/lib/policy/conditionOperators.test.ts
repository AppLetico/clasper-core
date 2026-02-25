import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evalAllUnder,
  evalAnyUnder,
  evalExists,
  evalIn,
  evalPrefix,
  isSafeDottedPath,
  parseConditionExpression,
  resolveTemplate,
  resolveTemplates,
} from './conditionOperators.js';

describe('conditionOperators', () => {
  it('parses scalar shorthand as eq', () => {
    expect(parseConditionExpression('exec')).toEqual({
      operator: 'eq',
      expected: 'exec',
    });
  });

  it('resolves template strings', () => {
    expect(resolveTemplate('{{workspace.root}}/src', { 'workspace.root': '/tmp/ws' })).toBe(
      '/tmp/ws/src'
    );
  });

  it('fails on unknown template variables', () => {
    expect(() => resolveTemplate('{{unknown.key}}/src', { 'workspace.root': '/tmp/ws' })).toThrow(
      /Unknown template variable/
    );
  });

  it('resolves templates recursively', () => {
    expect(
      resolveTemplates(
        { all_under: ['{{workspace.root}}', '{{workspace.root}}/nested'] },
        { 'workspace.root': '/tmp/ws' }
      )
    ).toEqual({ all_under: ['/tmp/ws', '/tmp/ws/nested'] });
  });

  it('supports in operator', () => {
    expect(evalIn('ls', ['ls', 'pwd', 'whoami'])).toBe(true);
    expect(evalIn('rm', ['ls', 'pwd', 'whoami'])).toBe(false);
  });

  it('supports prefix operator', () => {
    expect(evalPrefix('/workspace/src', '/workspace')).toBe(true);
    expect(evalPrefix('/tmp/src', '/workspace')).toBe(false);
  });

  it('supports all_under operator', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clasper-all-under-'));
    const a = path.join(root, 'a.ts');
    const b = path.join(root, 'b.ts');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    expect(evalAllUnder([a, b], [root])).toBe(true);
    expect(evalAllUnder([a, '/tmp/escape.ts'], [root])).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('fails closed for non-canonical or unresolved paths', () => {
    expect(evalAllUnder(['/definitely/not/a/real/path/file.txt'], ['/tmp'])).toBe(false);
  });

  it('supports any_under operator', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clasper-any-under-'));
    const sub = path.join(root, 'sub');
    mkdirSync(sub, { recursive: true });
    const inside = path.join(sub, 'in.ts');
    writeFileSync(inside, 'ok');
    expect(evalAnyUnder(['/tmp/a.ts', inside], [root])).toBe(true);
    expect(evalAnyUnder(['/tmp/a.ts', '/tmp/b.ts'], [root])).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('supports exists operator semantics', () => {
    expect(evalExists('ls')).toBe(true);
    expect(evalExists(false)).toBe(true);
    expect(evalExists(undefined)).toBe(false);
    expect(evalExists(null)).toBe(false);
  });

  it('rejects unsafe dotted paths', () => {
    expect(isSafeDottedPath('context.exec.argv0')).toBe(true);
    expect(isSafeDottedPath('context.__proto__.x')).toBe(false);
    expect(isSafeDottedPath('context.constructor.x')).toBe(false);
    expect(isSafeDottedPath('context.prototype.x')).toBe(false);
  });
});
