import { getControlPlaneDatabase } from "../database.js";
import type { SettingsItem } from "../types.js";

export class SettingsStore {
  private readonly db = getControlPlaneDatabase();

  public get(): SettingsItem {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get("requireApproval") as
      | { value: string }
      | undefined;
    return {
      requireApproval: row?.value !== "false"
    };
  }

  public update(partial: Partial<SettingsItem>): SettingsItem {
    const next = { ...this.get(), ...partial };
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("requireApproval", String(next.requireApproval));
    return next;
  }
}
