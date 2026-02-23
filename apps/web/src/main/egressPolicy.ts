export type EgressDecision = "allow" | "needs_approval" | "deny";

export interface EgressPolicyInput {
  hosts: string[];
  mode: "off" | "audit" | "enforce";
  allowHosts: string[];
}

export interface EgressPolicyResult {
  decision: EgressDecision;
  blockedHosts: string[];
  reason: string;
}

const SAFE_HOST_SUFFIXES = [
  "openai.com",
  "anthropic.com",
  "npmjs.org",
  "registry.npmjs.org",
  "pypi.org",
  "pythonhosted.org",
  "github.com",
  "raw.githubusercontent.com"
];

export function evaluateEgressPolicy(input: EgressPolicyInput): EgressPolicyResult {
  if (input.mode === "off") {
    return { decision: "allow", blockedHosts: [], reason: "Egress policy disabled." };
  }

  const allowHosts = new Set([...SAFE_HOST_SUFFIXES, ...input.allowHosts.map((host) => host.toLowerCase())]);
  const normalizedInputHosts = input.hosts.map((h) => h.toLowerCase());
  const blockedHosts = normalizedInputHosts.filter((host) => !isAllowedHost(host, allowHosts));

  if (blockedHosts.length === 0) {
    return { decision: "allow", blockedHosts: [], reason: "All outbound hosts allowed." };
  }

  if (input.mode === "audit") {
    return {
      decision: "needs_approval",
      blockedHosts,
      reason: `Unknown outbound hosts detected (audit mode): ${blockedHosts.join(", ")}`
    };
  }

  return {
    decision: "deny",
    blockedHosts,
    reason: `Blocked outbound hosts: ${blockedHosts.join(", ")}`
  };
}

function isAllowedHost(host: string, allowHosts: Set<string>): boolean {
  const normalized = host.toLowerCase();
  if (allowHosts.has(normalized)) return true;
  for (const suffix of allowHosts) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) return true;
  }
  return false;
}
