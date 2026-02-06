import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as tar from 'tar';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'crypto';

import { getAuditLog } from '../governance/auditLog.js';
import { getAdapterRegistry } from '../adapters/registry.js';
import { getTraceStore } from '../tracing/traceStore.js';
import { config } from '../core/config.js';
import { formatSha256, sha256Hex } from '../security/sha256.js';
import { stableStringify, type JsonValue } from '../security/stableJson.js';

const pipelineAsync = promisify(pipeline);

export interface ExportScope {
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExportBundleResult {
  bundlePath: string;
  bundleName: string;
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

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function writeJsonl(path: string, items: unknown[]): void {
  const content = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(path, content);
}

function buildFileHash(path: string): string {
  const content = readFileSync(path);
  return formatSha256(sha256Hex(content.toString('utf8')));
}

function collectTraces(scope: ExportScope) {
  const traceStore = getTraceStore();

  if (scope.traceId) {
    const trace = traceStore.getForTenant(scope.traceId, scope.tenantId);
    return trace ? [trace] : [];
  }

  const traces = [];
  const limit = 500;
  let offset = 0;

  while (true) {
    const page = traceStore.list({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      startDate: scope.startDate,
      endDate: scope.endDate,
      limit,
      offset,
    });

    traces.push(...page.traces);
    if (!page.hasMore) break;
    offset += limit;
  }

  return traces;
}

function collectAudits(scope: ExportScope) {
  const auditLog = getAuditLog();
  const entries = [];
  const limit = 500;
  let offset = 0;

  while (true) {
    const page = auditLog.query({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      traceId: scope.traceId,
      startDate: scope.startDate,
      endDate: scope.endDate,
      limit,
      offset,
    });

    entries.push(...page.entries);
    if (!page.hasMore) break;
    offset += limit;
  }

  return entries;
}

function collectAdapters(tenantId: string) {
  const registry = getAdapterRegistry();
  const adapters = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const page = registry.list(tenantId, { limit, offset });
    adapters.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  return adapters;
}

function collectAuditChain(tenantId: string) {
  const auditLog = getAuditLog();
  return auditLog.getAuditChain(tenantId);
}

function buildPublicKeys(adapters: ReturnType<typeof collectAdapters>) {
  return adapters
    .filter((adapter) => adapter.telemetry_public_jwk && adapter.telemetry_key_alg)
    .map((adapter) => ({
      adapter_id: adapter.adapter_id,
      adapter_version: adapter.version,
      alg: adapter.telemetry_key_alg,
      key_id: adapter.telemetry_key_id || null,
      public_jwk: adapter.telemetry_public_jwk,
      revoked_at: adapter.telemetry_key_revoked_at || null,
    }));
}

function loadSigningKey(): { privateKey: ReturnType<typeof createPrivateKey>; publicKey: unknown } | null {
  const mode = config.exportSigningMode;
  const keyPath = config.exportSigningKeyPath;
  if (mode === 'off' || !keyPath) return null;

  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
  return { privateKey, publicKey };
}

function signIntegrity(payload: string, key: ReturnType<typeof createPrivateKey>): string {
  const signature = cryptoSign(null, Buffer.from(payload), key);
  return signature.toString('base64url');
}

export async function createExportBundle(scope: ExportScope): Promise<ExportBundleResult> {
  const exportDir = mkdtempSync(join(tmpdir(), 'clasper-export-'));
  const bundleName = `clasper-export-${Date.now()}.tar.gz`;
  const bundlePath = join(exportDir, bundleName);

  const traces = collectTraces(scope);
  const audits = collectAudits(scope);
  const auditChain = collectAuditChain(scope.tenantId);
  const adapters = collectAdapters(scope.tenantId);
  const publicKeys = buildPublicKeys(adapters);
  const auditVerification = getAuditLog().verifyAuditChain(scope.tenantId);

  const metadata = {
    scope,
    generated_at: new Date().toISOString(),
    counts: {
      traces: traces.length,
      audits: audits.length,
      adapters: adapters.length,
      audit_chain_entries: auditChain.length,
    },
  };

  const metadataPath = join(exportDir, 'metadata.json');
  const tracesPath = join(exportDir, 'traces.jsonl');
  const auditsPath = join(exportDir, 'audits.jsonl');
  const adaptersPath = join(exportDir, 'adapters.json');
  const publicKeysPath = join(exportDir, 'public_keys.json');
  const auditChainPath = join(exportDir, 'audit_chain.jsonl');

  writeJson(metadataPath, metadata);
  writeJsonl(tracesPath, traces);
  writeJsonl(auditsPath, audits);
  writeJson(adaptersPath, adapters);
  writeJson(publicKeysPath, publicKeys);
  writeJsonl(auditChainPath, auditChain);

  const integrityPayload = {
    generated_at: metadata.generated_at,
    audit_chain_verification: auditVerification,
    files: {
      'metadata.json': buildFileHash(metadataPath),
      'traces.jsonl': buildFileHash(tracesPath),
      'audits.jsonl': buildFileHash(auditsPath),
      'adapters.json': buildFileHash(adaptersPath),
      'public_keys.json': buildFileHash(publicKeysPath),
      'audit_chain.jsonl': buildFileHash(auditChainPath),
    },
  };

  const integrityPath = join(exportDir, 'integrity.json');
  writeJson(integrityPath, integrityPayload);

  const signingKey = loadSigningKey();
  if (signingKey) {
    const signed = {
      ...integrityPayload,
      signature: signIntegrity(
        stableStringify(integrityPayload as unknown as JsonValue),
        signingKey.privateKey
      ),
      public_key: signingKey.publicKey,
      key_id: config.exportSigningKeyId || null,
    };
    writeJson(integrityPath, signed);
  }

  const verifyPath = join(exportDir, 'verify.sha256');
  const verifyHash = buildFileHash(integrityPath);
  writeFileSync(verifyPath, `${verifyHash}  integrity.json\n`);

  await tar.c(
    {
      gzip: true,
      file: bundlePath,
      cwd: exportDir,
    },
    [
      basename(metadataPath),
      basename(tracesPath),
      basename(auditsPath),
      basename(adaptersPath),
      basename(publicKeysPath),
      basename(auditChainPath),
      basename(integrityPath),
      basename(verifyPath),
    ]
  );

  return { bundlePath, bundleName };
}

export async function streamBundleToFile(
  bundlePath: string,
  destination: string
): Promise<void> {
  if (!existsSync(bundlePath)) {
    throw new Error('Bundle not found');
  }

  await pipelineAsync(
    createReadStream(bundlePath),
    createWriteStream(destination)
  );
}
