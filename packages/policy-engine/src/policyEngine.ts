import type { ActionRequest, PolicyDecision, PolicyRule } from "./types.js";
import { DEFAULT_RULES } from "./defaultRules.js";

const RISK_ORDER = ["low", "medium", "high", "critical"] as const;

export class PolicyEngine {
  private readonly rules: PolicyRule[];

  public constructor(rules: PolicyRule[] = DEFAULT_RULES) {
    this.rules = [...rules];
  }

  public evaluate(action: ActionRequest): PolicyDecision {
    const matched = this.rules.filter((rule) => matches(rule, action));
    if (matched.length === 0) {
      return {
        decision: action.risk === "low" ? "allow" : "needs_approval",
        matchedRuleIds: [],
        reason: "No explicit policy rule matched."
      };
    }

    const final = matched.reduce<PolicyRule>((acc, current) => rankDecision(current.decision) > rankDecision(acc.decision) ? current : acc);
    return {
      decision: final.decision,
      matchedRuleIds: matched.map((rule) => rule.id),
      reason: final.description
    };
  }
}

function matches(rule: PolicyRule, action: ActionRequest): boolean {
  if (rule.match.actionClass && rule.match.actionClass !== action.actionClass) return false;
  if (rule.match.toolName && rule.match.toolName !== action.toolName) return false;
  if (rule.match.risk && !riskAtLeast(action.risk, rule.match.risk)) return false;
  return true;
}

function riskAtLeast(actual: ActionRequest["risk"], expected: ActionRequest["risk"]): boolean {
  return RISK_ORDER.indexOf(actual) >= RISK_ORDER.indexOf(expected);
}

function rankDecision(value: PolicyDecision["decision"]): number {
  if (value === "deny") return 3;
  if (value === "needs_approval") return 2;
  return 1;
}
