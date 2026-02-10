/**
 * Standardized label colors and display text (title case) for the Ops UI.
 * Use these everywhere so risk, status, and state badges are consistent.
 */

/** Badge kind = CSS class: success (green), info (blue), warn (amber), danger (red), muted (grey) */

export const RISK_KIND = {
  low: "success",
  medium: "warn",
  high: "danger",
  critical: "danger",
};

export const RISK_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SKILL_STATE_KIND = {
  active: "success",
  approved: "info",
  deprecated: "muted",
  draft: "warn",
  tested: "warn",
  experimental: "danger",
};

export const SKILL_STATE_LABEL = {
  active: "Active",
  approved: "Approved",
  deprecated: "Deprecated",
  draft: "Draft",
  tested: "Tested",
  experimental: "Experimental",
};

export const EXECUTION_KIND = {
  success: "success",
  error: "warn",
};

export const EXECUTION_LABEL = {
  success: "Success",
  error: "Error",
};

export const GOV_KIND = {
  allow: "success",
  deny: "danger",
  pending_approval: "warn",
  approved_local: "info",
  unknown: "",
};

export const GOV_LABEL = {
  allow: "Approved",
  deny: "Blocked",
  pending_approval: "Needs approval",
  approved_local: "Local approval (untrusted)",
  unknown: "Unknown",
};

export const TRUST_LABEL = {
  verified: "Verified",
  unverified: "Unverified",
};

/** Title-case a lowercase key (e.g. "high" -> "High") for display when no explicit label exists */
export function titleCase(str) {
  if (str == null || str === "") return str;
  const s = String(str);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
