export interface RunnerHealth {
  service: string;
  status: "ok";
  mode: "sandbox";
}

export function getRunnerHealth(): RunnerHealth {
  return {
    service: "@autoagent/runner",
    status: "ok",
    mode: "sandbox"
  };
}

export type ActionClass = "read" | "write" | "exec" | "external" | "deploy";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface GuardedAction {
  toolName: string;
  actionClass: ActionClass;
  risk: RiskLevel;
  command: string;
}

export interface ApprovalService {
  requestApproval(action: GuardedAction): Promise<boolean>;
}

export interface RunnerExecutionResult {
  status: "executed" | "blocked" | "awaiting_approval";
  reason: string;
}

export class GuardedRunner {
  public constructor(private readonly approvalService: ApprovalService) {}

  public async evaluateAndExecute(action: GuardedAction): Promise<RunnerExecutionResult> {
    if (action.risk === "critical" && action.actionClass === "deploy") {
      return { status: "blocked", reason: "Critical deploy actions are blocked by default." };
    }
    if (action.risk === "high" || action.actionClass === "external" || action.actionClass === "deploy") {
      const approved = await this.approvalService.requestApproval(action);
      if (!approved) {
        return { status: "awaiting_approval", reason: "Approval required before execution." };
      }
    }

    // The runner currently returns an execution state rather than directly invoking shell.
    return { status: "executed", reason: `Executed in sandbox: ${action.command}` };
  }
}
