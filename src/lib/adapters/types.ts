import { z } from 'zod';

export type AdapterRiskClass = 'low' | 'medium' | 'high' | 'critical';

export const AdapterRiskClassSchema = z.enum(['low', 'medium', 'high', 'critical']);

/** Adapter certification tier for trust signaling. */
export type AdapterCertificationTier = 'verified' | 'community' | 'experimental';

export const AdapterCertificationTierSchema = z.enum(['verified', 'community', 'experimental']);

export interface AdapterRegistration {
  adapter_id: string;
  display_name: string;
  risk_class: AdapterRiskClass;
  capabilities: string[];
  version: string;
  enabled: boolean;
  /** Certification tier: verified (Clasper-tested), community (known), experimental (default). */
  certification_tier?: AdapterCertificationTier;
  /** Tool-level capability scopes (e.g. browser.navigate, browser.screenshot). */
  tool_capabilities?: string[];
}

export const AdapterRegistrationSchema = z.object({
  adapter_id: z.string(),
  display_name: z.string(),
  risk_class: AdapterRiskClassSchema,
  capabilities: z.array(z.string()),
  version: z.string(),
  enabled: z.boolean(),
  certification_tier: AdapterCertificationTierSchema.optional(),
  tool_capabilities: z.array(z.string()).optional(),
});

export interface AdapterToken {
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  allowed_capabilities: string[];
  expires_at: string;
}

export const AdapterTokenSchema = z.object({
  adapter_id: z.string(),
  tenant_id: z.string(),
  workspace_id: z.string(),
  allowed_capabilities: z.array(z.string()),
  expires_at: z.string(),
});
