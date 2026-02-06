import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as tar from 'tar';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { formatSha256, sha256Hex } from '../security/sha256.js';
import { stableStringify, type JsonValue } from '../security/stableJson.js';

interface IntegrityPayload {
  generated_at: string;
  audit_chain_verification?: { ok: boolean; failures: string[] };
  files: Record<string, string>;
  signature?: string;
  public_key?: Record<string, unknown>;
  key_id?: string | null;
}

interface AuditChainEntry {
  tenantId: string;
  seq: number;
  prevEventHash: string | null;
  eventHash: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export interface BundleVerificationResult {
  ok: boolean;
  failures: string[];
  fileFailures: string[];
  auditChainFailures: string[];
  signatureVerified: boolean | null;
}

function computeFileHash(path: string): string {
  const content = readFileSync(path, 'utf8');
  return formatSha256(sha256Hex(content));
}

function parseJsonl<T>(path: string): T[] {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function verifyAuditChain(entries: AuditChainEntry[]): string[] {
  const failures: string[] = [];
  let prevHash: string | null = null;
  for (const entry of entries) {
    if (entry.prevEventHash !== prevHash) {
      failures.push(`seq_${entry.seq}_prev_hash_mismatch`);
    }

    const payload = stableStringify({
      tenant_id: entry.tenantId,
      seq: entry.seq,
      prev_event_hash: entry.prevEventHash,
      event_type: entry.eventType,
      event_data: entry.eventData as JsonValue,
      created_at: entry.createdAt,
    });
    const expectedHash = formatSha256(sha256Hex(payload));
    if (expectedHash !== entry.eventHash) {
      failures.push(`seq_${entry.seq}_hash_mismatch`);
    }
    prevHash = entry.eventHash;
  }
  return failures;
}

function verifySignature(integrity: IntegrityPayload): boolean {
  if (!integrity.signature || !integrity.public_key) {
    return false;
  }
  const publicKey = createPublicKey({ key: integrity.public_key, format: 'jwk' });
  const unsigned = { ...integrity };
  delete unsigned.signature;
  delete unsigned.public_key;
  const payload = stableStringify(unsigned as JsonValue);
  return cryptoVerify(
    null,
    Buffer.from(payload),
    publicKey,
    Buffer.from(integrity.signature, 'base64url')
  );
}

export async function verifyExportBundle(bundlePath: string): Promise<BundleVerificationResult> {
  const tempDir = mkdtempSync(join(tmpdir(), 'clasper-export-verify-'));
  const failures: string[] = [];
  const fileFailures: string[] = [];
  const auditChainFailures: string[] = [];
  let signatureVerified: boolean | null = null;

  try {
    await tar.x({ file: bundlePath, cwd: tempDir });

    const integrityPath = join(tempDir, 'integrity.json');
    const verifyPath = join(tempDir, 'verify.sha256');
    const integrity = JSON.parse(readFileSync(integrityPath, 'utf8')) as IntegrityPayload;

    const verifyLine = readFileSync(verifyPath, 'utf8').trim();
    const expectedHash = verifyLine.split(/\s+/)[0];
    const actualHash = computeFileHash(integrityPath);
    if (expectedHash !== actualHash) {
      failures.push('integrity_hash_mismatch');
    }

    for (const [file, hash] of Object.entries(integrity.files)) {
      const path = join(tempDir, file);
      const computed = computeFileHash(path);
      if (computed !== hash) {
        fileFailures.push(`${file}:hash_mismatch`);
      }
    }

    const auditChainPath = join(tempDir, 'audit_chain.jsonl');
    if (readFileSync(auditChainPath, 'utf8').trim()) {
      const chainEntries = parseJsonl<AuditChainEntry>(auditChainPath);
      auditChainFailures.push(...verifyAuditChain(chainEntries));
    }

    if (integrity.signature && integrity.public_key) {
      signatureVerified = verifySignature(integrity);
      if (!signatureVerified) {
        failures.push('signature_invalid');
      }
    }

    return {
      ok: failures.length === 0 && fileFailures.length === 0 && auditChainFailures.length === 0,
      failures,
      fileFailures,
      auditChainFailures,
      signatureVerified,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
