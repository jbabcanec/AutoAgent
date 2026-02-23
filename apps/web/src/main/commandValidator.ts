export type CommandRisk = "low" | "medium" | "high" | "critical";

export interface CommandInspection {
  normalizedCommand: string;
  risk: CommandRisk;
  violations: string[];
  warnings: string[];
  externalHosts: string[];
  networkSensitive: boolean;
}

const CRITICAL_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=.*\bof=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bdrop\s+database\b/i
];

const HIGH_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bnpm\s+publish\b/i,
  /\bpip\s+install\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-webrequest\b/i,
  /\bscp\b/i
];

const BLOCKED_SHELL_META = [/&&\s*rm\s+-rf/i, /;\s*rm\s+-rf/i, /\|\s*sh\b/i, /\bbase64\b.*\|\s*(bash|sh|pwsh|powershell)\b/i];
const BLOCKED_GENERAL_META = [/`[^`]+`/, /\$\([^)]+\)/, /\|\|/];
const NETWORK_PATTERNS = [/\bcurl\b/i, /\bwget\b/i, /\binvoke-webrequest\b/i, /\binvoke-restmethod\b/i, /\bscp\b/i, /\bsftp\b/i];
const LONG_RUNNING_PATTERNS = [/\bnpm\s+start\b/i, /\bpnpm\s+start\b/i, /\byarn\s+start\b/i, /\bnode\s+\S+\s*$/i];

export function inspectCommand(command: string): CommandInspection {
  const normalizedCommand = command.trim();
  const violations: string[] = [];
  const warnings: string[] = [];

  if (!normalizedCommand) {
    violations.push("Command cannot be empty.");
  }
  if (normalizedCommand.length > 4000) {
    violations.push("Command exceeds maximum allowed length.");
  }
  if (normalizedCommand.includes("\n")) {
    violations.push("Multi-line commands are not allowed.");
  }
  if (/[;&]{2,}|;\s*/.test(normalizedCommand)) {
    warnings.push("Command chaining detected; may require approval.");
  }

  for (const pattern of BLOCKED_SHELL_META) {
    if (pattern.test(normalizedCommand)) {
      violations.push(`Blocked command pattern detected (${pattern.source}).`);
    }
  }
  for (const pattern of BLOCKED_GENERAL_META) {
    if (pattern.test(normalizedCommand)) {
      violations.push(`Blocked shell expansion pattern (${pattern.source}).`);
    }
  }

  let risk: CommandRisk = "low";
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      risk = "critical";
      violations.push(`Critical destructive pattern: ${pattern.source}`);
    }
  }
  if (risk !== "critical") {
    for (const pattern of HIGH_PATTERNS) {
      if (pattern.test(normalizedCommand)) {
        risk = "high";
        warnings.push(`High-risk pattern detected (${pattern.source}).`);
      }
    }
  }
  if (risk === "low" && /(npm|pnpm|yarn)\s+install/i.test(normalizedCommand)) {
    risk = "medium";
  }
  for (const pattern of LONG_RUNNING_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      warnings.push("Potential long-running command detected.");
      if (risk === "low") risk = "medium";
    }
  }
  const networkSensitive = NETWORK_PATTERNS.some((pattern) => pattern.test(normalizedCommand));

  return {
    normalizedCommand,
    risk,
    violations,
    warnings,
    externalHosts: extractHosts(normalizedCommand),
    networkSensitive
  };
}

function extractHosts(command: string): string[] {
  const hosts = new Set<string>();
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)(:\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(command)) !== null) {
    const host = match[1];
    if (host) {
      hosts.add(host.toLowerCase());
    }
  }
  return [...hosts];
}
