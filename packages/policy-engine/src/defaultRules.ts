import type { PolicyRule } from "./types.js";

export const DEFAULT_RULES: PolicyRule[] = [
  {
    id: "deny-critical-deploy",
    description: "Critical deploy actions are denied by default.",
    match: { actionClass: "deploy", risk: "critical" },
    decision: "deny"
  },
  {
    id: "approve-exec-high",
    description: "High-risk execution requires approval.",
    match: { actionClass: "exec", risk: "high" },
    decision: "needs_approval"
  },
  {
    id: "approve-external-medium-plus",
    description: "External actions at medium or higher risk need approval.",
    match: { actionClass: "external" },
    decision: "needs_approval"
  },
  {
    id: "allow-read",
    description: "Read operations are allowed.",
    match: { actionClass: "read" },
    decision: "allow"
  }
];
