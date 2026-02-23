import { getControlPlaneDatabase } from "../database.js";
import type { SettingsItem } from "../types.js";

export class SettingsStore {
  private readonly db = getControlPlaneDatabase();

  public get(): SettingsItem {
    const requireApproval = this.getValue("requireApproval");
    const hasCompletedOnboarding = this.getValue("hasCompletedOnboarding");
    const trialTaskCompleted = this.getValue("trialTaskCompleted");
    const onboardingCompletedAt = this.getValue("onboardingCompletedAt");
    const maxTokens = this.getValue("maxTokens");
    const routingMode = this.getValue("routingMode");
    const egressPolicyMode = this.getValue("egressPolicyMode");
    const egressAllowHostsRaw = this.getValue("egressAllowHosts");
    return {
      requireApproval: requireApproval !== "false",
      hasCompletedOnboarding: hasCompletedOnboarding === "true",
      trialTaskCompleted:
        trialTaskCompleted === "chat" || trialTaskCompleted === "repo" || trialTaskCompleted === "both"
          ? trialTaskCompleted
          : "none",
      onboardingCompletedAt: onboardingCompletedAt || undefined,
      maxTokens: parseInt(maxTokens, 10) || 4096,
      routingMode:
        routingMode === "latency" || routingMode === "quality" || routingMode === "cost" ? routingMode : "balanced",
      egressPolicyMode:
        egressPolicyMode === "off" || egressPolicyMode === "enforce" ? egressPolicyMode : "audit",
      egressAllowHosts: parseJsonArray(egressAllowHostsRaw)
    };
  }

  public update(partial: Partial<SettingsItem>): SettingsItem {
    const next = { ...this.get(), ...partial };
    this.setValue("requireApproval", String(next.requireApproval));
    this.setValue("hasCompletedOnboarding", String(next.hasCompletedOnboarding));
    this.setValue("trialTaskCompleted", next.trialTaskCompleted ?? "none");
    this.setValue("onboardingCompletedAt", next.onboardingCompletedAt ?? "");
    this.setValue("maxTokens", String(next.maxTokens));
    this.setValue("routingMode", next.routingMode ?? "balanced");
    this.setValue("egressPolicyMode", next.egressPolicyMode ?? "audit");
    this.setValue("egressAllowHosts", JSON.stringify(next.egressAllowHosts ?? []));
    return next;
  }

  private getValue(key: string): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? "";
  }

  private setValue(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}
