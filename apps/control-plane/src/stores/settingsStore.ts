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
    const traceRetentionDays = this.getValue("traceRetentionDays");
    const artifactRetentionDays = this.getValue("artifactRetentionDays");
    const promptRetentionDays = this.getValue("promptRetentionDays");
    const cleanupIntervalMinutes = this.getValue("cleanupIntervalMinutes");
    const result: SettingsItem = {
      requireApproval: requireApproval !== "false",
      hasCompletedOnboarding: hasCompletedOnboarding === "true",
      trialTaskCompleted:
        trialTaskCompleted === "chat" || trialTaskCompleted === "repo" || trialTaskCompleted === "both"
          ? trialTaskCompleted
          : "none",
      maxTokens: parseInt(maxTokens, 10) || 4096
    };
    if (onboardingCompletedAt) result.onboardingCompletedAt = onboardingCompletedAt;
    result.routingMode =
      routingMode === "latency" || routingMode === "quality" || routingMode === "cost" ? routingMode : "balanced";
    result.egressPolicyMode =
      egressPolicyMode === "off" || egressPolicyMode === "enforce" ? egressPolicyMode : "audit";
    result.egressAllowHosts = parseJsonArray(egressAllowHostsRaw);
    result.traceRetentionDays = parsePositiveInt(traceRetentionDays, 30);
    result.artifactRetentionDays = parsePositiveInt(artifactRetentionDays, 30);
    result.promptRetentionDays = parsePositiveInt(promptRetentionDays, 30);
    result.cleanupIntervalMinutes = parsePositiveInt(cleanupIntervalMinutes, 15);
    return result;
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
    this.setValue("traceRetentionDays", String(next.traceRetentionDays ?? 30));
    this.setValue("artifactRetentionDays", String(next.artifactRetentionDays ?? 30));
    this.setValue("promptRetentionDays", String(next.promptRetentionDays ?? 30));
    this.setValue("cleanupIntervalMinutes", String(next.cleanupIntervalMinutes ?? 15));
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

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
