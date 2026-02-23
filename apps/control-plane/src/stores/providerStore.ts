import { getControlPlaneDatabase } from "../database.js";
import type { ProviderItem } from "../types.js";

export class ProviderStore {
  private readonly db = getControlPlaneDatabase();

  public get(id: string): ProviderItem | undefined {
    const row = this.db
      .prepare("SELECT id, display_name, kind, base_url, default_model, api_key_stored FROM providers WHERE id = ?")
      .get(id) as
      | {
          id: string;
          display_name: string;
          kind: ProviderItem["kind"];
          base_url: string;
          default_model: string | null;
          api_key_stored: number;
        }
      | undefined;
    if (!row) return undefined;
    return mapRow(row);
  }

  public create(input: ProviderItem): ProviderItem {
    this.db
      .prepare(
        "INSERT INTO providers (id, display_name, kind, base_url, default_model, api_key_stored) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(input.id, input.displayName, input.kind, input.baseUrl, input.defaultModel ?? null, input.apiKeyStored ? 1 : 0);
    return input;
  }

  public update(id: string, updates: Partial<ProviderItem>): ProviderItem | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next: ProviderItem = { ...existing, ...updates, id };
    this.db
      .prepare("UPDATE providers SET display_name = ?, kind = ?, base_url = ?, default_model = ?, api_key_stored = ? WHERE id = ?")
      .run(next.displayName, next.kind, next.baseUrl, next.defaultModel ?? null, next.apiKeyStored ? 1 : 0, id);
    return next;
  }

  public list(): ProviderItem[] {
    const rows = this.db
      .prepare("SELECT id, display_name, kind, base_url, default_model, api_key_stored FROM providers ORDER BY id")
      .all() as Array<{
      id: string;
      display_name: string;
      kind: ProviderItem["kind"];
      base_url: string;
      default_model: string | null;
      api_key_stored: number;
    }>;
    return rows.map(mapRow);
  }
}

function mapRow(row: {
  id: string;
  display_name: string;
  kind: ProviderItem["kind"];
  base_url: string;
  default_model: string | null;
  api_key_stored: number;
}): ProviderItem {
  const result: ProviderItem = {
    id: row.id,
    displayName: row.display_name,
    kind: row.kind,
    baseUrl: row.base_url,
    apiKeyStored: row.api_key_stored === 1
  };
  if (row.default_model !== null) result.defaultModel = row.default_model;
  return result;
}
