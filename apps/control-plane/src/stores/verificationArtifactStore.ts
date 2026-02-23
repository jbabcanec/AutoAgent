import { getControlPlaneDatabase } from "../database.js";
import type { VerificationArtifactItem } from "../types.js";

export class VerificationArtifactStore {
  private readonly db = getControlPlaneDatabase();

  public create(input: {
    runId: string;
    verificationType: string;
    artifactType: string;
    artifactContent?: string;
    verificationResult: VerificationArtifactItem["verificationResult"];
    checks?: Array<{ check: string; passed: boolean; severity: "info" | "warn" | "error" }>;
  }): VerificationArtifactItem {
    const artifactId = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const verifiedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO verification_artifacts (artifact_id, run_id, verification_type, artifact_type, artifact_content, verification_result, checks_json, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        artifactId,
        input.runId,
        input.verificationType,
        input.artifactType,
        input.artifactContent ?? null,
        input.verificationResult,
        input.checks ? JSON.stringify(input.checks) : null,
        verifiedAt
      );
    const result: VerificationArtifactItem = {
      artifactId,
      runId: input.runId,
      verificationType: input.verificationType,
      artifactType: input.artifactType,
      verificationResult: input.verificationResult,
      verifiedAt
    };
    if (input.artifactContent !== undefined) result.artifactContent = input.artifactContent;
    if (input.checks !== undefined) result.checks = input.checks;
    return result;
  }

  public listByRun(runId: string): VerificationArtifactItem[] {
    const rows = this.db
      .prepare(
        "SELECT artifact_id, run_id, verification_type, artifact_type, artifact_content, verification_result, checks_json, verified_at FROM verification_artifacts WHERE run_id = ? ORDER BY verified_at DESC"
      )
      .all(runId) as Array<{
      artifact_id: string;
      run_id: string;
      verification_type: string;
      artifact_type: string;
      artifact_content: string | null;
      verification_result: VerificationArtifactItem["verificationResult"];
      checks_json: string | null;
      verified_at: string;
    }>;
    return rows.map((row) => {
      const item: VerificationArtifactItem = {
        artifactId: row.artifact_id,
        runId: row.run_id,
        verificationType: row.verification_type,
        artifactType: row.artifact_type,
        verificationResult: row.verification_result,
        verifiedAt: row.verified_at
      };
      if (row.artifact_content !== null) item.artifactContent = row.artifact_content;
      if (row.checks_json !== null) item.checks = JSON.parse(row.checks_json) as Array<{ check: string; passed: boolean; severity: "info" | "warn" | "error" }>;
      return item;
    });
  }

  public pruneOlderThan(days: number, nowMs = Date.now()): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare("DELETE FROM verification_artifacts WHERE verified_at < ?").run(cutoff);
    return result.changes;
  }
}
