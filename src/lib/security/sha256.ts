import { createHash } from 'crypto';
import type { JsonValue } from './stableJson.js';
import { stableStringify } from './stableJson.js';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Json(value: JsonValue): string {
  return sha256Hex(stableStringify(value));
}

export function formatSha256(hex: string): string {
  return `sha256:${hex}`;
}
