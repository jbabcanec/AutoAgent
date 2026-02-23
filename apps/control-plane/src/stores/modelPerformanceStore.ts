import { getControlPlaneDatabase } from "../database.js";
import type { ModelPerformanceItem } from "../types.js";

export class ModelPerformanceStore {
  private readonly db = getControlPlaneDatabase();

  public record(input: {
    providerId: string;
    model: string;
    routingMode: "balanced" | "latency" | "quality" | "cost";
    success: boolean;
    latencyMs: number;
    estimatedCostUsd: number;
    aggregateScore: number;
  }): ModelPerformanceItem {
    const recordedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO model_performance (provider_id, model, routing_mode, success, latency_ms, estimated_cost_usd, aggregate_score, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        input.providerId,
        input.model,
        input.routingMode,
        input.success ? 1 : 0,
        Math.max(0, Math.round(input.latencyMs)),
        Number.isFinite(input.estimatedCostUsd) ? input.estimatedCostUsd : 0,
        Number.isFinite(input.aggregateScore) ? input.aggregateScore : 0,
        recordedAt
      );
    const id = Number(result.lastInsertRowid);
    return {
      id,
      providerId: input.providerId,
      model: input.model,
      routingMode: input.routingMode,
      success: input.success,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      estimatedCostUsd: Number.isFinite(input.estimatedCostUsd) ? input.estimatedCostUsd : 0,
      aggregateScore: Number.isFinite(input.aggregateScore) ? input.aggregateScore : 0,
      recordedAt
    };
  }

  public latestByProvider(
    providerId: string,
    routingMode: "balanced" | "latency" | "quality" | "cost"
  ): Array<{
    model: string;
    sampleSize: number;
    successRate: number;
    avgLatencyMs: number;
    avgCostUsd: number;
    avgScore: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT
          model,
          COUNT(*) as sample_size,
          AVG(success) as success_rate,
          AVG(latency_ms) as avg_latency_ms,
          AVG(estimated_cost_usd) as avg_cost_usd,
          AVG(aggregate_score) as avg_score
         FROM (
           SELECT * FROM model_performance
           WHERE provider_id = ? AND routing_mode = ?
           ORDER BY id DESC
           LIMIT 200
         )
         GROUP BY model
         ORDER BY sample_size DESC`
      )
      .all(providerId, routingMode) as Array<{
      model: string;
      sample_size: number;
      success_rate: number;
      avg_latency_ms: number;
      avg_cost_usd: number;
      avg_score: number;
    }>;

    return rows.map((row) => ({
      model: row.model,
      sampleSize: Number(row.sample_size ?? 0),
      successRate: Number(row.success_rate ?? 0),
      avgLatencyMs: Number(row.avg_latency_ms ?? 0),
      avgCostUsd: Number(row.avg_cost_usd ?? 0),
      avgScore: Number(row.avg_score ?? 0)
    }));
  }
}
