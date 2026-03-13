import { z } from 'zod';

export interface TelemetryEnvelope {
  tenant_id: string;
  workspace_id: string;
  execution_id: string;
  trace_id: string;
  adapter_id: string;
}

export const TelemetryEnvelopeSchema = z.object({
  tenant_id: z.string(),
  workspace_id: z.string(),
  execution_id: z.string(),
  trace_id: z.string(),
  adapter_id: z.string(),
});

export interface TraceIngest extends TelemetryEnvelope {
  trace: Record<string, unknown>;
}

export const TraceIngestSchema = TelemetryEnvelopeSchema.extend({
  trace: z.record(z.unknown()),
});

export interface AuditEventIngest extends TelemetryEnvelope {
  event_type: string;
  message?: string;
  event_data?: Record<string, unknown>;
  occurred_at: string;
}

export const AuditEventIngestSchema = TelemetryEnvelopeSchema.extend({
  event_type: z.string(),
  message: z.string().optional(),
  event_data: z.record(z.unknown()).optional(),
  occurred_at: z.string(),
});

export interface CostMetricIngest extends TelemetryEnvelope {
  cost_usd: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  provider?: string;
  recorded_at: string;
}

export const CostMetricIngestSchema = TelemetryEnvelopeSchema.extend({
  cost_usd: z.number(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  recorded_at: z.string(),
});

export interface ExecutionMetricsIngest extends TelemetryEnvelope {
  step_count: number;
  duration_ms: number;
  recorded_at: string;
}

export const ExecutionMetricsIngestSchema = TelemetryEnvelopeSchema.extend({
  step_count: z.number(),
  duration_ms: z.number(),
  recorded_at: z.string(),
});

export interface ViolationReport extends TelemetryEnvelope {
  violation_type: string;
  message: string;
  occurred_at: string;
  data?: Record<string, unknown>;
}

export const ViolationReportSchema = TelemetryEnvelopeSchema.extend({
  violation_type: z.string(),
  message: z.string(),
  occurred_at: z.string(),
  data: z.record(z.unknown()).optional(),
});
