export type ActionClass = "read" | "write" | "exec" | "external" | "deploy";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PolicyDecision = "allow" | "needs_approval" | "deny";

export interface ToolPolicyContext {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolPolicyResult {
  decision: PolicyDecision;
  actionClass: ActionClass;
  risk: RiskLevel;
  reason: string;
}

export function evaluateToolPolicy(context: ToolPolicyContext): ToolPolicyResult {
  const actionClass = classifyActionClass(context.toolName, context.input);
  const risk = classifyRisk(context.toolName, context.input);

  if (actionClass === "deploy" && risk === "critical") {
    return { decision: "deny", actionClass, risk, reason: "Deploy actions are denied by default." };
  }
  if (actionClass === "read" && risk === "low") {
    return { decision: "allow", actionClass, risk, reason: "Read operations are allowed." };
  }
  if (actionClass === "exec" && (risk === "high" || risk === "critical")) {
    return { decision: "needs_approval", actionClass, risk, reason: "High-risk command execution requires approval." };
  }
  if (actionClass === "write" && (risk === "high" || risk === "critical")) {
    return { decision: "needs_approval", actionClass, risk, reason: "High-risk file writes require approval." };
  }
  if (actionClass === "external" && risk !== "low") {
    return { decision: "needs_approval", actionClass, risk, reason: "External actions require approval." };
  }
  return { decision: "allow", actionClass, risk, reason: "Allowed by default policy." };
}

function classifyActionClass(toolName: string, input: Record<string, unknown>): ActionClass {
  if (toolName === "read_file" || toolName === "list_directory" || toolName === "search_code" || toolName === "glob_files") return "read";
  if (toolName === "ask_user") return "read";
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "git_add" || toolName === "git_commit") return "write";
  if (toolName === "git_status" || toolName === "git_diff") return "read";
  if (toolName === "run_command") {
    const command = String(input.command ?? "").toLowerCase();
    if (command.includes("deploy") || command.includes("kubectl apply")) return "deploy";
    if (command.includes("curl ") || command.includes("wget ") || command.includes("invoke-webrequest")) return "external";
    return "exec";
  }
  return "exec";
}

function classifyRisk(toolName: string, input: Record<string, unknown>): RiskLevel {
  if (
    toolName === "read_file" ||
    toolName === "list_directory" ||
    toolName === "search_code" ||
    toolName === "glob_files" ||
    toolName === "git_status" ||
    toolName === "git_diff"
  ) return "low";
  if (toolName === "ask_user") return "low";
  if (toolName === "write_file" || toolName === "edit_file") {
    const pathValue = String(input.path ?? "").toLowerCase();
    if (pathValue.endsWith(".env") || pathValue.includes("secrets")) return "critical";
    return "medium";
  }
  if (toolName === "git_add") return "medium";
  if (toolName === "git_commit") return "high";
  const command = String(input.command ?? "").toLowerCase();
  if (!command) return "medium";
  if (command.includes("rm -rf") || command.includes("format") || command.includes("drop database")) return "critical";
  if (command.includes("git push") || command.includes("npm publish") || command.includes("docker push")) return "high";
  if (command.includes("curl ") || command.includes("wget ")) return "high";
  return "medium";
}
