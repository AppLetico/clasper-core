import { createWriteStream, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as tar from 'tar';

import { getAuditLog } from '../governance/auditLog.js';
import { getTraceStore } from '../tracing/traceStore.js';
import { formatSha256, sha256Hex } from '../security/sha256.js';

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

export async function createExportBundle(scope: ExportScope): Promise<ExportBundleResult> {
  const exportDir = mkdtempSync(join(tmpdir(), 'clasper-export-'));
  const bundleName = `clasper-export-${Date.now()}.tar.gz`;
  const bundlePath = join(exportDir, bundleName);

  const traces = collectTraces(scope);
  const audits = collectAudits(scope);

  const metadata = {
    scope,
    generated_at: new Date().toISOString(),
    self_attested: true,
    external_proof: false,
    counts: {
      traces: traces.length,
      audits: audits.length,
    },
  };

  const metadataPath = join(exportDir, 'metadata.json');
  const tracesPath = join(exportDir, 'traces.jsonl');
  const auditsPath = join(exportDir, 'audits.jsonl');

  writeJson(metadataPath, metadata);
  writeJsonl(tracesPath, traces);
  writeJsonl(auditsPath, audits);

  const integrity = {
    generated_at: metadata.generated_at,
    files: [
      { path: 'metadata.json', sha256: buildFileHash(metadataPath) },
      { path: 'traces.jsonl', sha256: buildFileHash(tracesPath) },
      { path: 'audits.jsonl', sha256: buildFileHash(auditsPath) },
    ],
  };

  const integrityPath = join(exportDir, 'integrity.json');
  writeJson(integrityPath, integrity);

  await pipelineAsync(
    tar.c(
      {
        gzip: true,
        cwd: exportDir,
      },
      ['metadata.json', 'traces.jsonl', 'audits.jsonl', 'integrity.json']
    ),
    createWriteStream(bundlePath)
  );

  return { bundlePath, bundleName };
}
