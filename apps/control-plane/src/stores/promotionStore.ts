import { getControlPlaneDatabase } from "../database.js";
import type { PromotionCriterionItem, PromotionEvaluationItem } from "../types.js";

export class PromotionStore {
  private readonly db = getControlPlaneDatabase();

  public listCriteria(): PromotionCriterionItem[] {
    const rows = this.db
      .prepare(
        "SELECT criterion_id, name, description, min_aggregate_score, max_safety_violations, min_verification_pass_rate, max_latency_ms, max_estimated_cost_usd, active, created_at, updated_at FROM promotion_criteria ORDER BY created_at ASC"
      )
      .all() as Array<{
      criterion_id: string;
      name: string;
      description: string | null;
      min_aggregate_score: number;
      max_safety_violations: number;
      min_verification_pass_rate: number;
      max_latency_ms: number | null;
      max_estimated_cost_usd: number | null;
      active: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => {
      const item: PromotionCriterionItem = {
        criterionId: row.criterion_id,
        name: row.name,
        minAggregateScore: row.min_aggregate_score,
        maxSafetyViolations: row.max_safety_violations,
        minVerificationPassRate: row.min_verification_pass_rate,
        active: row.active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      if (row.description !== null) item.description = row.description;
      if (row.max_latency_ms !== null) item.maxLatencyMs = row.max_latency_ms;
      if (row.max_estimated_cost_usd !== null) item.maxEstimatedCostUsd = row.max_estimated_cost_usd;
      return item;
    });
  }

  public updateCriterion(
    criterionId: string,
    input: Partial<{
      minAggregateScore: number;
      maxSafetyViolations: number;
      minVerificationPassRate: number;
      maxLatencyMs: number;
      maxEstimatedCostUsd: number;
      active: boolean;
    }>
  ): PromotionCriterionItem | undefined {
    const existing = this.listCriteria().find((item) => item.criterionId === criterionId);
    if (!existing) return undefined;
    const next = { ...existing, ...input, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        "UPDATE promotion_criteria SET min_aggregate_score = ?, max_safety_violations = ?, min_verification_pass_rate = ?, max_latency_ms = ?, max_estimated_cost_usd = ?, active = ?, updated_at = ? WHERE criterion_id = ?"
      )
      .run(
        next.minAggregateScore,
        next.maxSafetyViolations,
        next.minVerificationPassRate,
        next.maxLatencyMs ?? null,
        next.maxEstimatedCostUsd ?? null,
        next.active ? 1 : 0,
        next.updatedAt,
        criterionId
      );
    return this.listCriteria().find((item) => item.criterionId === criterionId);
  }

  public recordEvaluation(input: {
    runId: string;
    criterionId: string;
    aggregateScore: number;
    safetyViolations: number;
    verificationPassRate: number;
    latencyMs?: number;
    estimatedCostUsd?: number;
    reason: string;
  }): PromotionEvaluationItem {
    const evaluationId = `promotion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const evaluatedAt = new Date().toISOString();
    const criterion = this.listCriteria().find((item) => item.criterionId === input.criterionId);
    const rejectReasons: string[] = [];
    if (!criterion) {
      rejectReasons.push("criterion_not_found");
    } else {
      if (input.aggregateScore < criterion.minAggregateScore) rejectReasons.push("low_aggregate_score");
      if (input.safetyViolations > criterion.maxSafetyViolations) rejectReasons.push("safety_violations_exceeded");
      if (input.verificationPassRate < criterion.minVerificationPassRate) rejectReasons.push("low_verification_pass_rate");
      if (typeof criterion.maxLatencyMs === "number" && typeof input.latencyMs === "number" && input.latencyMs > criterion.maxLatencyMs) {
        rejectReasons.push("latency_budget_exceeded");
      }
      if (
        typeof criterion.maxEstimatedCostUsd === "number" &&
        typeof input.estimatedCostUsd === "number" &&
        input.estimatedCostUsd > criterion.maxEstimatedCostUsd
      ) {
        rejectReasons.push("cost_budget_exceeded");
      }
    }
    const promoted = rejectReasons.length === 0;
    const evaluationResult: PromotionEvaluationItem["evaluationResult"] = promoted ? "promoted" : "rejected";
    const reason = input.reason || (promoted ? "promotion gate passed" : `rejected: ${rejectReasons.join(", ")}`);

    this.db
      .prepare(
        "INSERT INTO promotion_evaluations (evaluation_id, run_id, criterion_id, evaluation_result, aggregate_score, safety_violations, verification_pass_rate, latency_ms, estimated_cost_usd, evaluated_at, reason, reject_reasons_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        evaluationId,
        input.runId,
        input.criterionId,
        evaluationResult,
        input.aggregateScore,
        input.safetyViolations,
        input.verificationPassRate,
        input.latencyMs ?? null,
        input.estimatedCostUsd ?? null,
        evaluatedAt,
        reason,
        rejectReasons.length > 0 ? JSON.stringify(rejectReasons) : null
      );
    const evalItem: PromotionEvaluationItem = {
      evaluationId,
      runId: input.runId,
      criterionId: input.criterionId,
      evaluationResult,
      aggregateScore: input.aggregateScore,
      safetyViolations: input.safetyViolations,
      verificationPassRate: input.verificationPassRate,
      evaluatedAt,
      reason
    };
    if (input.latencyMs !== undefined) evalItem.latencyMs = input.latencyMs;
    if (input.estimatedCostUsd !== undefined) evalItem.estimatedCostUsd = input.estimatedCostUsd;
    if (rejectReasons.length > 0) evalItem.rejectReasons = rejectReasons;
    return evalItem;
  }

  public latestByRun(runId: string): PromotionEvaluationItem | undefined {
    const row = this.db
      .prepare(
        "SELECT evaluation_id, run_id, criterion_id, evaluation_result, aggregate_score, safety_violations, verification_pass_rate, latency_ms, estimated_cost_usd, evaluated_at, reason, reject_reasons_json FROM promotion_evaluations WHERE run_id = ? ORDER BY evaluated_at DESC LIMIT 1"
      )
      .get(runId) as
      | {
          evaluation_id: string;
          run_id: string;
          criterion_id: string;
          evaluation_result: PromotionEvaluationItem["evaluationResult"];
          aggregate_score: number;
          safety_violations: number;
          verification_pass_rate: number;
          latency_ms: number | null;
          estimated_cost_usd: number | null;
          evaluated_at: string;
          reason: string;
          reject_reasons_json: string | null;
        }
      | undefined;
    if (!row) return undefined;
    const item: PromotionEvaluationItem = {
      evaluationId: row.evaluation_id,
      runId: row.run_id,
      criterionId: row.criterion_id,
      evaluationResult: row.evaluation_result,
      aggregateScore: row.aggregate_score,
      safetyViolations: row.safety_violations,
      verificationPassRate: row.verification_pass_rate,
      evaluatedAt: row.evaluated_at,
      reason: row.reason
    };
    if (row.latency_ms !== null) item.latencyMs = row.latency_ms;
    if (row.estimated_cost_usd !== null) item.estimatedCostUsd = row.estimated_cost_usd;
    if (row.reject_reasons_json !== null) item.rejectReasons = JSON.parse(row.reject_reasons_json) as string[];
    return item;
  }
}
