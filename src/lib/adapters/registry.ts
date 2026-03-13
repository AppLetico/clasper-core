import { getDatabase } from '../core/db.js';
import type { AdapterRegistration } from './types.js';

export interface AdapterRecord extends AdapterRegistration {
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export class AdapterRegistry {
  register(tenantId: string, registration: AdapterRegistration): AdapterRecord {
    const db = getDatabase();
    const now = new Date().toISOString();

    const certTier = registration.certification_tier ?? 'experimental';
    const toolCaps = registration.tool_capabilities ?? [];

    db.prepare(
      `
      INSERT INTO adapter_registry (
        tenant_id, adapter_id, version, display_name, risk_class, capabilities,
        enabled, certification_tier, tool_capabilities, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, adapter_id, version) DO UPDATE SET
        display_name = excluded.display_name,
        risk_class = excluded.risk_class,
        capabilities = excluded.capabilities,
        enabled = excluded.enabled,
        certification_tier = excluded.certification_tier,
        tool_capabilities = excluded.tool_capabilities,
        updated_at = excluded.updated_at
      `
    ).run(
      tenantId,
      registration.adapter_id,
      registration.version,
      registration.display_name,
      registration.risk_class,
      JSON.stringify(registration.capabilities),
      registration.enabled ? 1 : 0,
      certTier,
      JSON.stringify(toolCaps),
      now,
      now
    );

    return this.get(tenantId, registration.adapter_id, registration.version)!;
  }

  get(tenantId: string, adapterId: string, version?: string): AdapterRecord | null {
    const db = getDatabase();
    let row: AdapterRow | undefined;

    if (version) {
      row = db
        .prepare(
          `
          SELECT * FROM adapter_registry
          WHERE tenant_id = ? AND adapter_id = ? AND version = ?
        `
        )
        .get(tenantId, adapterId, version) as AdapterRow | undefined;
    } else {
      row = db
        .prepare(
          `
          SELECT * FROM adapter_registry
          WHERE tenant_id = ? AND adapter_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `
        )
        .get(tenantId, adapterId) as AdapterRow | undefined;
    }

    return row ? this.rowToRecord(row) : null;
  }

  list(tenantId: string, options?: { limit?: number; offset?: number }): AdapterRecord[] {
    const db = getDatabase();
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = db
      .prepare(
        `
        SELECT * FROM adapter_registry
        WHERE tenant_id = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(tenantId, limit, offset) as AdapterRow[];

    return rows.map((row) => this.rowToRecord(row));
  }

  private rowToRecord(row: AdapterRow): AdapterRecord {
    const toolCapsRaw = (row as { tool_capabilities?: string | null }).tool_capabilities;
    const toolCaps = toolCapsRaw ? JSON.parse(toolCapsRaw) : [];
    return {
      tenant_id: row.tenant_id,
      adapter_id: row.adapter_id,
      version: row.version,
      display_name: row.display_name,
      risk_class: row.risk_class as AdapterRecord['risk_class'],
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
      enabled: !!row.enabled,
      certification_tier: ((row as { certification_tier?: string | null }).certification_tier as AdapterRecord['certification_tier']) ?? 'experimental',
      tool_capabilities: Array.isArray(toolCaps) ? toolCaps : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

interface AdapterRow {
  tenant_id: string;
  adapter_id: string;
  version: string;
  display_name: string;
  risk_class: string;
  capabilities: string | null;
  enabled: number;
  certification_tier?: string | null;
  tool_capabilities?: string | null;
  created_at: string;
  updated_at: string;
}

let adapterRegistryInstance: AdapterRegistry | null = null;

export function getAdapterRegistry(): AdapterRegistry {
  if (!adapterRegistryInstance) {
    adapterRegistryInstance = new AdapterRegistry();
  }
  return adapterRegistryInstance;
}
