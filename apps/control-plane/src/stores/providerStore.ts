import { getControlPlaneDatabase } from "../database.js";
import type { ProviderItem } from "../types.js";

export class ProviderStore {
  private readonly db = getControlPlaneDatabase();

  public list(): ProviderItem[] {
    const rows = this.db
      .prepare("SELECT id, display_name, kind, base_url, default_model FROM providers ORDER BY id")
      .all() as Array<{
      id: string;
      display_name: string;
      kind: ProviderItem["kind"];
      base_url: string;
      default_model: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      kind: row.kind,
      baseUrl: row.base_url,
      defaultModel: row.default_model ?? undefined
    }));
  }
}
