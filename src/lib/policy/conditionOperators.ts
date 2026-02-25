import path from 'node:path';
import { realpathSync } from 'node:fs';

export type ConditionOperator = 'eq' | 'in' | 'prefix' | 'all_under' | 'any_under' | 'exists';

export type ConditionExpression =
  | string
  | number
  | boolean
  | { eq: string | number | boolean }
  | { in: Array<string | number | boolean> }
  | { prefix: string }
  | { all_under: string[] }
  | { any_under: string[] }
  | { exists: true };

export interface ParsedConditionExpression {
  operator: ConditionOperator;
  expected: unknown;
}

const ALLOWED_TEMPLATE_KEYS = new Set(['workspace.root', 'tenant.id', 'workspace.id']);
const FORBIDDEN_DOT_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeFilesystemPath(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  try {
    const resolved = path.resolve(input);
    return realpathSync.native(resolved);
  } catch {
    return null;
  }
}

function ensureTrailingSep(input: string): string {
  return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}

function isPathUnderRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizeFilesystemPath(targetPath);
  const normalizedRoot = normalizeFilesystemPath(rootPath);
  if (!normalizedTarget || !normalizedRoot) return false;
  if (normalizedTarget === normalizedRoot) return true;
  return ensureTrailingSep(normalizedTarget).startsWith(ensureTrailingSep(normalizedRoot));
}

export function resolveTemplate(value: string, vars: Record<string, string>): string {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_, key: string) => {
    if (!ALLOWED_TEMPLATE_KEYS.has(key)) {
      throw new Error(`Unknown template variable: ${key}`);
    }
    if (!Object.prototype.hasOwnProperty.call(vars, key) || typeof vars[key] !== 'string' || !vars[key]) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return vars[key]!;
  });
}

export function resolveTemplates(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return resolveTemplate(value, vars);
  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplates(entry, vars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = resolveTemplates(entry, vars);
    }
    return out;
  }
  return value;
}

export function isSafeDottedPath(pathValue: string): boolean {
  if (!pathValue || typeof pathValue !== 'string') return false;
  const segments = pathValue.split('.');
  if (segments.length === 0) return false;
  return segments.every((seg) => seg.length > 0 && !FORBIDDEN_DOT_SEGMENTS.has(seg));
}

export function parseConditionExpression(input: unknown): ParsedConditionExpression | null {
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return { operator: 'eq', expected: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const entries = Object.entries(input);
  if (entries.length !== 1) return null;
  const [operator, expected] = entries[0]!;

  if (
    operator !== 'eq' &&
    operator !== 'in' &&
    operator !== 'prefix' &&
    operator !== 'all_under' &&
    operator !== 'any_under' &&
    operator !== 'exists'
  ) {
    return null;
  }

  return { operator, expected };
}

export function evalEq(actual: unknown, expected: unknown): boolean {
  return actual === expected;
}

export function evalIn(actual: unknown, expectedList: unknown): boolean {
  return Array.isArray(expectedList) && expectedList.includes(actual);
}

export function evalPrefix(actual: unknown, expectedPrefix: unknown): boolean {
  return typeof actual === 'string' && typeof expectedPrefix === 'string'
    ? actual.startsWith(expectedPrefix)
    : false;
}

export function evalAllUnder(actual: unknown, expectedRoots: unknown): boolean {
  if (!Array.isArray(actual) || actual.length === 0) return false;
  if (!Array.isArray(expectedRoots) || expectedRoots.length === 0) return false;
  const paths = actual.filter((item): item is string => typeof item === 'string');
  const roots = expectedRoots.filter((item): item is string => typeof item === 'string');
  if (paths.length !== actual.length || roots.length !== expectedRoots.length) return false;

  return paths.every((entry) => roots.some((root) => isPathUnderRoot(entry, root)));
}

export function evalAnyUnder(actual: unknown, expectedRoots: unknown): boolean {
  if (!Array.isArray(actual) || actual.length === 0) return false;
  if (!Array.isArray(expectedRoots) || expectedRoots.length === 0) return false;
  const paths = actual.filter((item): item is string => typeof item === 'string');
  const roots = expectedRoots.filter((item): item is string => typeof item === 'string');
  if (paths.length !== actual.length || roots.length !== expectedRoots.length) return false;

  return paths.some((entry) => roots.some((root) => isPathUnderRoot(entry, root)));
}

export function evalExists(actual: unknown): boolean {
  return actual !== undefined && actual !== null;
}

export function evaluateOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown
): boolean {
  switch (operator) {
    case 'eq':
      return evalEq(actual, expected);
    case 'in':
      return evalIn(actual, expected);
    case 'prefix':
      return evalPrefix(actual, expected);
    case 'all_under':
      return evalAllUnder(actual, expected);
    case 'any_under':
      return evalAnyUnder(actual, expected);
    case 'exists':
      return expected === true && evalExists(actual);
    default:
      return false;
  }
}
