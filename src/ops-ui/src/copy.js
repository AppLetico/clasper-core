/**
 * Centralized tooltip and UI copy for the ops console.
 * Use these keys in components via data-tooltip={copy.tooltips.…} or tooltip={copy.tooltips.…}.
 */
export const copy = {
  // Short UI copy (non-tooltip) used across views
  cost: {
    subtitle: "Model usage cost associated with governed executions.",
    excludesNote: "Excludes infrastructure and downstream system costs.",
    chartHint: "Click a day to view related traces.",
    totalLabel: (range) => `Total cost (${range})`,
  },

  // Toast messages
  toasts: {
    costRefreshSuccess: "Cost dashboard refreshed",
    costRefreshError: "Failed to load cost dashboard",
  },

  tooltips: {
    // Dashboard stat cards
    dashboard: {
      tracesToday: "Total number of traces processed today — click to view in Traces",
      riskScore: "Number of traces flagged as high or critical risk — click to view in Traces",
      cost7d: "Total cost incurred over the last 7 days — click to view in Cost",
      pendingDecisions: "Decisions requiring human approval",
    },

    // Traces table column headers
    traces: {
      traceId: "Unique identifier for the trace",
      env: "Execution environment (e.g. dev, prod)",
      role: "The role of the AI agent",
      governance: "Governance decision for this execution",
      requested: "What the agent requested (capabilities)",
      policyScope: "Policy and scope details",
      outcome: "Final execution outcome",
      risk: "Calculated risk level",
      trust: "Verification status of the trace source",
      cost: "Total cost of LLM tokens",
      duration: "Total execution time",
    },

    // Cost page
    cost: {
      rangeToggle: "Select a time window (7d or 30d)",
      refresh: "Reload cost data from the server",
      chartHint: "Click a day to view related traces",
      dayRow: "Click to open Traces for this day",
    },
  },
};
