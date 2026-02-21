export type ActionClass = "read" | "write" | "exec" | "external" | "deploy";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Decision = "allow" | "needs_approval" | "deny";

export interface ActionRequest {
  actionClass: ActionClass;
  risk: RiskLevel;
  toolName: string;
  actorId: string;
  resource?: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  match: Partial<Pick<ActionRequest, "actionClass" | "risk" | "toolName">>;
  decision: Decision;
}

export interface PolicyDecision {
  decision: Decision;
  matchedRuleIds: string[];
  reason: string;
}
