/**
 * Single source of truth for Clasper Core engine version.
 * Used by posture output, CLI verification, and server metadata.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let _cached: string | undefined;

/**
 * Get the canonical engine version from package.json.
 */
export function getEngineVersion(): string {
  if (_cached !== undefined) return _cached;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '../../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    _cached = pkg.version ?? '0.0.0';
  } catch {
    _cached = '0.0.0';
  }
  return _cached;
}
